// cron-pager-registry.mjs — THE canonical source list for the self-pager
// (check-cron-staleness.mjs). Extracted from an inline block on 2026-07-16 so
// tests/cron-pager-registry.test.ts can statically assert that EVERY source
// registered here is actually written by some script/route (and flag phantom
// entries that fake coverage). The hand-maintained inline mirror is exactly
// how the verify_news_body cadence bug + three phantom weekly sources crept in.
//
// Format: { source, interval_hours, system, cadence }. `source` must match the
// EXACT string the producing script writes to scraper_runs.source — NOT the
// workflow step name. A source past 3× interval_hours pages the owner.
export const REGISTRY = [
  // hourly-class (cron-hourly.yml; cadence widened to 2h during the 2026-07
  // egress diet — 4h registered interval → 12h silent threshold still fits)
  ...["sync_news_rss","classify_news_policy","push_critical_alerts","push_state_news",
      "scrape_protectkratom_org","correlate_news_to_bills","auto_campaign_from_alert",
      "promote_alert_to_bill","extract_local_meta","seed_bill_officials",
      "auto_post_bills_to_forum","sync_bills_legiscan_priority","post_bill_alerts_to_discord",
      "push_bill_actions_to_actors","resolve_news_urls",
      // fire_waves = /api/cron/fire-waves — the SOLE push/email delivery path.
      "fire_waves",
      "fanout_bill_reminders",
      // The durable send queue's worker. If this goes silent, users' queued
      // campaign email stops leaving and NOTHING else notices — the batches
      // just sit at "sending" forever. interval 4h against a 2h cadence.
      "drain_send_batches",
      "dedupe_news_by_title",
      "extract_news_officials",
      "extract_news_events",
      "auto_approve_meetings",
      "auto_approve_campaigns",
      // Registered 2026-07-16 (audit): user-facing hourly automations that
      // previously wrote no telemetry — a silent death was undetectable.
      "fire_custom_reminders",
      "extract_bills_from_alerts",
      // Registered 2026-07-22: the HOSTING failsafe. check-egress-usage watched
      // Supabase bandwidth and reported "healthy" while Vercel's CPU meter sat
      // at 301% and the site served 402 for ~18h. This one checks the live URL
      // itself, so it catches causes we haven't instrumented — including the
      // next unknown one. Hourly because an outage found a day later is an
      // outage nobody caught.
      "vercel_watchdog",
     ].map((source) => ({ source, interval_hours: 4, system: "gh-hourly", cadence: "every-2h" })),

  // daily
  // verify_bill_status_ai RETIRED 2026-06-11 (de-Gemini/free-tier policy).
  ...["auto_resolve_sync_discrepancies","sync_legislator_donors",
      "sync_bill_sponsors","sync_bills_legiscan_all","sync_lda_kratom",
      "usaspending","regulations.gov","courtlistener",
      "senate_stock_watcher","house_stock_watcher",
      "generate_state_briefing",
      "sync_committees_openstates","draft_legislator_stance",
      "discover_municipal_meetings","fire_meeting_reminders","fire_voting_reminders",
      "scan_legistar_tenants","scan_granicus_tenants","sync_research_pubmed",
      "align_bills_to_research",
      "openstates","detect_bill_clusters",
      "classify_bill_substance",
      "derive_state_status",
      "sync_legistar_officials",
      "discover_legistar_tenants",
      "fire_daily_brief_push",
      "render_daily_brief_audio",
      "extract_news_content",
      "summarize_news",
      "generate_news_digest",
      "feed_news_from_alerts",
      // Runs DAILY (was mis-registered hourly → daily cry-wolf; fixed #817).
      "verify_news_body",
      "queue_due_state_flips",
      "daily_stale_campaign_cleanup",
      "cleanup_pending_campaigns",
      "reject_wrongstate_pending_alerts",
      "dedupe_pending_alerts",
      "expire_rotating_campaigns",
      "locality_state_audit",
      "review_lapsed_items",
      "sync_legislative_sessions",
      // Fact-integrity watchdog (added after the 2026-08-28 false-ban incident):
      // cross-checks published federal scheduling claims against the Federal
      // Register. Silent = nothing is checking our facts but our readers.
      "audit_federal_claims",
      // Moved off the owner's PC to GitHub Actions 2026-09-05 — it is a cloud
      // daily now, not a local-box source. Was silent 53 days.
      "translate_content",
      // Repairs alert source_url from resolved news URLs; the auto-approver's
      // require_source gate depends on it (2026-09-05).
      "backfill_alert_source_urls",
      // Registered 2026-07-16 (audit): the OpenStates bill sweep is the ONLY
      // last_action refresher for non-LegiScan bills (all NY bills) but wrote
      // no telemetry of its own — the shared "openstates" label stayed fresh
      // via sibling scripts, masking a dead sweep.
      "openstates_bill_sweep",
      // Playwright BoP subset (KS/NH/MA/AR) — no independent signal before.
      "bop_browser_scrape",
      // BoP pipeline layers + intel scrapers given writers 2026-07-16 (were
      // cron-registry phantoms writing nothing).
      "parse_bop_pdfs",
      "classify_bop_findings_ai",
      "classify_donor_industries",
      "scrape_utah_lobbyist_registry",
      // The never-restricted-again failsafe: daily egress budget check that
      // pages the owner at 50/75/90% of the free-tier 5GB (2026-07-16 incident).
      "egress_watchdog",
     ].map((source) => ({ source, interval_hours: 36, system: "gh-daily", cadence: "daily" })),

  // weekly
  // The weekly committee-sync + stance jobs write the SAME sources as their
  // daily counterparts (monitored above). The old weekly-only phantom names
  // were removed 2026-07-16 — no script ever wrote them.
  ...["sync_nonprofit_990s","broadcast_whats_new","official_portraits_sync",
      "state_portraits_bulk","bill_topics_classify",
      // Wayback portrait recovery (portrait-sync.yml) — was unregistered.
      "portraits_wayback",
     ].map((source) => ({ source, interval_hours: 216, system: "gh-weekly", cadence: "weekly" })),

  // vercel (different system, but still monitorable)
  // Re-homed 2026-07-26 (Vercel → Netlify migration): declared in vercel.json
  // "crons", which only Vercel ran. Now an HTTP step in cron-daily.yml. The
  // source string is unchanged (the route writes it); only the system label
  // moved — mislabelling would send a future debugger to the wrong platform.
  { source: "reverify_local_officials", interval_hours: 36, system: "gh-daily", cadence: "daily" },
  // `vercel_daily_sync` REMOVED 2026-07-26 — deliberately no longer invoked.
  // /api/cron/daily-sync can't finish inside Netlify's 30s function budget
  // (verified: 502), and its work is already done by sync-news-rss.mjs +
  // sync-bills*.mjs as node scripts. Keeping it registered would make the
  // self-pager cry wolf forever about a source nothing writes — exactly the
  // "phantom source" class this registry + its CI guard exist to prevent.

  // Long-tail officials drain (GHA q6h + owner-box nightly fallback).
  { source: "auto_fulfill_local_reps", interval_hours: 12, system: "github-actions", cadence: "daily" },
  // Owner-box nightly (SearXNG/Ollama-dependent).
  { source: "verify_local_bans", interval_hours: 72, system: "local-box", cadence: "daily" },
  { source: "sweep_locality_intel", interval_hours: 72, system: "local-box", cadence: "daily" },
  { source: "clear_review_queues", interval_hours: 72, system: "local-box", cadence: "daily" },
  { source: "topic_bill_discovery", interval_hours: 216, system: "local-box", cadence: "weekly" },
  { source: "auto_brief_campaigns", interval_hours: 72, system: "local-box", cadence: "daily" },
  { source: "session_prep", interval_hours: 72, system: "local-box", cadence: "daily" },
  { source: "bill_embeddings", interval_hours: 72, system: "local-box", cadence: "daily" },
  { source: "dossier_research", interval_hours: 72, system: "local-box", cadence: "daily" },
  // Nightly cloud chassis (cron-nightly-cloud.yml @ 08:30 UTC).
  { source: "state_executives_sync", interval_hours: 216, system: "github-actions", cadence: "weekly" },
  { source: "fetch_bill_texts", interval_hours: 72, system: "github-actions", cadence: "daily" },
  { source: "sync_elections", interval_hours: 216, system: "github-actions", cadence: "weekly" },
  { source: "extract_local_vote_outcomes", interval_hours: 72, system: "github-actions", cadence: "daily" },
];
