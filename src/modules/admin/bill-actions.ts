"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "./actions";
import { requireMfaForMutation } from "./mfa";
import { recordAdminAction } from "@/lib/audit";
import { normalizeLocality } from "@/lib/locality";

const VALID_SCOPES = ["federal", "state", "county", "municipal"] as const;
type Scope = (typeof VALID_SCOPES)[number];
const VALID_RELEVANCE = ["pro", "anti", "neutral", "unknown"] as const;
const VALID_STATUS = ["introduced", "committee", "passed_chamber", "enacted", "dead"] as const;

const cap = (s: string, n: number) => s.slice(0, n).trim();

export async function createLocalBill(formData: FormData) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Admin or leader only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  const scope = cap(String(formData.get("scope") ?? ""), 16) as Scope;
  if (!(VALID_SCOPES as readonly string[]).includes(scope)) {
    return { error: "Invalid scope." };
  }

  const stateRaw = String(formData.get("state") ?? "").trim().toUpperCase();
  const state = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null;
  if (!state) return { error: "State is required (2-letter code)." };

  const billNumber = cap(String(formData.get("bill_number") ?? ""), 60);
  if (!billNumber) return { error: "Bill number is required (e.g. 'CO-Ord 2026-12')." };

  const title = cap(String(formData.get("title") ?? ""), 500);
  if (!title) return { error: "Title is required." };

  const summary = cap(String(formData.get("summary") ?? ""), 5000) || null;
  const advocacyCallout = cap(String(formData.get("advocacy_callout") ?? ""), 500) || null;
  const officialUrl = cap(String(formData.get("official_url") ?? ""), 1000) || null;
  const sessionId = cap(String(formData.get("session_id") ?? ""), 40) || null;

  const relevance = cap(String(formData.get("kratom_relevance") ?? "unknown"), 16);
  if (!(VALID_RELEVANCE as readonly string[]).includes(relevance)) {
    return { error: "Invalid relevance." };
  }
  const status = cap(String(formData.get("status") ?? "introduced"), 30);
  if (!(VALID_STATUS as readonly string[]).includes(status)) {
    return { error: "Invalid status." };
  }
  const lastActionAt = cap(String(formData.get("last_action_at") ?? ""), 32) || null;

  // Locality only for county/municipal — required there, forbidden for state/federal
  let locality: string | null = null;
  if (scope === "county" || scope === "municipal") {
    const localityRaw = cap(String(formData.get("locality") ?? ""), 120);
    if (!localityRaw) {
      return { error: "Locality is required for county or municipal bills (e.g. 'Tulsa, OK')." };
    }
    locality = normalizeLocality(localityRaw, state);
    if (!locality) return { error: "Could not normalize locality. Use 'City, ST' format." };
  }

  // Confidence is implicit-1.0 for hand-entered bills
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("bills")
    .insert({
      state,
      scope,
      locality,
      bill_number: billNumber,
      title,
      summary,
      advocacy_callout: advocacyCallout,
      status,
      kratom_relevance: relevance,
      relevance_confidence: 1.0,
      last_action: cap(String(formData.get("last_action") ?? ""), 500) || null,
      last_action_at: lastActionAt,
      source_url: null, // OpenStates doesn't track these
      official_url: officialUrl,
      session_id: sessionId,
      active: true,
      last_synced_at: new Date().toISOString(),
      enriched_at: new Date().toISOString(), // hand-summary counts as enriched
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: `A bill ${state} ${billNumber} already exists. Edit that instead.` };
    }
    return { error: error.message };
  }

  await recordAdminAction({
    action: "bill_created_manual",
    targetType: "legislator", // closest enum match (no 'bill' yet)
    targetId: row.id,
    details: { state, scope, bill_number: billNumber, locality, official_url: officialUrl },
  });

  revalidatePath("/bills");
  redirect(`/bills/${row.id}`);
}

