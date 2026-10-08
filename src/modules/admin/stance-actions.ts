"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { STANCE_TOPICS, STANCE_TOPIC_DEFAULT, type StanceTopic } from "@/lib/legislator-action-plan";

const VALID_STANCES = ["champion", "sympathetic", "neutral", "hostile", "unknown"] as const;
export type Stance = (typeof VALID_STANCES)[number];

function normTopic(topic?: string | null): StanceTopic {
  return (STANCE_TOPICS as readonly string[]).includes(topic ?? "")
    ? (topic as StanceTopic)
    : STANCE_TOPIC_DEFAULT;
}

export async function listStateStances(state: string, topic: string = STANCE_TOPIC_DEFAULT) {
  const t = normTopic(topic);
  const sb = await createClient();
  const { data: legs } = await sb
    .from("legislators")
    .select("id, full_name, role, district, party")
    .eq("state", state)
    .eq("active", true)
    .order("full_name");
  const ids = (legs ?? []).map((l) => l.id);
  if (ids.length === 0) return { legs: [], stances: new Map<string, { stance: Stance; rationale_md: string | null; last_evidence_url: string | null; last_updated_at: string | null }>() };

  const { data: stanceRows } = await sb
    .from("legislator_stance")
    .select("legislator_id, stance, rationale_md, last_evidence_url, last_updated_at")
    .eq("topic", t)
    .in("legislator_id", ids);
  const stances = new Map<string, { stance: Stance; rationale_md: string | null; last_evidence_url: string | null; last_updated_at: string | null }>();
  for (const r of stanceRows ?? []) {
    stances.set(r.legislator_id as string, {
      stance: r.stance as Stance,
      rationale_md: r.rationale_md as string | null,
      last_evidence_url: r.last_evidence_url as string | null,
      last_updated_at: r.last_updated_at as string | null,
    });
  }
  return { legs: legs ?? [], stances };
}

export async function setStance(input: {
  legislatorId: string;
  stance: string;
  rationale_md?: string | null;
  last_evidence_url?: string | null;
  topic?: string;
}) {
  const ctx = await getAdminContext({ require: "edit_stance" });
  if (!ctx.ok) return { error: "Admin only." };
  if (!VALID_STANCES.includes(input.stance as Stance)) return { error: "Invalid stance." };
  const t = normTopic(input.topic);

  const sb = await createClient();
  const { error } = await sb.from("legislator_stance").upsert({
    legislator_id: input.legislatorId,
    topic: t,
    stance: input.stance,
    rationale_md: input.rationale_md?.slice(0, 2000) ?? null,
    last_evidence_url: input.last_evidence_url?.slice(0, 500) ?? null,
    last_updated_at: new Date().toISOString(),
  }, { onConflict: "legislator_id,topic" });
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "legislator_stance_set",
    targetType: "legislator",
    targetId: input.legislatorId,
    details: { stance: input.stance, topic: t, has_rationale: !!input.rationale_md },
  });
  revalidatePath("/admin/stance");
  return { ok: true };
}

/**
 * Bulk-approve drafted stances: takes an array of legislator IDs and
 * an explicit stance to apply to all of them. Used by the /admin/stance
 * bulk-review UI to clear large batches of AI drafts that need the
 * same admin decision (e.g. "approve all 50 NY 'neutral committee
 * membership only' drafts as neutral").
 *
 * Preserves each draft's rationale_md / last_evidence_url — only
 * updates the stance + last_updated_at. So admin essentially
 * 'co-signs' the AI's rationale by flipping the stance off 'unknown'.
 *
 * Caps at 100 ids per call to keep audit log entries readable.
 */
export async function bulkSetStance(input: {
  legislatorIds: string[];
  stance: string;
  topic?: string;
}) {
  const ctx = await getAdminContext({ require: "edit_stance" });
  if (!ctx.ok) return { error: "Admin only." };
  if (!VALID_STANCES.includes(input.stance as Stance)) return { error: "Invalid stance." };
  const t = normTopic(input.topic);
  const ids = (input.legislatorIds ?? []).slice(0, 100).filter(Boolean);
  if (ids.length === 0) return { error: "No legislators selected." };

  const sb = await createClient();
  const now = new Date().toISOString();

  // Pull existing rows so the upsert preserves rationale + evidence
  const { data: existing } = await sb
    .from("legislator_stance")
    .select("legislator_id, rationale_md, last_evidence_url")
    .eq("topic", t)
    .in("legislator_id", ids);
  const existingMap = new Map<string, { rationale_md: string | null; last_evidence_url: string | null }>();
  for (const e of existing ?? []) {
    existingMap.set(e.legislator_id as string, {
      rationale_md: e.rationale_md as string | null,
      last_evidence_url: e.last_evidence_url as string | null,
    });
  }

  const rows = ids.map((legislatorId) => ({
    legislator_id: legislatorId,
    topic: t,
    stance: input.stance,
    rationale_md: existingMap.get(legislatorId)?.rationale_md ?? null,
    last_evidence_url: existingMap.get(legislatorId)?.last_evidence_url ?? null,
    last_updated_at: now,
  }));

  const { error } = await sb.from("legislator_stance").upsert(rows, { onConflict: "legislator_id,topic" });
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "legislator_stance_bulk_set",
    targetType: "legislator",
    targetId: ids[0],
    details: { stance: input.stance, topic: t, count: ids.length, all_ids: ids },
  });
  revalidatePath("/admin/stance");
  return { ok: true, applied: ids.length };
}
