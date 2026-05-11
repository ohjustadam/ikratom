"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { recordAdminAction } from "@/lib/audit";
import { getAdminContext } from "@/modules/admin/actions";

/** Toggle a BoP source on/off. Admin only. */
export async function setBopSourceEnabled(input: {
  sourceId: string;
  enabled: boolean;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("bop_sources")
    .update({ enabled: input.enabled })
    .eq("id", input.sourceId);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: input.enabled ? "bop_source_enabled" : "bop_source_disabled",
    targetType: "policy_alert",
    targetId: input.sourceId,
  });

  revalidatePath("/admin/bop-monitor");
  return { ok: true };
}

/** Manually trigger a scrape on a single source. Admin only. */
export async function runBopSourceNow(input: { sourceId: string }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };

  const sr = createServiceRoleClient();
  // Load just this source and walk it directly. Reuse the engine but
  // narrow the query — easiest is to flip enabled briefly. Simpler:
  // call the adapter directly here. To avoid duplicating logic we use
  // the engine with a where clause hack: pass limit=1 won't filter to
  // the right row, so we patch the source's last_scraped_at first to
  // ensure it sorts first, then call.
  const { data: source, error: srcErr } = await sr
    .from("bop_sources")
    .select("*")
    .eq("id", input.sourceId)
    .single();
  if (srcErr || !source) return { error: "Source not found." };

  // Dynamic import — keeps the .mjs out of the client bundle.
  const { default: adapter } = await loadAdapter(source.adapter);
  const startedAt = new Date();
  try {
    const raw = await adapter.scrape({ source });
    const items = (Array.isArray(raw) ? raw : []).filter(
      (i: unknown): i is { title: string; snippet?: string; url?: string; meeting_date?: string; raw?: unknown } =>
        !!i && typeof i === "object" && typeof (i as { title?: unknown }).title === "string" && ((i as { title: string }).title.trim().length > 0)
    );

    const { classifyBopText } = await import("./classify");
    const rows = items.map((item) => {
      const { relevance, severity } = classifyBopText([item.title, item.snippet ?? ""]);
      return {
        source_id: source.id,
        state: source.state,
        title: String(item.title).slice(0, 500).trim(),
        snippet: item.snippet ? String(item.snippet).slice(0, 2000) : null,
        url: item.url ? String(item.url).slice(0, 1000) : null,
        meeting_date: item.meeting_date ?? null,
        classified_relevance: relevance,
        classified_severity: severity,
        raw: (item.raw ?? null) as unknown,
      };
    });

    let inserted = 0;
    if (rows.length > 0) {
      const { data, error: insErr } = await sr
        .from("bop_findings")
        .upsert(rows, { onConflict: "source_id,dedupe_key", ignoreDuplicates: true })
        .select("id");
      if (insErr) throw new Error(insErr.message);
      inserted = data?.length ?? 0;
    }

    await sr.from("bop_sources").update({
      last_scraped_at: startedAt.toISOString(),
      last_status: inserted > 0 ? "ok" : "no_findings",
      last_error: null,
      last_finding_count: inserted,
    }).eq("id", source.id);

    revalidatePath("/admin/bop-monitor");
    return { ok: true, inserted };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 500);
    await sr.from("bop_sources").update({
      last_scraped_at: startedAt.toISOString(),
      last_status: "error",
      last_error: msg,
    }).eq("id", source.id);
    return { error: msg };
  }
}

/** Mark a finding reviewed with admin's classification. */
export async function reviewBopFinding(input: {
  findingId: string;
  relevance: "kratom_direct" | "kratom_adjacent" | "unrelated";
  severity: "hostile_proposal" | "discussion_only" | "supportive" | "neutral";
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("bop_findings")
    .update({
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
      reviewed_relevance: input.relevance,
      reviewed_severity: input.severity,
    })
    .eq("id", input.findingId);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "bop_finding_reviewed",
    targetType: "policy_alert",
    targetId: input.findingId,
    details: { relevance: input.relevance, severity: input.severity },
  });

  revalidatePath("/admin/bop-monitor");
  return { ok: true };
}

/**
 * Promote a finding to a policy_alert so it shows up in the regular
 * advocate-facing alert surfaces. Admin only.
 */
export async function emitBopAlert(input: { findingId: string }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };

  const supabase = await createClient();
  const { data: finding, error: fErr } = await supabase
    .from("bop_findings")
    .select("id, state, title, snippet, url, alert_emitted_at")
    .eq("id", input.findingId)
    .single();
  if (fErr || !finding) return { error: "Finding not found." };
  if (finding.alert_emitted_at) return { error: "Already emitted." };

  // Best-effort policy_alert insert. The exact column set on policy_alerts
  // varies by migration history; we map the fields we know exist and let
  // any others fall back to defaults. If the table doesn't accept our
  // shape we surface the error to the admin instead of silently failing.
  const sr = createServiceRoleClient();
  const { data: alert, error: aErr } = await sr
    .from("policy_alerts")
    .insert({
      state: finding.state,
      title: `BoP: ${finding.title}`.slice(0, 300),
      summary: finding.snippet,
      source_url: finding.url,
      kind: "bop_rule_proposal",
      moderation_status: "approved",
      severity: "high",
    })
    .select("id")
    .single();
  if (aErr) return { error: `policy_alerts insert failed: ${aErr.message}` };

  await supabase
    .from("bop_findings")
    .update({
      alert_emitted_at: new Date().toISOString(),
      alert_id: alert.id,
    })
    .eq("id", input.findingId);

  await recordAdminAction({
    action: "bop_alert_emitted",
    targetType: "policy_alert",
    targetId: alert.id,
    details: { from_finding: input.findingId },
  });

  revalidatePath("/admin/bop-monitor");
  return { ok: true };
}

// ----- helpers -----

type BopAdapter = {
  scrape(input: { source: Record<string, unknown> }): Promise<unknown[]>;
};

async function loadAdapter(name: string): Promise<{ default: BopAdapter }> {
  // We dynamic-import from the .mjs adapter so this server action stays
  // single-source-of-truth with the cron + script entrypoints.
  const mod = await import(/* @vite-ignore */ `../../../scripts/lib/bop-adapters/${name}.mjs`);
  if (typeof (mod as { scrape?: unknown }).scrape !== "function") {
    throw new Error(`Adapter "${name}" does not export a scrape function`);
  }
  return { default: mod as BopAdapter };
}
