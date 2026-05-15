# Sanctuary Vision — Research Library + Site Persona + Academy

> Captured from the owner's 2026-05-15 directive. Maps everything they
> said so nothing gets lost between now and shipping each piece. Some
> items ship in this PR; most are durable plans that need budget + design
> decisions before they go live.

## North Star (the persona, the brain, the morals)

The product needs to BE one coherent thing — one knowledge source, one
voice, one set of ethics — across every surface (research summaries,
chatbot replies, audio reader narration, education-academy content,
campaign templates). The owner's framing:

> "you will be a kratom research brain that can output a singular
> thoughtform about a very vast amount of information and package it in
> the best way possible for every level of educational requirement. if
> the future of america, big pharma, cannabis and kratom depends on
> ending the drug war and opioid and fent and other drugs epidemic, then
> we need to do just that."

### The "neutral but together" stance (the moral core)

> "we will want to make a 'code of morals and ethics' page to explain
> our standing on neutral ground, not choosing war, but choosing peace
> via cooperation and the masses versus the government, rather than
> versus we can be side by side and fight together on the same side."

This needs to live at `/ethics` (or `/code`). One short page. Reads like
a manifesto, not a Terms of Service. Anchors every other voice on the
platform.

### Voice rules that already shipped (post PR #280/#283)

- Campaign templates ask legislators to clarify scope (5 alkaloid
  classes) rather than asserting the user's position
- /takeback frames everything as "offense + defense" not "us vs. them"
- /banned filters to verified-actual-bans only (no false-positive states)
- /admin/data-quality + /admin/oauth-config = "find real work, not
  fake work"

The Code of Ethics page should reflect those choices explicitly so
anyone reading it can verify the platform walks its talk.

---

## Phase 1 — Research library sanctuary (partial: shipped + plan)

### Shipped today (this PR / today's session)

- 8 of 11 community-submitted papers added to `research_papers` via
  `scripts/seed-research-papers-facebook-batch-1.mjs`
- 2 of 11 were dedupe-skipped (already in the 440-paper library)
- 1 of 11 (Corydalis) was skipped because it's not a kratom paper

### Existing infrastructure (already on main)

- Table `research_papers` (migration 0116) with AI-evaluation fields:
  methodology_quality, sample_size_adequate, bias_indicators,
  evidence_strength, key_findings_md, relevance_natural_leaf vs
  relevance_7oh, distinguishes_natural_vs_synthetic flag
- Page `/research` exists with index + per-paper detail
- 448 total papers indexed (440 base + 8 new)

### Plan: bring the library to "sanctuary" quality

**1.1 — Audit existing 448 papers for completeness.** Each row needs:
abstract (currently many NULL), AI evaluation fields populated (~?% currently),
distinguishes_natural_vs_synthetic flag set. Open an admin queue at
`/admin/research-papers/incomplete` that shows the gap.

**1.2 — Public surfacing**: `/research` already exists but the owner
asked for "doctor-friendly, medical-expert friendly, sanctuary" framing.
Audit:
- Filter by topic / study type / year / evidence strength
- Sort by citation count + recency
- Per-paper page shows: original abstract first, AI rating second,
  methodology critique, citations, retraction status, full-text link
- Plain-English summary (short) + in-depth summary (long)
- Embedded PDF viewer when source is open-access
- No off-site redirects when avoidable

**1.3 — Audio reading** (TTS): play/pause/mute on every research
detail page. Two voice tracks per paper:
- Plain-English short summary (~60 sec)
- In-depth summary (~5-10 min)
The owner specifically wants this: *"if we can have the ability to add
actual audio reading capabilities to anything on the site that would
require it (not basics stuff) then lets add that into the plan."*

Tech options:
- **ElevenLabs** (paid, $5-22/mo, best quality) — recommended
- **OpenAI TTS** (paid, $15/M chars, very good) — recommended
- **Browser SpeechSynthesis** (free, lower quality, robotic) — fallback
- **Pre-rendered MP3 cached in R2** so the same paper's audio is
  generated once + served forever

