# Intel Network — Phase 3 Plan

> Strategic memo. The federal-side intel network is built (Phases 1 + 2):
> committee urgency, per-legislator briefings, Senate LDA filings, donor
> profiles, industry actor registry. Phase 3 fills in the gaps that
> currently leave us blind to the bigger half of kratom-industry political
> activity.
>
> Last updated 2026-05-14 by Claude.

---

## What we have today (Phases 1 + 2 — ✅ shipped)

| Capability | Source | Coverage |
|---|---|---|
| Committee urgency | OpenStates + LegiScan + parser | 30 of 467 active bills populated; OpenStates sync keeps fresh |
| Per-legislator briefing | Internal cross-reference | 8,273 legislators have a `/briefing` page; ~30 with rich intel today |
| Federal lobbying filings | Senate LDA REST API | 131 kratom-mentioning filings 2016 → 2026 |
| Industry actor registry | Editorial research with public sources | 34 named actors across 5 factions |
| Federal donor profiles | OpenFEC | 257 of 531 federal legislators (~50%) |
| Nonprofit 990 financials | ProPublica Nonprofit Explorer | AKA + GKC + (more on demand) |
| AI-drafted stance | Internal AI router + cron | 466 drafts across priority states (71 real-signal, 395 honest-unknown) |

## What we're blind to (Phase 3 targets)

| Gap | Scale of blind spot | Pipeline path |
|---|---|---|
| State-level lobbying spend | $4.4M+ over 5 years per AKA alone — bigger than federal | D3 below |
| Voting roll-call records | Every state senator/rep has a voting history we can't yet query | D1 below |
| Per-legislator news mentions | We have news_items but no per-legislator index | D5 below |
| Personal financial disclosures (federal STOCK Act) | Mullin-Botanic-Tonics pattern repeated for ~100 other reps | D4 below |
| Press releases / public statements | Each legislator's site has these; not scraped | D5 below |
| Industry-funded "research" | A Leaf of Faith pattern — research → doc → policy | Manual editorial, ongoing |
| Salt Lake City kratom summit + similar coordination events | Currently owner-testimony-only | Manual editorial, ongoing |

---

## D1. Voting roll-call sync (smallest viable Phase 3 unit, ~2 hours)

**Path**: Extend `scripts/sync-bills.mjs` to include `include=votes` field on OpenStates bill detail calls. Write to new `bill_votes` table (legislator_id, bill_id, vote, vote_date, chamber). Cross-reference on briefing.

**Unblocks**: "Sen. X voted YES on 2024 KCPA so she'll likely vote YES on 2026 bill" predictive intel. Updates the action plan to surface VOTE-history alongside stance.

**Migration needed**: `0126_bill_votes.sql` — schema for vote records.

**Status**: Ready to ship. No external API limits beyond OpenStates' existing free tier we're already inside.

---

## D2. State lobbying disclosure pilot — Utah ✅ SHIPPED 2026-05-14 (registrations layer)

**Status**: Utah lobbyist registry now scraped daily. 16 kratom-industry registrations captured today, 7 currently active. AKA hired three new lobbyists in January 2026 (Salmon, White, Clyde) — visible in the data, surfaced in the Utah briefing's Field-work section by name.

**What landed**:
- New table `state_lobbyist_registrations` — state-agnostic schema designed to absorb the FL/NJ/CA/TX adapters later. Captures lobbyist↔principal pairings + addresses + start/end dates.
- New scraper `scripts/scrape-utah-lobbying.mjs` parses the LobbyistByPrincipal HTML page (6,858 rows total, regex-filtered to 16 kratom-industry hits). Identifies itself with a custom UA; no auth required.
- Daily cron job runs the scraper before the state-briefing generator, so today's UT briefing reflects today's lobbyist roster. `generate-state-briefings` job now declares this dependency explicitly.
- Briefing generator pulls the registrations and renders them in a new "STATE LOBBYING REGISTRATIONS" section of the prompt. AI integrates them into the Field-work tactical paragraph by name.
- Admin page (`/admin/intel-health/states`) shows the "State lobbyists" count per state + a totals counter.

**Currently active kratom-industry lobbyists in Utah** (as of first scrape):
- American Kratom Association — 7 active: Mac Haddow (since 2017), Spencer Stokes (2021), Matt Holton (2022), Matthew Salmon (×2, Jan 2026), Eliana White (Jan 2026), Chase Clyde (Jan 2026). The three Jan 2026 hires constitute a hiring burst worth tracking.

