/**
 * Cron registry — the source-of-truth catalog of every scheduled
 * automation across the platform. Used by /admin/automation to
 * render the terminal-style list, weekly calendar heatmap, and
 * impact projection.
 *
 * Three systems:
 *   - vercel       — declared in vercel.json, run by Vercel Cron
 *                    (free, unaffected by GH Actions billing)
 *   - gh-hourly    — .github/workflows/cron-hourly.yml (every 30min)
 *   - gh-daily     — .github/workflows/cron-daily.yml (once daily)
 *   - gh-weekly    — .github/workflows/cron-weekly.yml (once weekly)
 *   - db-trigger   — Postgres trigger, fires on row insert/update
 *
 * Each entry mirrors a single script invocation. The `source` field
 * matches the string the script writes to `scraper_runs.source`,
 * letting the dashboard cross-reference recent actual runs to the
 * expected schedule.
 *
 * Update this file when adding/removing scripts from any workflow.
 */

export type CronSystem = "vercel" | "gh-hourly" | "gh-daily" | "gh-weekly" | "db-trigger" | "local-box";
export type CronCadence = "every-30min" | "hourly" | "daily" | "weekly" | "realtime";

export type CronEntry = {
  /** Matches scraper_runs.source. Undefined for jobs that don't write telemetry. */
  source?: string;
  /** Human-readable label */
  label: string;
  /** 1-line plain-English purpose */
  purpose: string;
  system: CronSystem;
  cadence: CronCadence;
  /** Expected firings per day at steady state */
  runs_per_day: number;
  /** Brief category for grouping in the UI */
  category:
    | "news"
    | "alerts"
    | "bills"
    | "legislators"
    | "donors"
    | "intel"
    | "research"
    | "meetings"
    | "discord"
    | "push"
    | "briefings"
    | "moderation"
    | "data-quality";
};