**1.4 — Realtime upload with live AI analysis** (leader advocates):
Form at `/research/submit` with URL or PDF upload. As submission lands:
1. Fetch the paper (URL or PDF text extraction)
2. Stream progress to the user via SSE / WebSocket: "fetching... extracting
   text... AI evaluating methodology... computing evidence strength..."
3. Cool visual indicator: a kratom-leaf progress wheel, optional kratom
   jokes rotating ("watered the plant — extracting cell walls...")
4. On complete: redirect to the now-live `/research/[id]` page
5. That page becomes the canonical landing for everyone

**1.5 — In-app PDF viewer**: never redirect off-site for the PDF when
we can serve it ourselves. Options:
- PDF.js (open source) — embed directly
- R2-cached copy when source allows
- Fallback link to original for non-cacheable sources

**1.6 — Filtering / understanding system for navigation**:
- By alkaloid class (leaf vs MIT extract vs 7-OH vs pseudoindoxyl vs synthetic)
- By topic (pharmacology, ethnobotany, harm reduction, addiction, autopsy)
- By study type (RCT, observational, case report, animal, in vitro, review)
- By evidence strength (strong / moderate / weak / preliminary)
- By year (slider)
- "For doctors" view (RCT + observational + autopsies, prefiltered)
- "For consumers" view (plain-language summaries highlighted)
- "For legislators" view (filtered to safety + harm reduction + abuse liability)

**1.7 — Tutorial with audio**: First-time visitor to `/research` gets a
30-sec audio walkthrough (mutable, with play/pause). Test bed for the
broader audio rollout.

---

## Phase 2 — Site-wide chatbot persona

> "a feature where users can chat with you within the site on every
> page-like an assistant"

### Architecture

- Floating button bottom-right on every page (skipped on auth pages)
- Opens a side panel chat
- Backend: Anthropic Claude (Sonnet 4.6 for speed, Opus 4.7 for deep)
- System prompt anchored on:
  - The Code of Ethics page content
  - The 448 research papers as RAG context
  - Current page's content (so user can ask "what's this bill about?")
- Audit-logged so users (and admins) can see conversation history
- Rate-limited per user (e.g. 50 messages/day free, more for leaders)

### Cost shape

Anthropic API pricing roughly $3/M input + $15/M output tokens for
Sonnet. With ~2K-token conversations averaging 500 chars output:
~$0.01 per conversation. 1000 conversations/day = $10/day = $300/month.

This is the biggest paid recurring cost in the vision. Needs owner
budget approval before going live. Recommended cap: 20-50 conversations
per user per day, leader advocates get higher cap.

### Persona prompt skeleton

Lives in `src/lib/ai/site-assistant-prompt.ts`. Reads:
```
You are the iKratom site assistant. iKratom is a nonpartisan kratom
advocacy platform. Your job is to help advocates take action on bills,
explain research, and answer policy questions WITHOUT taking sides on
whether kratom or 7-OH should be banned.

Hard rules:
- Distinguish ALWAYS: natural leaf kratom, mitragynine, 7-hydroxymitragynine
  (trace natural alkaloid AND concentrated product), pseudoindoxyl,
  synthetic analogues. Conflating them is the #1 error in public discourse.
- Cite research papers from /research when making claims. Link the
  specific paper ID.
- Never advise medical action. Always recommend the user talk to a
  licensed practitioner for medical decisions.
- Never assert a user's political position. Frame as "policy makers
  should consider..." not "you should oppose..."
- The Code of Ethics at /ethics is your moral baseline.

Context you have:
- Current page the user is on
- The full /research library (448 papers as of 2026-05-15)
- The user's profile (state, role, declared 7-OH stance if any)
```

---

## Phase 3 — Kratom Education Academy

> "make a kratom education academy in a very serious way - then a store
> friendly way to train store owners and employees on how to handle
> kratom interactions and the consumers"

### Two parallel curricula at `/academy`