**Honest limit**: Phase 1 captures the registration LAYER (who's hired by whom). It does NOT yet capture dollar amounts — those live behind Utah's Summary of Lobbyist Reports POST search and would need a separate scraper. Per Courthouse News, Bramble received $137,500 from AKA + $968,845 from "The Center For Plant Science and Health" — those numbers are visible on the financial-reports page, not the registry page. Phase 2 work.

**Next states** after Utah: FL (DeSantis + OPMS supply chain), NJ (committee-bill volume), CA (GKC's home state), TX (4-state KCPA wave). Schema is already state-agnostic — each new state just needs its own scraper adapter writing to the same table.

---

## D3. STOCK Act personal-investment disclosures (~3 days)

**Path**: Federal legislators file Periodic Transaction Reports (PTRs) for personal stock trades within 30 days. PDF format, public.

Two viable sources:
- **House Financial Disclosure Database**: https://disclosures-clerk.house.gov/PublicDisclosure/FinancialDisclosure (PDF download)
- **Senate Financial Disclosure**: https://efdsearch.senate.gov (PDF or text)
- **Third-party aggregator**: senate-stock-watcher / capitol-trades.com — both have downloadable CSV exports

**Schema**: `legislator_personal_trades` (legislator_id, ticker, transaction_type, amount_range, transaction_date, filing_date)

**Unblocks**: Surface trades that overlap with kratom industry interests — e.g., legislators trading pharma stocks while voting on kratom legislation. Mullin-Botanic-Tonics is the prototype.

**Effort**: ~3 days because of PDF parsing variation. **Recommend using the Senate Stock Watcher CSV** as the easier first pass — they've done the PDF parsing for us.

---

## D4. Per-legislator news mentions

### Phase 1 ✅ SHIPPED 2026-05-14

**Status**: Live in `scripts/index-legislator-news-mentions.mjs` + migration 0127. Briefing renders a "📰 News mentions" section between voting record and committee positions.

**Method**: Regex match each legislator's name (exact-full-name OR title+lastname like "Sen. Smith") against `news_items.title` / `summary` / `body_extract_excerpt`, state-scoped to reduce false positives. Lastnames under 4 chars use full-name pattern only (avoids "Lee" matching every actor named Lee). Patterns escape regex metas to handle names like "O'Brien".

**First-run results** (4,260 news_items × 8,273 active legislators, state-scoped):
- 85 matches across 12+ states. Top: **Sean Brennan (OH state house, 12 mentions)** — Ohio kratom-bill activity. **Ty Masterson (KS senate, 9)** — Senate President. **Anita Somani (OH state house, 7)**. **Pete Ricketts (NE US senate, 3)** — federal-side mention.
- Match rate 0.01% (85 of 727k pairs) — matches the prediction. Every match is high-signal because the news scrape is kratom-policy-tagged, so a name hit means that legislator is named in a kratom-policy article.

**Schema**: `legislator_news_mentions(id, legislator_id, news_item_id, match_confidence, matched_field, mention_context, created_at)` with `UNIQUE(legislator_id, news_item_id, matched_field)` for idempotency. Indexer is rerunnable; existing rows preserved via `ignoreDuplicates: true`.

**Render**: Briefing shows up to 10 articles newest-first, deduped by article (a name in both title + summary collapses to one card, preferring the title context). Each card shows outlet, date, the matched-field tag, and the ~120-char snippet.

### Phase 2 (deferred — needs new ingestion source)

AI-extract quotes ("Senator X said Y about kratom") from article body and append to legislator stance rationale. Real lift here requires a per-legislator press-release scraper — current news scrape is kratom-policy-focused not legislator-focused. Defer until a per-legislator news source lands.

---

## D5. Self-critique loop on AI outputs ✅ SHIPPED 2026-05-14

**Status**: Live in `scripts/generate-state-briefing.mjs`. Default on (1 critique pass). CLI flags: `--no-critique` to disable, `--max-revisions N` (capped at 3) to allow more rounds.

**How it works**:
1. AI generates a state briefing draft (existing flow).
2. **Critic** — `openai/gpt-oss-120b` via Groq (a reasoning-capable open-weights model; emits `reasoning_tokens` internally) — reads the draft against the source data and returns `{needs_revision, issues[], suggestions[]}`. Critic checks for missing bills, kratom-vs-7-OH conflation, sponsor accuracy, unsourced claims, generic field-work boilerplate, and unacknowledged data gaps.
3. If `needs_revision`, regenerate once with the critique appended to the prompt; if the revision is shorter than half the original or under 1500 chars (a stub), keep the prior draft.
4. Provenance (issues caught, revisions applied) lands in `state_briefings.data_snapshot.critique` for audit.

**Model history note**: Originally targeted `deepseek-r1-distill-llama-70b` via Groq. Groq decommissioned that model 2026-04 (see https://console.groq.com/docs/deprecations). Swapped to GPT-OSS-120B — equivalent reasoning depth, also free on Groq, also MIT-licensed open weights. Privacy posture unchanged: DeepSeek's hosted API stays banned (`tests/ai-router-routing.test.ts` enforces this at the type level).

**Real-world validation**: On the NY briefing the critic caught five concrete issues on the first run, including the omission of an enacted anti-kratom bill (S 8814, Patricia Fahy), the conflation of 7-OH-only bills with natural-leaf kratom bans, and an unsourced warning-label claim attributing a bill to no sponsor.

**Cost**: ~one extra Groq call per briefing (free tier; 400ms-2s latency). When all cloud providers are saturated, the loop fails open — ships the original draft as-is rather than block.

---

## D6. Vector memory + cross-state similarity ✅ SHIPPED 2026-05-14

**Status**: Embeddings live for 467 active bills + 51 state briefings. `/bills/[id]` renders a "🔗 Similar bills in other states" section showing the top 5 cross-state matches above a 60% threshold. Empirically tuned: KCPA matches land at 62-69%, going below 55% surfaces noise.

**What landed**:
- Migration 0131 adds `embedding jsonb` + `embedded_at timestamptz` to `bills` and `state_briefings`. Matches the pattern from migration 0019 (news_items) — jsonb not pgvector. At <500 active bills, cosine similarity in application JS is fine (<50ms per query).
- `scripts/compute-bill-embeddings.mjs` runs locally against Ollama `nomic-embed-text` (768-dim float). Idempotent (skips already-embedded rows unless `--refresh`). 518 rows embedded in 88 seconds.
- `src/lib/bill-similarity.ts` — pure-JS cosine + `findSimilarBills()` helper. Excludes same-state by default (the killer query is cross-state coalition detection).
- `/bills/[id]` page renders the similarity section after Full bill text, defensively wrapped so pre-migration deploys fall back to empty silently.

**Real-world validation (SC S 221 = "South Carolina Kratom Consumer Protection Act")**:
- 69% MO SB 504 (KCPA)
- 68% MO SB 774 (KCPA)
- 64% IL SB 3948 (KRATOM CONSUMER PROTECTION)
- 63% IL HB 2868 + KS HB 2230 (KCPA)
- 62% NE LB 230 (KCPA)

This is the AKA's **KCPA template wave** rolling across 6+ states with near-identical text — exactly the coalition pattern we wanted to make visible. Pattern detection that previously required editorial intuition is now a one-page-click.

**Honest limits**:
- Embeddings have to be recomputed when bill text changes. Currently maintainer-run (Ollama is local-only) — no cron because Ollama isn't available in CI. Run after major bill sync jobs.
- News-item embeddings already existed (migration 0019) and are kept on a separate dedup path; we did NOT touch them.
- A future Phase 4 expansion could use the briefing embeddings ("show me states most similar to NY by overall policy landscape") — schema is in place, query helper not yet written.

---

## D7. Self-improvement feedback loop

### D7 first slice ✅ SHIPPED 2026-05-14

**Status**: Live in `scripts/audit-state-briefings.mjs`. Detects active briefings where D5's self-critique flagged issues that the revision pass couldn't resolve, plus data drift on uncapped counters, plus staleness, plus low-quality length. Optional `--auto-regen` flag invokes `generate-state-briefing.mjs --state X` per flagged state for self-correction.

**Why it's needed**: the daily cron blindly regenerates all 51 briefings on a 24h schedule. That catches staleness but misses critique-blocked revisions — when the critic flagged real issues but the revision attempt failed (rate-limit, schema-fragment stub, provider saturation), the briefing went live with known-bad content. `data_snapshot.critique.history` from D5 captured this; nothing acted on it. Now the audit does.

**Flagging rules**:
- `critique flagged N issue(s), revision blocked (REASON)` — the highest-signal failure mode
- `stale (Xd old)` — older than `--max-age-days` (default 7)
- `low quality (X chars < 2000)` — body shorter than `--min-body-chars`
- `data drift X% (legCount:A→B)` — uncapped counter changed by >= `--drift-pct` (default 30%). Restricted to `legCount`, `bopSrcCount`, `campActiveCount`. The generator caps bill/news loads at 30/10 rows for prompt-budget reasons, so `billCount` / `newsCount` saturate and aren't reliable drift signals.

**First-run results**: 1/51 briefings flagged — NY had a critique-blocked revision (the one I manually restored earlier in the D5 ship) and a real BoP-source drop (3→0) worth investigating editorially.

### D7 Phase 2 (deferred)

Broader `ai_decisions` table logging every AI output + admin reaction (approved? edited? rejected?). Weekly script builds "common failure modes" report. Periodic prompt re-tuning. Defer until we have admin-visible regen / approve / reject UI in /admin/intel-health.

---

## D8. Admin dashboards ✅ SHIPPED 2026-05-14 (first slice)

**Status**: `/admin/intel-health/states` extended with the new D5/D4/D7 telemetry. Briefing freshness, news mentions, and audit flags surface inline per state.

**What landed**:
- Two pre-existing bugs fixed on the page: `published_at` (column doesn't exist; renamed to `generated_at`) and missing `.eq("is_active", true)` on `state_briefings` (the table stacks old rows, so the page was previously picking arbitrary briefings).
- Per-state card now shows: news mentions count (D4), critique status from `data_snapshot.critique` (D5), and inline audit flags from the same logic the D7 script uses (stale / low-quality / critique-blocked / no-briefing).
- Flagged states get red border + "needs regen" label so they jump out of the grid.
- Top-line stats add "News mentions" and "Briefings flagged" counters.
- Audit reasons computed inline rather than shelling out to the script — same logic, no extra IO.

**Remaining for D8 expansion** (deferred until needed):
- Stance coverage per state
- Committee coverage per state
- Lobbying-filing volume per state (depends on D2 Utah pilot to seed the table)
- Per-actor coverage gaps

---

## Recommended near-term sequence

**Sprint 1 (~3 hours)**: D1 voting records — smallest valuable unit. Migration + script + briefing display.

**Sprint 2 (~2 days)**: D2 Utah state-lobbying pilot. Prove the pattern. After Utah is green, choose next state.

**Sprint 3 (~half day)**: D5 self-critique loop. Quality lift on every briefing.

**Sprint 4 (~1 day)**: D4 Phase 1 news mentions. Quick win, sparse but free.

**Sprint 5 (~3 days)**: D3 STOCK Act trades via Senate Stock Watcher CSV.

**Sprint 6 (~1 day)**: D6 vector memory + cross-state similarity.

**Sprint 7 (~6 hours)**: D7 self-improvement feedback loop.

**Sprint 8 (~6 hours)**: D8 admin dashboards.

After all 8 sprints, the federal+state intel network is at parity with what a small DC research firm would deliver. Each sprint is independently shippable — no dependencies block the next.

---

## What's deliberately NOT in Phase 3

- **Cross-state bill text plagiarism detection** (Phase 4) — fingerprint state KCPA bills to confirm common authorship; depends on vector memory (D6) being live
- **Per-state Form 990 nonprofit tracking** (Phase 4) — every state has 501(c)(4) advocacy orgs; per-state IRS work; high-effort
- **Foreign Agents Registration Act (FARA) tracking** — Indonesian kratom supply chain implies possible foreign-entity influence; FARA filings would catch any retained foreign clients
- **Political ad-spend tracking** — Facebook Ad Library API exists; per-legislator ad spend on kratom topics
- **Coalition-mapping tooling** — when a new advocacy org appears (like Stop Gas Station Heroin LLC), automatically pull its public records into the registry

These remain on the radar but deferred until Phase 3 sprints land.

---

## Sustained editorial work (parallel to all sprints)

- New actors enter the registry as named in published investigations
- AKA Form 990 officer names from ProPublica detail endpoint
- Salt Lake City kratom summit — owner-source the organizer / sponsor / attendees so we can move that line item from owner-testimony to documented
- Vernon Jones' post-legislator activities (he's now a private citizen advocating across states)
