@echo off
REM run-nightly-steps.cmd — the nightly job steps, COMMITTED to the repo so
REM bolt-ons ship via git pull. DEPLOYMENT: the box shim at
REM C:\claude\ikratom-runner\run-nightly.cmd MUST be updated (once) to
REM `call scripts\run-nightly-steps.cmd` after its git pull + npm install —
REM until then steps 3-4 below run nowhere.
REM
REM Runs on the owner box where SearXNG (localhost:8080) + Ollama
REM (localhost:11434) live. Every step writes scraper_runs telemetry and is
REM registered in check-cron-staleness (system "local-box"). Each step is
REM independent: a failure falls through to the next (the cmd shim logs all
REM output; scripts self-report fail status in telemetry).

REM 1. Grow the keyless Legistar Tier-1 (+ revalidate pre-gate cache rows).
node --env-file=.env.local scripts/discover-legistar-tenants.mjs --limit 300

REM 2. Drain pending local-rep requests (SearXNG + Ollama/free-tier).
node --env-file=.env.local scripts/auto-fulfill-pending-local-reps.mjs

REM 3. Re-confirm HELD local kratom bans (two-source gate, keyless — PR-A).
node --env-file=.env.local scripts/verify-local-bans.mjs --limit 60

REM 4. Unified locality-intelligence sweep (law + pending measures + links).
node --env-file=.env.local scripts/sweep-locality-intel.mjs --limit 20