**Track A: Consumer / Citizen** (the public-facing science track)
- Module 1: What kratom actually is (taxonomy, history, biphasic effects)
- Module 2: The 5 alkaloid classes — what makes them different
- Module 3: How alkaloids work — basic pharmacology for laypeople
- Module 4: Harm reduction + risk awareness (without scare tactics)
- Module 5: The "gas station heroin" narrative — where it came from, what's accurate, what's misleading
- Module 6: Reading research papers like a non-scientist

**Track B: Retailer / Employee** (the store-front track)
- Module 1: What's actually on your shelves (leaf / extract / 7-OH / blends)
- Module 2: KCPA compliance — what's legal, what's not, by state
- Module 3: Talking to customers — what to say, what NOT to say (medical claims = FDA trouble)
- Module 4: Recognizing problem use — when to refuse a sale, who to refer
- Module 5: Inventory management + supplier vetting
- Module 6: Local + state policy awareness — how a ban happens, how to respond

Each module:
- Short read (5 min) + audio narration (mutable)
- 3-5 question quiz at the end
- Certificate of completion (track A) / Continuing Ed unit (track B)
- Linked back to /research for source material

Tech: build on top of the existing `/library` infrastructure. Each
module is a `library_items` row with type=`academy_module`. Quizzes
live in a new `academy_quiz_responses` table.

---

## Phase 4 — Site-wide "alive" features (sound, animation, presence)

### Sound effects
- Ambient (off by default, toggle in /account)
- Action confirmations (campaign sent, intel tip submitted)
- New-alert chime on /pulse
- Module-complete fanfare on /academy

Storage: ~10-20 short MP3s in /public/sounds. Free CC0 sources available.
Volume + mute persisted in localStorage.

### Animations / kratom-leaf motifs
- Spinner is a slowly-rotating kratom leaf instead of generic circle
- Progress bars use leaf-color gradient
- Background gradient on /research subtly shifts green-amber-emerald

### Realtime presence
- "12 advocates online now" pill on /pulse
- "Watching this bill" count on /bills/[id]
- Backed by Supabase Realtime (free tier, already provisioned)

### Kratom jokes / personality flashes
- Loading-screen rotating quips: "watering the plant...", "extracting
  the alkaloids...", "reading the autopsy reports..."
- 404 page: leaf falling animation + "this page got harvested but the
  alkaloids are still around"
- Empty-state copy that has voice: "No alerts? That's the goal."

---

## Phase 5 — Audio TTS for the whole site

Owner directive: *"audio reading capabilities to anything on the site
that would require it (not basics stuff)"*

### Scope
- All /research detail pages (highest priority)
- All /academy modules
- All /briefings (state briefings)
- /takeback per-state plans
- Long bill summaries

### NOT scoped
- Forum posts (user-generated)
- Admin pages
- Settings pages
- Short UI labels

### Implementation
- Pre-generate audio on content publish (one-time cost, cached forever)
- Store MP3 in R2 (cheap; ~$0.015/GB/month)
- Audio player component: play/pause/mute/speed (1x/1.5x/2x)
- "Resume from where you left off" via localStorage timestamps
- Captions/transcript shown alongside (accessibility + SEO)

### Voice direction
- Calm, slightly slower than newscaster pace
- No urgency emphasis on injury/death descriptions (respect)
- Pronounce alkaloid names correctly (custom phoneme map for
  "mitragynine" /mɪtˈrædʒɪniːn/, "pseudoindoxyl" /sjuːdoʊɪnˈdɒksɪl/)

---

## Phase 6 — Internationalization (English first; SEA as bonus)

Owner directive: *"we will only focus on english for now, unless it is
just as easy to add in the south east asian languages as well for the
users from the east"*

### Current state
- `src/i18n/` exists with `en, id, th, ms, vi, tl` files
- Some content already translated (per migration 0070 + the translate:content script)
- Translation cache table populated for some content

### Decision needed
- Should /research papers translate?
  - **Pro**: SEA traditional-use community deserves access in their language
  - **Con**: Translation cost (paid TTS doubly), accuracy risks on technical content
