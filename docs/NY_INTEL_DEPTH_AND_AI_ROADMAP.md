# NY intel depth + AI / self-healing roadmap

> Strategic memo. NY is the model state. Whatever picture we paint here
> becomes the template applied to all 50 + DC. This doc tracks (1) what
> NY is still missing to be "CIA/FBI-grade" and (2) the next-level
> tools — local agents, vector memory, MCP servers, self-critique
> loops — that we should pull into the toolbelt.

## Where NY stands today (after PR #155)

| Layer | Status | Coverage |
|---|---|---|
| State legislators | ✅ Complete | 241 (150 Assembly · 63 Senate · 26 US House · 2 US Senate). 0 missing contact info. 0 stale. |
| Active bills | ✅ Tracked | 38 (19 anti · 18 pro · 1 neutral) |
| **Bill sponsors** | ✅ **NEW** | **149 sponsor rows across 38 bills; 146 matched to legislator records (98%)** |
| **BoP regulatory sources** | ✅ **NEW** | **3 configured: NYSED Office of Professions (Pharmacy Board), NY Dept of Health, plus the legacy "NY Board of Pharmacy" row** |
| **Capital + access metadata** | ✅ **NEW** | **Capital building address, session dates, public-comment URL, scheduler directory, admin field-work notes** |
| News (verified, last 30d) | ✅ Tracked | 21 active · 15 visible canonical |
| Campaigns | ✅ Tracked | 5 active · 3 pending |
| Briefing | ✅ AI-generated | Now names primary sponsors per bill, references capital metadata verbatim |

## What NY (and therefore every state) is still missing

These gaps fall into **5 tiers**, ordered by leverage and effort.

### Tier 1 — Committee structure (high leverage, medium effort)

The single biggest gap. Bills die in committees, so the chairs of
Health / Codes / Consumer Affairs / Public Safety committees are the
**actual** decision-makers on kratom legislation. Today we have zero
data on which legislator chairs which committee.

**What it unlocks:**
- "S 9322 was just referred to Senate Health — the chair is Sen. Gustavo Rivera (D-33). Email him first; the bill won't move without his sign-off."
- "Bill is in Assembly Codes — Joseph Lentol used to chair; check who took over."
- "Hostile bill A 9156 is in committee X. Here's the entire committee roster + each member's stance flag."

**Build effort:** ~3-4 hours per state. Each state legislature publishes
committee assignments in HTML or PDF — Playwright scraper per state,
following the same pattern as the BoP browser job. Table `legislator_committees`
is ready (migration 0112).

### Tier 2 — Per-legislator kratom stance (high leverage, ongoing manual work)

Table `legislator_kratom_stance` exists (migration 0112) — admin sets
each NY legislator as `champion / sympathetic / neutral / hostile / unknown`
with a markdown rationale + evidence URL.

**What it unlocks:**
- The "talk to these 5 first, avoid wasting time on these 3" section in
  every briefing
- A `/legislators/[id]` page badge so advocates see at a glance whether
  the rep is friendly territory
- Sorting "your reps" list by stance so the best targets bubble up

**Build effort:** schema is done. Data entry is the work — admin scrolls
through 241 NY legislators flagging the ~20-30 who have publicly
spoken on kratom or sponsored bills. AI-assist via Gemini grounded
search: feed each legislator's name + state to an AI agent, get back
draft stance + rationale + evidence URL, admin reviews and confirms.
**This is a high-leverage use case for the Hermes/agent toolkit
described below.**

### Tier 3 — Vote roll-call history (medium leverage, medium effort)

When a bill passes/fails, OpenStates often has the roll call (who voted
yes/no/abstain). Today we don't store it. Knowing how Sen. X voted on
the 2024 KCPA tells you exactly how she'll vote on the 2026 bill.

**Build effort:** ~2 hours. Add `bill_votes` table + extend
`scripts/sync-bills.mjs` to include `include=votes` and write the
results. Most state legislatures publish this in OpenStates' feed.

### Tier 4 — Municipal + county coverage (high leverage, expensive)

NY has:
- NYC: 51 council members + speaker + 5 borough presidents + mayor
- 5 other major cities (Albany, Buffalo, Rochester, Syracuse, Yonkers)
- 62 counties with legislatures + county executives

Today: **0 NY municipal officials** in the directory. This is the
biggest single gap — local kratom bans happen at the city level
(see La Quinta CA, Marshall IL, Sarasota FL).

**Build effort:** ~6-8 hours per state to cleanly onboard the major
metros. There's no clean API — manual scraping per city's "Members"
page. Could be parallelized with an AI agent: feed it the city URL,
agent extracts council member names + contact info, admin reviews
the output before commit.

### Tier 5 — Adversary + coalition intelligence (long-tail)

- Pharma lobbyists active in the state (CRP/OpenSecrets has data)
- Anti-kratom orgs / researchers based in NY
- Friendly orgs we should coalition with
- Recent campaign-finance donors connected to kratom-adverse legislators

**Build effort:** mostly research + manual curation. Could be partially
AI-assisted (give an AI agent OpenSecrets + news access, ask it to map
the actor network).

---

## AI / self-healing roadmap