/**
 * Edit a bill from /admin/bills/[id]/edit. Allows tweaking the
 * fields admins typically need to override:
 *   - status (introduced / committee / passed_chamber / enacted / dead)
 *   - kratom_relevance + relevance_confidence
 *   - active (false = hidden from public lists)
 *   - title, summary, last_action, last_action_at, source_url
 *
 * MFA-gated. Admin/owner only — leader role can't update bills.
 */
export async function updateBill(input: {
  id: string;
  status?: string;
  kratom_relevance?: string;
  relevance_confidence?: number;
  active?: boolean;
  title?: string;
  summary?: string;
  last_action?: string;
  last_action_at?: string;
  source_url?: string;
}) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Admin only." };
  if (!ctx.isAdmin && !ctx.isOwner) return { error: "Admin only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { error: "Invalid bill id." };

  const patch: Record<string, unknown> = {};
  if (input.status !== undefined) {
    if (!(VALID_STATUS as readonly string[]).includes(input.status)) {
      return { error: `Status must be one of: ${VALID_STATUS.join(", ")}` };
    }
    patch.status = input.status;
  }
  if (input.kratom_relevance !== undefined) {
    if (!(VALID_RELEVANCE as readonly string[]).includes(input.kratom_relevance)) {
      return { error: `Relevance must be one of: ${VALID_RELEVANCE.join(", ")}` };
    }
    patch.kratom_relevance = input.kratom_relevance;
  }
  if (input.relevance_confidence !== undefined) {
    if (!Number.isFinite(input.relevance_confidence) ||
        input.relevance_confidence < 0 || input.relevance_confidence > 1) {
      return { error: "Confidence must be 0-1." };
    }
    patch.relevance_confidence = input.relevance_confidence;
  }
  if (typeof input.active === "boolean") patch.active = input.active;
  if (input.title !== undefined) patch.title = cap(input.title, 500) || null;
  if (input.summary !== undefined) patch.summary = cap(input.summary, 8000) || null;
  if (input.last_action !== undefined) patch.last_action = cap(input.last_action, 500) || null;
  if (input.last_action_at !== undefined) {
    const t = input.last_action_at?.trim();
    patch.last_action_at = t ? t : null;
  }
  if (input.source_url !== undefined) patch.source_url = cap(input.source_url, 500) || null;

  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();

  // Read the BEFORE row so we can detect status transitions and fire
  // the Discord status-change webhook fan-out only when the value
  // actually changed (not on every save). Need this before the update
  // because the SELECT after would already see the new value.
  const { data: before } = await supabase
    .from("bills")
    .select("state, bill_number, title, status, kratom_relevance")
    .eq("id", input.id)
    .single();

  const { error } = await supabase.from("bills").update(patch).eq("id", input.id);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "bill_updated",
    targetType: "legislator", // closest enum match; audit table doesn't have 'bill' yet
    targetId: input.id,
    details: patch,
  });

  // Fan out Discord status-change post if status actually changed.
  // Best-effort — never blocks the response.
  if (before && patch.status && before.status !== patch.status) {
    try {
      const { notifyDiscordOnBillStatusChange } = await import("@/modules/discord/actions");
      void notifyDiscordOnBillStatusChange({
        billId: input.id,
        state: before.state,
        billNumber: before.bill_number,
        title: typeof patch.title === "string" ? patch.title : (before.title ?? ""),
        fromStatus: before.status,
        toStatus: patch.status as string,
        isHostile: (input.kratom_relevance ?? before.kratom_relevance) === "anti",
      });
    } catch {
      // best-effort; admin save still succeeds
    }
  }

  revalidatePath("/bills");
  revalidatePath(`/bills/${input.id}`);
  revalidatePath("/admin/bills");
  return { ok: true };
}

/** Toggle active flag — separate so the admin index can quick-archive without opening the edit form. */
export async function toggleBillActive(input: { id: string; active: boolean }) {
  return updateBill({ id: input.id, active: input.active });
}
