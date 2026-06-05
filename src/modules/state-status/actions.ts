"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";

/**
 * State Mission Control PR4 — admin confirm queue for state_status.
 *
 * The nightly derivation (derive-state-status.mjs) writes derived_* + flags
 * unreliable cases needs_review=true (statute-only bans, pending-only
 * signals, KCPA 7-OH inference). Admins resolve those here by setting the
 * canonical admin_* status, which the /states header prefers over derived_*.
 * Admin override is preserved across nightly recomputes (the script only
 * upserts derived/review columns).
 *
 * Resilient to migration 0173 not being applied yet: listStateStatus()
 * returns an empty queue instead of throwing.
 */

const LEAF_VALUES = ["legal", "kcpa", "banned", "restricted", "protected"];
const OH_VALUES = ["legal", "banned", "restricted", "protected"];

export type StateStatusRow = {
  state: string;
  name: string;
  legacy_kratom_status: string | null;
  derived_leaf_status: string | null;
  derived_7oh_status: string | null;
  basis: string | null;
  enacted_count: number | null;
  leaf_evidence_bill: string | null;
  sevenoh_evidence_bill: string | null;
  needs_review: boolean;
  review_reason: string | null;
  admin_leaf_status: string | null;
  admin_7oh_status: string | null;
  admin_note: string | null;
  confirmed_at: string | null;
};

export async function listStateStatus(): Promise<
  { ok: true; rows: StateStatusRow[] } | { error: string }
> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("state_status")
    .select(
      "state, derived_leaf_status, derived_7oh_status, basis, enacted_count, leaf_evidence_bill, sevenoh_evidence_bill, needs_review, review_reason, admin_leaf_status, admin_7oh_status, admin_note, confirmed_at",
    )
    .order("needs_review", { ascending: false })
    .order("state", { ascending: true });
  // Table may not exist yet (0173 not applied) → present an empty queue.
  if (error) return { ok: true, rows: [] };

  // Names + legacy status for context (states table always exists).
  const { data: states } = await supabase.from("states").select("abbr, name, kratom_status");
  const meta = new Map((states ?? []).map((s: { abbr: string; name: string; kratom_status: string | null }) => [s.abbr, s]));

  const rows: StateStatusRow[] = (data ?? []).map((r) => ({
    state: r.state,
    name: meta.get(r.state)?.name ?? r.state,
    legacy_kratom_status: meta.get(r.state)?.kratom_status ?? null,
    derived_leaf_status: r.derived_leaf_status,
    derived_7oh_status: r.derived_7oh_status,
    basis: r.basis,
    enacted_count: r.enacted_count,
    leaf_evidence_bill: r.leaf_evidence_bill,
    sevenoh_evidence_bill: r.sevenoh_evidence_bill,
    needs_review: r.needs_review,
    review_reason: r.review_reason,
    admin_leaf_status: r.admin_leaf_status,
    admin_7oh_status: r.admin_7oh_status,
    admin_note: r.admin_note,
    confirmed_at: r.confirmed_at,
  }));
  return { ok: true, rows };
}

export async function confirmStateStatus(input: {
  state: string;
  leaf: string | null;
  sevenoh: string | null;
  note: string;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[A-Z]{2}$/.test(input.state)) return { error: "Invalid state." };
  if (input.leaf && !LEAF_VALUES.includes(input.leaf)) return { error: "Invalid leaf status." };
  if (input.sevenoh && !OH_VALUES.includes(input.sevenoh)) return { error: "Invalid 7-OH status." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("state_status")
    .update({
      admin_leaf_status: input.leaf || null,
      admin_7oh_status: input.sevenoh || null,
      admin_note: input.note?.slice(0, 2000) || null,
      confirmed_by: ctx.userId,
      confirmed_at: new Date().toISOString(),
      needs_review: false,
      updated_at: new Date().toISOString(),
    })
    .eq("state", input.state)
    .select("state");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "No derived row for this state yet — run the derivation (npm run derive:state-status -- --apply) first." };
  }

  await recordAdminAction({
    action: "state_status.confirm",
    targetId: input.state,
    details: { leaf: input.leaf, sevenoh: input.sevenoh },
  });
  revalidatePath("/admin/state-status");
  return { ok: true };
}