- Recommendation: SEA translations for /academy + /banned + /takeback (high-mission-impact) but English-only for /research detail pages (accuracy + audit trail matters more)

---

## Phase 7 — Code of Morals and Ethics page

### Lives at `/ethics`

### Suggested content skeleton

```
# Our Ethics

We are nonpartisan. iKratom is not aligned with the AKA, GKC, Botanic
Tonics, the FDA, the DEA, or any state legislator. We have allies in
all those camps. We have critics in all those camps too.

## We do not take sides on:
- Whether 7-OH-concentrated products should be banned, regulated, or kept
- Whether mitragynine should be controlled
- Whether kratom is "good" or "bad"

## We DO insist on:
- Accuracy. We distinguish natural leaf, MGM, 7-OH, pseudoindoxyl, and
  synthetic analogues — because they are different.
- Evidence. We cite peer-reviewed research, not vibes.
- Transparency. Every editorial choice (takeback intel, bill
  classification, banned-state list) is documented.
- Action. Information without a way to use it is theatre. We give you
  the tools.

## Choosing peace, not war
The kratom policy debate has been "advocates vs regulators" for too
long. Both sides have legitimate concerns. We believe the path forward
is cooperation: better data, better regulation, better consumer
protection. Not a defeat for either side — a settlement that protects
adults' access to a traditional plant medicine while keeping the truly
dangerous concentrated synthetics out of gas stations.

## Together
We don't need a million people. We need the right ones — paying
attention. If you found this page, you're probably one of them.
```

Page is short. Linked from footer + about page. Reachable from chatbot
("what's your stance on X?" → "here's what we believe → /ethics").

---

## Cost reality (what the full vision needs from the budget)

| Item | Monthly | One-time | Notes |
|---|---|---|---|
| Anthropic API (chatbot) | $50–300 | — | Depends on volume + caps |
| ElevenLabs TTS | $5–22 | — | Per voice clone tier |
| Cloudflare R2 (audio MP3s) | <$5 | — | 10GB+ of cached audio |
| PDF rendering compute | $0–10 | — | Vercel edge functions |
| Translation API (SEA) | $10–50 | — | If we ship Phase 6 SEA |
| **Total realistic** | **$70–400/mo** | — | Most of this is the chatbot |

Free / one-time alternatives exist for everything except the chatbot —
the chatbot is where the real cost lives.

---

## Suggested sequencing (which to ship in what order)

1. **Now** (this PR): seed the 8 papers + this vision doc, so nothing
   gets lost.
2. **Week 1**: Code of Ethics page (zero-cost, high mission value).
3. **Week 1**: Audit existing 448 papers — fill in missing abstracts,
   topics, evidence strength via a one-time AI pass. Surface gaps via
   /admin/research-papers/incomplete.
4. **Week 2**: In-app PDF viewer for open-access papers + cleaner
   /research detail page.
5. **Week 3**: Audio TTS for /research details (pre-rendered, cached)
   — start with just 20 highest-citation papers as proof.
6. **Month 2**: Upload + realtime AI analysis flow for leaders.
7. **Month 2**: Academy track A (consumer/citizen) — content-heavy
   work, needs editorial time more than dev time.
8. **Month 3**: Site-wide chatbot persona — gated behind budget approval.
9. **Month 3**: Academy track B (retailer/employee).
10. **Quarter 2+**: Sound effects, presence, full audio rollout, SEA
    translations.

---

## Owner action items

- [ ] Approve chatbot monthly budget cap ($50–300/mo) before Phase 8
- [ ] Pick TTS provider (ElevenLabs vs OpenAI vs browser-only)
- [ ] Draft personal-voice Code of Ethics text — or approve my skeleton
      verbatim
- [ ] Decide on Academy quiz incentive (just-a-badge vs CE credit)
- [ ] Decide on SEA language scope (Phase 6 — yes/no/which surfaces)

— Claude, 2026-05-15