export const CRON_REGISTRY: CronEntry[] = [
  // ─── Vercel daily (unaffected by GH Actions billing) ─────────
  {
    source: "vercel_daily_sync",
    label: "Vercel daily-sync",
    purpose: "News RSS + OpenStates bills across all 50 states + DC",
    system: "vercel", cadence: "daily", runs_per_day: 1, category: "news",
  },
  {
    source: "reverify_local_officials",
    label: "Reverify local officials",
    purpose: "Re-check municipal-officials currency; flag stale rows",
    system: "vercel", cadence: "weekly", runs_per_day: 1 / 7, category: "legislators",
  },

  // ─── GH Hourly (cron-hourly.yml — every :00 + :30) ──────────
  {
    source: "fire_waves",
    label: "Fire scheduled waves",
    purpose: "Email/push fan-out for queued campaign waves",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "push",
  },
  {
    source: "sync_news_rss",
    label: "News RSS sync",
    purpose: "Fetch Google News RSS for every state + federal",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "news",
  },
  {
    source: "classify_news_policy",
    label: "Classify news → alerts",
    purpose: "AI classifies new news_items into policy_alerts",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "alerts",
  },
  {
    source: "push_critical_alerts",
    label: "Push critical alerts",
    purpose: "Web-push fan-out for newly-approved critical alerts",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "push",
  },
  {
    source: "push_state_news",
    label: "Push state news",
    purpose: "Push high-relevance state news to in-state users",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "push",
  },
  {
    source: "push_bill_actions_to_actors",
    label: "Push bill actions to actors",
    purpose: "Push bill_actions to users who took action on those bills",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "push",
  },
  {
    source: "auto_campaign_from_alert",
    label: "Auto-spawn campaigns",
    purpose: "Spawn solidarity campaigns from new actionable alerts",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "alerts",
  },
  {
    source: "promote_alert_to_bill",
    label: "Promote city-ord alerts → bills",
    purpose: "Promote municipal-ordinance alerts into bills rows",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "bills",
  },
  {
    source: "extract_local_meta",
    label: "Extract local event metadata",
    purpose: "Structured-event metadata from alerts",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "alerts",
  },
  {
    source: "seed_bill_officials",
    label: "Seed city-council slate",
    purpose: "Seed full city-council slate for new municipal bills",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "legislators",
  },
  {
    source: "auto_post_bills_to_forum",
    label: "Auto-post bills to forum",
    purpose: "Cross-post active anti/pro bills to state forums",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "bills",
  },
  {
    source: "sync_bills_legiscan_priority",
    label: "LegiScan priority sync",
    purpose: "Layer-2 sync of currently-active anti bills",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "bills",
  },
  {
    source: "post_bill_alerts_to_discord",
    label: "Discord bill-alert posts",
    purpose: "Post critical bill alerts to configured Discord webhooks",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "discord",
  },
  {
    source: "fanout_bill_reminders",
    label: "Bill subscription fan-out",
    purpose: "Notify users who subscribed to specific bills",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "push",
  },
  {
    source: "extract_bills_from_alerts",
    label: "Extract bill numbers from alerts",
    purpose: "Auto-promote bill mentions in alerts/news to bills rows",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "bills",
  },
  {
    source: "fire_custom_reminders",
    label: "User custom reminders",
    purpose: "Fire user-set reminders (meeting watch, deadline, etc.)",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "push",
  },
  {
    source: "scrape_protectkratom_org",
    label: "Scrape protectkratom.org",
    purpose: "Scrape AKA's state-by-state alert pages",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "alerts",
  },
  {
    source: "correlate_news_to_bills",
    label: "Correlate news → bills (regex)",
    purpose: "Match news_items to bills via regex on bill numbers",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "news",
  },
  {
    source: "resolve_news_urls",
    label: "Resolve news redirect URLs",
    purpose: "Resolve Google News redirect URLs to publisher URLs",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "news",
  },
  {
    source: "verify_news_body",
    label: "Verify news article bodies",
    purpose: "Verify article bodies for false-positive defense",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "news",
  },
  {
    source: "extract_news_content",
    label: "Extract article body + media",
    purpose: "Fetch publisher article → body paragraphs + embedded media (gates /news visibility)",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "news",
  },
  {
    source: "summarize_news",
    label: "Summarize fresh articles",
    purpose: "AI 2-3 sentence summary for each classified article",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "news",
  },
  {
    source: "generate_news_digest",
    label: "Generate in-app news digest",
    purpose: "Original AI write-up so the full story reads in-app (copyright-safe)",
    system: "gh-hourly", cadence: "every-30min", runs_per_day: 48, category: "news",
  },

  // ─── GH Daily (cron-daily.yml — once per day) ──────────────
  // verify_bill_status_ai RETIRED 2026-06-11 (de-Gemini policy) — entry removed
  // 2026-07-16 so /admin/automation stops showing a forever-silent phantom row.
  {
    source: "auto_resolve_sync_discrepancies",
    label: "Auto-resolve sync discrepancies",
    purpose: "Resolve sync issues that don't need admin review",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "data-quality",
  },
  {
    source: "sync_legislator_donors",
    label: "OpenFEC donor sync",
    purpose: "Sync 50 most-stale federal legislators' OpenFEC profiles",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "donors",
  },
  {
    source: "classify_donor_industries",
    label: "Classify donor industries",
    purpose: "Pattern-match donor employers into substance-adjacent industries",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "donors",
  },
  {
    source: "sync_bill_sponsors",
    label: "Backfill bill sponsorships",
    purpose: "Sync sponsorship rows across all states",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "bills",
  },
  // sync-stock-act-trades.mjs writes TWO sources (one per data mirror) — the
  // old single "sync_federal_trades" entry matched neither (phantom, 2026-07-16).
  {
    source: "senate_stock_watcher",
    label: "Federal STOCK Act trades (Senate)",
    purpose: "Sync Senate personal-trades data for federal legislators",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "donors",
  },
  {
    source: "house_stock_watcher",
    label: "Federal STOCK Act trades (House)",
    purpose: "Sync House personal-trades data for federal legislators",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "donors",
  },
  {
    source: "sync_lda_kratom",
    label: "Senate LDA kratom filings",
    purpose: "Sync kratom-mentioning Senate lobbying disclosures",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "intel",
  },
  {
    // Renamed from phantom "scrape_bop_findings" — matches the writer added
    // to scripts/scrape-bop-browser.mjs (2026-07-16).
    source: "bop_browser_scrape",
    label: "Scrape BoP findings (browser)",
    purpose: "Headless-Chrome scrape of TLS-blocked Board of Pharmacy sources",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "intel",
  },
  {
    source: "parse_bop_pdfs",
    label: "Parse BoP PDFs",
    purpose: "Download + parse PDFs from BoP findings",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "intel",
  },
  {
    source: "classify_bop_findings_ai",
    label: "AI-classify BoP findings",
    purpose: "Gemini-grounded classification of recent BoP findings",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "intel",
  },
  {
    source: "usaspending",
    label: "USAspending kratom awards",
    purpose: "Sync federal grants + contracts mentioning kratom",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "intel",
  },
  {
    source: "regulations.gov",
    label: "Federal rulemaking sync",
    purpose: "Sync FDA/DEA/HHS rulemaking + open public comment periods",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "intel",
  },
  {
    source: "courtlistener",
    label: "CourtListener cases",
    purpose: "Sync industry lawsuits + state-ban court challenges",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "intel",
  },
  {
    source: "extract_local_vote_outcomes",
    label: "Derive local vote outcomes",
    purpose: "Restructure city/county kratom vote results from alerts → local_vote_outcomes",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "meetings",
  },
  {
    source: "scrape_utah_lobbyist_registry",
    label: "Utah lobbyist registry",
    purpose: "Scrape Utah's public lobbyist registry (Mac Haddow et al.)",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "intel",
  },
  {
    source: "generate_state_briefing",
    label: "Regenerate state briefings",
    purpose: "Regenerate all 50 + DC state briefings",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "briefings",
  },
  {
    source: "audit_briefings_self_critique",
    label: "Audit + heal briefings",
    purpose: "Audit briefings flagged by self-critique",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "briefings",
  },
  {
    source: "intel_coverage_matrix",
    label: "Intel coverage audit",
    purpose: "Cross-check coverage gaps across the intel matrix",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "intel",
  },
  {
    source: "daily_data_quality",
    label: "Daily data-quality cleanup",
    purpose: "Trim stale rows, fix sync inconsistencies",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "data-quality",
  },
  {
    source: "daily_stale_campaign_cleanup",
    label: "Stale-campaign + alert cleanup",
    purpose: "Dedup orphan auto-campaigns, retire campaigns/alerts whose bill is dead/enacted",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "data-quality",
  },
  {
    source: "sync_committees_openstates",
    label: "Sync committees (OpenStates)",
    purpose: "Sync committee assignments across all 51 states",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "legislators",
  },
  {
    source: "draft_legislator_stance",
    label: "Draft legislator stances",
    purpose: "AI-draft stance profiles across all 51 states",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "legislators",
  },
  {
    source: "discover_municipal_meetings",
    label: "Discover municipal meetings",
    purpose: "Discover kratom-relevant local meetings across all 51 states",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "meetings",
  },
  {
    source: "recheck_watchlist_meetings",
    label: "Re-check watchlist bodies",
    purpose: "Re-check watchlist bodies for upcoming kratom agendas",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "meetings",
  },
  {
    source: "fire_meeting_reminders",
    label: "Fire meeting reminders",
    purpose: "Fire 7d/3d/1d reminders for upcoming meetings",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "meetings",
  },
  {
    source: "fire_voting_reminders",
    label: "Fire voting reminders",
    purpose: "Fire 30d/7d/1d reminders before primaries + the general (geofenced)",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "push",
  },
  {
    source: "scan_legistar_tenants",
    label: "Scan Legistar tenants",
    purpose: "Scan major-city Legistar tenants for kratom agenda items",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "meetings",
  },
  {
    source: "scan_granicus_tenants",
    label: "Scan Granicus tenants",
    purpose: "Scan major-city Granicus tenants for kratom agendas",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "meetings",
  },
  {
    source: "discover_legistar_tenants",
    label: "Discover Legistar tenants",
    purpose: "Probe gazetteer-derived slugs to expand keyless Legistar officials coverage (de-Gemini)",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "legislators",
  },
  {
    source: "auto_fulfill_local_reps",
    label: "Auto-fulfill local reps (cloud + box)",
    purpose: "Drain pending local-rep requests via SearXNG + free-tier extract. Primary: GitHub Actions (cron-localreps-cloud.yml) every 6h + on-demand — in-job SearXNG container + headless Chromium, no box dependency. Owner box nightly is the fallback.",
    system: "gh-daily", cadence: "daily", runs_per_day: 4, category: "legislators",
  },
  {
    source: "sync_research_pubmed",
    label: "PubMed research sync",
    purpose: "Sync new peer-reviewed kratom research from PubMed",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "research",
  },
  {
    source: "evaluate_research_papers",
    label: "AI-evaluate research papers",
    purpose: "AI evaluation of fresh peer-reviewed papers",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "research",
  },
  {
    source: "align_bills_to_research",
    label: "Bill ↔ research alignment",
    purpose: "Cross-reference bills to relevant research papers",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "research",
  },
  {
    source: "sync_bills_legiscan_all",
    label: "LegiScan full sweep",
    purpose: "Full LegiScan sweep across all active anti + pro bills",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "bills",
  },
  {
    source: "openstates_vote_sync",
    label: "OpenStates vote sync",
    purpose: "Fallback OpenStates vote sync (~50 bills/day budget)",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "bills",
  },
  {
    source: "backfill_current_committee",
    label: "Backfill current committee",
    purpose: "Backfill bills.current_committee_name from last_action",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "bills",
  },
  {
    source: "index_legislator_news_mentions",
    label: "Index legislator news mentions",
    purpose: "Index per-legislator name mentions in news_items",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "news",
  },
  {
    source: "ai_correlate_news_to_bills",
    label: "AI correlate news → bills",
    purpose: "AI-correlate unmatched news to bills (semantic match)",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "news",
  },
  {
    source: "feed_news_from_alerts",
    label: "Seed /news from alerts",
    purpose: "Seed + link /news entries for alerts that cite a real news article but aren't in /news yet",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "news",
  },
  {
    source: "detect_bill_clusters",
    label: "Detect coordinated operations",
    purpose: "Cluster active bills into coordinated-operation groups",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "intel",
  },
  {
    source: "re_enrich_stale_bill_journeys",
    label: "Re-enrich stale bill journeys",
    purpose: "Re-run journey enrichment on stale + recently-cleared bills",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "bills",
  },
  {
    source: "fire_daily_brief_push",
    label: "Daily brief push delivery",
    purpose: "Generate + push the daily brief to opted-in users",
    system: "gh-daily", cadence: "daily", runs_per_day: 1, category: "push",
  },

  // ─── GH Weekly (cron-weekly.yml) ────────────────────────────
  {
    source: "weekly_committee_sync",
    label: "Weekly committee sync",
    purpose: "Sync committees across all 50 + DC",
    system: "gh-weekly", cadence: "weekly", runs_per_day: 1 / 7, category: "legislators",
  },
  {
    source: "sync_nonprofit_990s",
    label: "Nonprofit 990 filings",
    purpose: "Sync IRS 990 filings for tracked kratom-industry nonprofits",
    system: "gh-weekly", cadence: "weekly", runs_per_day: 1 / 7, category: "donors",
  },
  {
    source: "weekly_patch_note_draft",
    label: "Patch note draft",
    purpose: "Generate weekly patch note draft (7-day lookback)",
    system: "gh-weekly", cadence: "weekly", runs_per_day: 1 / 7, category: "moderation",
  },
  {
    source: "broadcast_whats_new",
    label: "Broadcast weekly digest",
    purpose: "Broadcast weekly digest to all opted-in users",
    system: "gh-weekly", cadence: "weekly", runs_per_day: 1 / 7, category: "push",
  },
  {
    source: "weekly_legislator_stance_all",
    label: "Weekly legislator stance pass",
    purpose: "Weekly stance-draft pass across all states",
    system: "gh-weekly", cadence: "weekly", runs_per_day: 1 / 7, category: "legislators",
  },

  // ─── DB triggers (real-time, no cron) ───────────────────────
  {
    source: undefined,
    label: "auto-campaign-on-alert trigger",
    purpose: "Postgres trigger: spawn campaign on actionable alert INSERT",
    system: "db-trigger", cadence: "realtime", runs_per_day: 0, category: "alerts",
  },
];

export function totalExpectedRunsPerDay(): number {
  return CRON_REGISTRY.reduce((sum, c) => sum + c.runs_per_day, 0);
}

export function blockedRunsPerDay(): number {
  return CRON_REGISTRY
    .filter((c) => c.system.startsWith("gh-"))
    .reduce((sum, c) => sum + c.runs_per_day, 0);
}

export function vercelRunsPerDay(): number {
  return CRON_REGISTRY
    .filter((c) => c.system === "vercel")
    .reduce((sum, c) => sum + c.runs_per_day, 0);
}

export function ghBlockedCount(): number {
  return CRON_REGISTRY.filter((c) => c.system.startsWith("gh-")).length;
}

export function vercelCount(): number {
  return CRON_REGISTRY.filter((c) => c.system === "vercel").length;
}

export function dbTriggerCount(): number {
  return CRON_REGISTRY.filter((c) => c.system === "db-trigger").length;
}
