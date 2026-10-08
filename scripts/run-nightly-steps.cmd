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

REM MOVED TO GITHUB ACTIONS (2026-09-07): steps 3, 4 and the review-queue
REM sweep now run in .github/workflows/cron-grounded-queues.yml twice a day
REM with an in-job SearXNG container:
REM   verify-local-bans, sweep-locality-intel, clear-review-queues.
REM They only ever lived here because SearXNG did, and this box had not run
REM them in 55-66 days. Do NOT re-add them: two schedulers racing the same
REM rows is worse than one that runs.

REM 5. State executives (PR-K): governors/lt-gov/AG/SoS from openstates/people
REM    (keyless public YAML) — fills the 5Calls gap. Self-gates to weekly.
node --env-file=.env.local scripts/sync-state-executives.mjs

REM 5b. Topic-bill discovery (phase 2): NON-kratom bills (cannabis/hemp/
REM    psychedelics/supplements/tobacco/alcohol) via LegiScan getSearch ->
REM    topic_bills, for the /topics explorer. ON THE BOX because LegiScan's
REM    query API refuses GitHub Actions datacenter IPs (verified 6/6 connect
REM    timeouts); the GHA "Topic classify" workflow handles the keyless tagging
REM    half. Self-gates to weekly + tiny (~36 calls, ~1 min) so it respects the
REM    box-CPU budget.
node --env-file=.env.local scripts/discover-topic-bills.mjs

REM MOVED TO GITHUB ACTIONS (2026-09-07): steps 6 and 7 — the dossier
REM deep-dive and the campaign auto-brief — now run as their own jobs in
REM .github/workflows/cron-nightly-cloud.yml. They used to require a local
REM hermes3:8b; scripts/lib/tool-chat.mjs now runs the same tool-calling loop
REM on local Ollama OR any free OpenAI-compatible provider, so they no longer
REM depend on this machine being awake. Ollama is still tried FIRST when it is
REM up, so running them here by hand costs nothing and uses no cloud quota.

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