Owner asked: are there other tools (Hermes, local agents) we should
pull into the toolbelt to level up self-healing + self-improvement?
Yes — here's the prioritized list.

### A. Add Hermes 3 / function-calling local model (1 day)

Today the AI router is **input-only**: we hand prompts to providers,
parse JSON back. Adding a **function-calling capable model** lets the
AI directly query our DB, fetch URLs, etc. — multi-step reasoning.

**Best fit:** Hermes 3 (Llama 3.1 fine-tune by Nous Research) running
via Ollama. Function-calling baked in. Fully local — no API cost.

**What it unlocks:**
- An AI agent that can answer **arbitrary questions about our data**
  ("which states with active kratom bills also have NO BoP source
  configured? Generate a TODO list.")
- The kratom-stance back-fill from Tier 2 above: agent grounds itself
  via Gemini grounded search, drafts stance per legislator, writes back
  to DB for admin review.
- Self-healing cron: when `parse-bop-pdfs` fails like it did last week,
  an agent reads the error log + recent migrations, identifies the
  pattern, and opens a PR or escalates with a diagnosis.

**Effort:** `ollama pull nous-hermes2-llama3-8b` (already done by anyone
running local Ollama). Add a `function_calling` flag to the AI router.
~4 hours of code.

### B. Vector memory for cross-corpus similarity (1-2 days)

Today we **search bills with regex + state filter**. We can't ask "find
me every bill across all 50 states that's substantively similar to NY
A 9156." With embeddings we can.

**Best fit:** `mxbai-embed-large` or `nomic-embed-text` via Ollama.
Free, local. Postgres pgvector extension for storage.

**What it unlocks:**
- Cross-state bill similarity: when MI introduces a new bill, instantly
  see "this is 87% similar to TX HB 5 from 2024" → import the talking
  points that worked.
- Better dedup: "find me near-duplicate news_items" beyond exact title
  match.
- Briefing retrieval: "show me last month's briefing for the 3 states
  most similar to NY by bill landscape."

**Effort:** new migration enabling pgvector extension, `embeddings`
column on bills + news_items + state_briefings, batch script to
populate, simple cosine-similarity query helper. ~8 hours.

### C. Self-critique loop on AI outputs (half-day)

Today: AI generates → store. No quality check.

New flow: AI generates → second AI agent critiques ("did this briefing
miss any bills? Is the natural-leaf vs 7-OH framing correct? Are any
claims unsourced?") → if critique flags issues, regenerate with the
critique appended → re-critique → ship best of N.

**Effort:** wrap `generate-state-briefing.mjs` in a critique loop using
Gemini grounded + Groq speed. ~3 hours. Cost: 2-3x more tokens per
briefing, well within free tier.

### D. MCP server integrations (each: ~1 hour)

Tools we should pull into the agent runtime:

| MCP | What | Effort |
|---|---|---|
| **GitHub MCP** | AI can open PRs directly when it spots a fix | 1h to install + brief the agent |
| **Sentry MCP** | Real-time error analysis; AI can investigate a Sentry issue from a cron job log | 1h |
| **Browserbase / Browser MCP** | Server-side headless browsing beyond Playwright (Cloudflare-protected sites) | 30m install |
| **Perplexity / Tavily API** | Alternative grounded search; backup to Gemini grounding when it hits quota | 30m |
| **OpenSecrets / FEC MCP** | Donor data → adversary intelligence (Tier 5 above) | 1h |
| **PostHog MCP** | Product analytics — "which surfaces aren't getting use?" → AI suggests removal | 1h |

### E. Self-improvement feedback loop (1 day)

Every AI decision the system makes (FP classification, briefing,
campaign-from-alert) gets logged with input + output + admin reaction
(approved? edited? rejected?). Periodically re-tune prompts using this
labeled data.

**Effort:** `ai_decisions` table. Hook into `recordAdminAction` for the
reaction. Daily script that builds a "common failure modes" report for
admin review. ~6 hours.

### F. Schema-driven dashboards for admin (1 day)

Spin up an admin dashboard that shows:
- Briefing freshness per state (oldest = needs regen)
- Stance coverage per state (0 stances = data gap)
- Committee coverage per state (target: every kratom-relevant chair flagged)
- FP rates trending up/down
- Daily cron job health

Today admin has to query the DB by hand. ~6 hours for a clean dashboard.

---

## Proposed near-term sequence

**Block 1 (next session, ~6 hours):**
- Build committee assignment scraper for NY (Tier 1) — get NY 100%
- Use Hermes/Gemini agent (item A) to draft kratom-stance for NY's
  30-40 kratom-active legislators
- Manual admin review of those drafts

**Block 2 (~4 hours):**
- Roll out the committee scraper to 4-5 other priority states
  (TX, FL, CA, OH, MI based on activity)
- Re-enable briefing gen for those states once they have committee data

**Block 3 (~8 hours):**
- Vector memory + cross-state similarity (item B)
- Self-critique loop (item C)
- These two combined → briefing quality jumps to "comparable to a
  professional lobbyist memo"

**Block 4 (~6 hours):**
- Self-improvement feedback loop (item E)
- Admin dashboard (item F)

After all four blocks, NY (and the priority states) reach what the
owner called "CIA/FBI level." Then enable briefing gen for the other
40 states with the new architecture in place.
