@echo off
REM run-nightly-steps.cmd — the nightly job steps, COMMITTED to the repo so
REM bolt-ons ship via git pull. The box shim C:\claude\ikratom-runner\
REM run-nightly.cmd does: git pull --ff-only -> npm install -> call this file.
REM
REM Runs on the owner box where SearXNG (localhost:8080) + Ollama
REM (localhost:11434) live. Every step writes scraper_runs telemetry and is
REM registered in check-cron-staleness (system "local-box"). Each step is
REM independent: a crash falls through to the next (the shim logs all output;
REM scripts self-report fail status in telemetry).
REM
REM ORDER (set 2026-06-10 by the first-armored-run audit): the BOUNDED,
REM high-value steps run FIRST so the flagship dossier + the fresh session
REM brief complete in the first ~90 minutes regardless of backlog depth. The
REM UNBOUNDED bulk drains (summaries -> translations -> embeddings) run LAST
REM as the overnight tail, where multi-hour runtime is harmless. Every heavy
REM step now carries a count cap and/or a --max-minutes wall-clock budget so
REM the box CPU can never stay pinned into the owner's workday.

REM ---- High-value, bounded (finish by early morning) ----

REM MOVED TO GITHUB ACTIONS (Phase 1 offload, 2026-06-12 — protect the box):
REM   discover-legistar-tenants, fetch-bill-texts, classify-bill-substance,
REM   sync-bills-via-legiscan --all-anti, sync-state-executives,
REM   summarize-news. See .github/workflows/cron-nightly-cloud.yml (08:30
REM   UTC). The box keeps ONLY SearXNG/Ollama-dependent + local-file steps.

REM 2. Drain pending local-rep requests (SearXNG + Ollama/free-tier). Bounded
REM    so a deep queue can't starve the rest of the run.
node --env-file=.env.local scripts/auto-fulfill-pending-local-reps.mjs --limit 40 --max-minutes 30

REM 3. Re-confirm HELD local kratom bans (two-source gate, keyless — PR-A).
node --env-file=.env.local scripts/verify-local-bans.mjs --limit 60 --max-minutes 60

REM 4. Unified locality-intelligence sweep (law + pending measures + links).
node --env-file=.env.local scripts/sweep-locality-intel.mjs --limit 20 --max-minutes 30

REM 5. State executives (PR-K): governors/lt-gov/AG/SoS from openstates/people
REM    (keyless public YAML) — fills the 5Calls gap. Self-gates to weekly.
node --env-file=.env.local scripts/sync-state-executives.mjs

REM 6. THE DOSSIER (flagship Phase 1): Hermes deep-dives ONE target per night
REM    through the verified corpora into the admin-only dossiers table (0195).
REM    Bounded by MAX_TURNS; aborts fast if 0195 isn't applied. Human review
REM    gates any publish.
node --env-file=.env.local scripts/dossier-research.mjs --auto

REM 7. Hermes auto-brief: research briefings for newly auto-approved campaigns
REM    (PR-E; hermes3:8b). 10-min per-campaign hang guard, 3 per night.
node --env-file=.env.local scripts/auto-brief-campaigns.mjs --limit 3

REM 8. Session prep (PR-F): regenerate the codebase map + state snapshot into
REM    the WORKING checkout's private/session-prep/ so the owner's next Claude
REM    session cold-starts from a fresh brief. Runs before the bulk tail so the
REM    brief is ready first thing.
node scripts/generate-codebase-map.mjs --out C:\claude\ikratom\private\session-prep\CODEBASE_MAP.md
node --env-file=.env.local scripts/generate-state-snapshot.mjs --out C:\claude\ikratom\private\session-prep\STATE_SNAPSHOT.md

REM ---- Unbounded bulk drains (the overnight tail; overrun is harmless here) ----

REM 9. Backlog drains (PR-D). summarize-news MOVED to the GHA cloud chassis
REM    (it runs cloud providers anyway; translations+embeddings stay — they
REM    need local Ollama models). GHA runs at 08:30 UTC = before this tail on
REM    most nights, so summary_ai is fresh for translate.
node --env-file=.env.local scripts/translate-content.mjs --model llama3.2:3b --limit 50 --max-minutes 45
node --env-file=.env.local scripts/compute-bill-embeddings.mjs --limit 500
