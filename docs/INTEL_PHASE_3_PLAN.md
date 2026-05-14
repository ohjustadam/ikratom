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

## D2. State lobbying disclosure pilot — Utah first (~2 days)

**Path**: Build a single-state lobbying scraper for Utah, prove the pattern, then templatize.

**Why Utah first**:
1. LDS-network influence already documented (Bramble + Haddow + the 2026 Word of Wisdom stunt)
2. Per Courthouse News, Bramble received $137,500 from AKA + $968,845 from "The Center For Plant Science and Health" — but the Center is an AKA shell. Utah state lobbying registry should have direct AKA/CPSH disclosures filed by registered lobbyists. We can verify the payment chain and find OTHER paid state legislators.
3. Utah's state lobbyist registry is at https://lobbyist.utah.gov — public, free, structured.

**Output schema**: `state_lobbying_filings` table mirroring `lobbying_filings` (federal) shape:
- registrant_name, client_name, year, lobbyist names, issue, disclosed_amount, state
- Idempotent upserts on (state, registrant, year, lobbyist)
- Public-read RLS

**Effort**: ~2 days. After Utah, the script becomes a per-state adapter pattern (same way we did `scrape-bop.mjs`).

**Next states** after Utah pilot: FL (DeSantis + OPMS supply chain), NJ (most committee bills currently in our DB), CA (GKC's home state), TX (4-state KCPA wave).

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

## D4. Per-legislator news mentions (~1 day)

**Path**: We already have `news_items` table with 4,243 rows of kratom-related news. Add a per-legislator name-match indexer. Two-phase approach:

Phase 1 (this PR): Simple exact-full-name match against title + summary. Store hits in new `legislator_news_mentions` table (legislator_id, news_item_id, match_confidence, mention_context).

Phase 2 (next, AI-assisted): AI-extract quotes ("Senator X said Y about kratom") from article body. Append to legislator stance rationale.

**Honest limit**: Current news scrape is kratom-policy-focused, not per-legislator-focused. Most articles say "Tennessee lawmakers" not specific names. Phase 1 will populate sparsely. Phase 2 needs a different news source (per-legislator state press release scraper) to be useful.

**Effort**: Phase 1 = ~3 hours. Phase 2 = ~1-2 days + a new ingestion source.

---

## D5. Self-critique loop on AI outputs (per NY_INTEL_DEPTH item C, ~half day)

**Path**: Wrap `generate-state-briefing.mjs` in a critique loop. AI generates draft → second AI critiques ("did this miss any bills? Is leaf-vs-7-OH framing correct? Are claims unsourced?") → regenerate if flagged → ship best-of-N.

**Cost**: 2-3x more tokens per briefing. Well within free tier.

**Effort**: ~3 hours.

---

## D6. Vector memory + cross-state similarity (per NY_INTEL_DEPTH item B, ~1 day)

**Path**: Enable pgvector. Add embeddings column on `bills`, `news_items`, `state_briefings`. Use `mxbai-embed-large` via Ollama (free, local).

**Unblocks**:
- Cross-state bill similarity (MI introduces a bill → instantly see "87% match to TX HB 5 2024")
- Better dedup on news_items
- Briefing retrieval ("show me last month's briefing for the 3 states most similar to NY by bill landscape")

**Effort**: ~8 hours.

---

## D7. Self-improvement feedback loop (~6 hours)

**Path**: `ai_decisions` table logging every AI output + admin reaction (approved? edited? rejected?). Weekly script builds "common failure modes" report. Periodic prompt re-tuning.

---

## D8. Admin dashboards (~6 hours)

**Path**: `/admin/intel-health/states` already exists (per ROADMAP-NEWSROOM). Extend with:
- Briefing freshness per state (oldest = needs regen)
- Stance coverage per state
- Committee coverage per state
- Lobbying-filing volume per state
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
