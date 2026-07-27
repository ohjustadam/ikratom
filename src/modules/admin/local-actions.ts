"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  await recordAdminAction({
    action: "local_official_created",
    targetType: "legislator",
    targetId: row?.id,
    details: { full_name: data.full_name, locality: data.locality, role: data.role },
  });

  redirect("/admin/locals");
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
