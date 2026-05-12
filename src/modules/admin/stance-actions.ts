"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";

const VALID_STANCES = ["champion", "sympathetic", "neutral", "hostile", "unknown"] as const;
export type Stance = (typeof VALID_STANCES)[number];

export async function listStateStances(state: string) {
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
    .from("legislator_kratom_stance")
    .select("legislator_id, stance, rationale_md, last_evidence_url, last_updated_at")
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
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  if (!VALID_STANCES.includes(input.stance as Stance)) return { error: "Invalid stance." };

  const sb = await createClient();
  const { error } = await sb.from("legislator_kratom_stance").upsert({
    legislator_id: input.legislatorId,
    stance: input.stance,
    rationale_md: input.rationale_md?.slice(0, 2000) ?? null,
    last_evidence_url: input.last_evidence_url?.slice(0, 500) ?? null,
    last_updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "legislator_stance_set",
    targetType: "legislator",
    targetId: input.legislatorId,
    details: { stance: input.stance, has_rationale: !!input.rationale_md },
  });
  revalidatePath("/admin/stance");
  return { ok: true };
}
