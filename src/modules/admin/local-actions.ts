"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeLocality } from "@/lib/locality";
import { recordAdminAction } from "@/lib/audit";
import { getCreatorContext } from "./actions";
import { requireMfaForMutation } from "./mfa";

const LOCAL_ROLES = [
  "mayor", "city_council", "county_executive",
  "county_commissioner", "school_board", "other_local",
] as const;

function readForm(formData: FormData) {
  const cap = (s: string, n: number) => s.slice(0, n).trim();
  const fullName = cap(String(formData.get("full_name") ?? ""), 120);
  const stateRaw = cap(String(formData.get("state") ?? ""), 2).toUpperCase();
  const role = cap(String(formData.get("role") ?? ""), 30);
  const localityRawInput = cap(String(formData.get("locality") ?? ""), 120);
  const body = cap(String(formData.get("body") ?? ""), 200) || null;
  const title = cap(String(formData.get("title") ?? ""), 120) || null;
  const district = cap(String(formData.get("district") ?? ""), 30) || null;
  const email = cap(String(formData.get("email") ?? ""), 254) || null;
  const phone = cap(String(formData.get("phone") ?? ""), 30) || null;
  const website = cap(String(formData.get("website") ?? ""), 500) || null;
  const officeAddress = cap(String(formData.get("office_address") ?? ""), 300) || null;
  const party = cap(String(formData.get("party") ?? ""), 60) || null;
  const level = role.startsWith("county_") ? "county" : "municipal";

  // Canonical locality: title-case city, uppercase state, ", " separator
  const locality = normalizeLocality(localityRawInput, stateRaw) ?? "";

  return {
    full_name: fullName,
    state: stateRaw,
    role,
    locality,
    body,
    title,
    district,
    email,
    phone,
    website,
    office_address: officeAddress,
    party,
    level,
    active: true,
  };
}

function validate(d: ReturnType<typeof readForm>): string | null {
  if (!d.full_name) return "Full name is required.";
  if (!/^[A-Z]{2}$/.test(d.state)) return "State must be a 2-letter code.";
  if (!LOCAL_ROLES.includes(d.role as (typeof LOCAL_ROLES)[number])) return "Invalid role.";
  if (!d.locality) return "Locality is required (e.g. 'Tulsa, OK' or 'Tulsa County, OK').";
  return null;
}

export async function createLocalOfficial(formData: FormData) {
  const ctx = await getCreatorContext({ require: "add_local_officials" });
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader to manage local officials." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  const data = readForm(formData);
  const err = validate(data);
  if (err) return { error: err };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("legislators")
    .insert(data)
    .select("id")
    .single();
  if (error) return { error: error.message };

  const closed = await fulfillPendingRequests(ctx.userId, data.state, data.locality, data.level);

  await recordAdminAction({
    action: "local_official_created",
    targetType: "legislator",
    targetId: row?.id,
    details: { full_name: data.full_name, locality: data.locality, role: data.role, requests_closed: closed },
  });

  if (formData.get("add_another") === "1") {
    const q = new URLSearchParams({
      state: data.state,
      locality: data.locality,
      role: data.role,
      added: data.full_name,
      ...(closed > 0 ? { closed: "1" } : {}),
    });
    redirect(`/admin/locals/new?${q.toString()}`);
  }
  redirect("/admin/locals");
}

/**
 * Hand-adding an official for a place someone asked about closes that request
 * — before 2026-10-07 it didn't, so a request stayed "1 user waiting" even
 * after its officials were entered, and the requester was never told.
 * Same close + notify as the inline-accept and batch paths. Service role:
 * advocate leaders can add officials but have no UPDATE on local_rep_requests,
 * and an RLS-denied update would silently no-op. Best-effort — the official is
 * already saved.
 */
async function fulfillPendingRequests(userId: string, state: string, locality: string, level: string): Promise<number> {
  try {
    const db = createServiceRoleClient();
    const { data: closed, error } = await db
      .from("local_rep_requests")
      .update({ status: "fulfilled", resolved_at: new Date().toISOString(), resolved_by: userId })
      .eq("state", state)
      .eq("locality", locality)
      .eq("level", level)
      .eq("status", "pending")
      .select("id");
    if (error || !closed?.length) return 0;
    // Only on the add that closes it: the RPC dedups per user per locality
    // anyway, and null names gives the generic "your officials are loaded"
    // body rather than naming just the first of a council.
    const { error: notifyErr } = await db.rpc("notify_locality_residents", {
      p_state: state,
      p_locality: locality,
      p_official_names: null,
    });
    if (notifyErr) console.warn("[local-official-create] notify RPC failed:", notifyErr.message);
    return closed.length;
  } catch (e) {
    console.warn("[local-official-create] fulfill failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

export async function updateLocalOfficial(id: string, formData: FormData) {
  const ctx = await getCreatorContext({ require: "add_local_officials" });
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader to manage local officials." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };
  if (!id) return { error: "Missing id." };

  const data = readForm(formData);
  const err = validate(data);
  if (err) return { error: err };

  const supabase = await createClient();
  const { error } = await supabase.from("legislators").update(data).eq("id", id);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "local_official_updated",
    targetType: "legislator",
    targetId: id,
    details: { full_name: data.full_name, locality: data.locality, role: data.role },
  });

  redirect("/admin/locals");
}

export async function deleteLocalOfficial(id: string) {
  const ctx = await getCreatorContext({ require: "add_local_officials" });
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader to manage local officials." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  const supabase = await createClient();
  const { error } = await supabase
    .from("legislators")
    .delete()
    .eq("id", id)
    .in("level", ["municipal", "county"]); // safety: never delete federal/state via this
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "local_official_deleted",
    targetType: "legislator",
    targetId: id,
  });

  return { ok: true };
}
