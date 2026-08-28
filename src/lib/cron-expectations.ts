/**
 * Expected refresh interval (hours) per cron source — the single shared copy
 * for admin UI health math (/admin/ops cockpit + /admin/checklist).
 *
 * Semantics (match the cockpit + check-cron-staleness.mjs):
 *   age > expected × 3   → SILENT (red — the source has stopped)
 *   age > expected × 1.5 → STALE  (amber — running late)
 *
 * This intentionally covers the OWNER-VISIBLE sources, not every registered
 * one — the canonical machine registry lives in scripts/check-cron-staleness.mjs
 * (it pages the owner by push). Keep the two roughly aligned when adding a
 * source; the automation page (/admin/automation) shows the full raw list.
 */
export const EXPECTED_INTERVAL_HOURS: Record<string, number> = {
  // hourly pipeline (runs every ~30min; 4h = generous)
  sync_news_rss: 4, classify_news_policy: 4, push_critical_alerts: 4,
  push_state_news: 4, scrape_protectkratom_org: 4, correlate_news_to_bills: 4,
  // daily pipeline
  sync_bill_sponsors: 36, detect_bill_clusters: 36, draft_legislator_stance: 36,
  sync_legislator_donors: 36, sync_lda_kratom: 36, scrape_bop_findings: 36,
  sync_research_pubmed: 36, generate_state_briefing: 36, fire_meeting_reminders: 36,
  fire_daily_brief_push: 36, sync_bills_legiscan_all: 36,
  sync_committees_openstates: 36, derive_state_status: 36,
  review_lapsed_items: 36, sync_legislative_sessions: 36,
  // Fact-integrity watchdog: cross-checks published "X is federally scheduled"
  // claims against the Federal Register. If this goes silent we lose the only
  // automated check that a reader isn't the first to spot a false ban claim.
  audit_federal_claims: 36,
  // weekly pipeline
  sync_nonprofit_990s: 216, broadcast_whats_new: 216, sync_elections: 216,
  official_portraits_sync: 216, bill_topics_classify: 216,
  // ── infrastructure watchdogs ───────────────────────────────────────────────
  // These were MISSING, and that is why /admin/ops and /admin/checklist stayed
  // green through the 2026-07-30 credit outage: summarizeCronHealth() skips any
  // source absent from this map, so the hosting watchdog dying — or reporting a
  // problem — contributed nothing to cron health. The watchdog that guards the
  // whole site must itself be guarded.
  vercel_watchdog: 4,   // cron-hourly.yml, every 2h
  egress_watchdog: 36,  // daily
};

export type CronHealthSummary = {
  tracked: number;
  silent: string[];
  stale: string[];
};

/** Classify latest-run rows (from the scraper_runs_latest view) against the map. */
export function summarizeCronHealth(
  rows: { source: string; finished_at: string | null }[],
  nowMs = Date.now(),
): CronHealthSummary {
  const silent: string[] = [];
  const stale: string[] = [];
  let tracked = 0;
  for (const r of rows) {
    const expected = EXPECTED_INTERVAL_HOURS[r.source];
    if (!expected || !r.finished_at) continue;
    tracked += 1;
    const ageH = (nowMs - new Date(r.finished_at).getTime()) / 3_600_000;
    if (ageH > expected * 3) silent.push(r.source);
    else if (ageH > expected * 1.5) stale.push(r.source);
  }
  return { tracked, silent, stale };
}
