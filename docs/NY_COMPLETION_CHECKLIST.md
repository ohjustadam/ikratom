# NY completion checklist

> NY is the model state. Until every item here is green, we **don't**
> propagate to TX/FL/CA/etc. — each must follow this exact template so
> the architecture rolls out clean.

## ✅ Done

### Core data
- [x] **State legislators** — 241 active records (150 Assembly · 63 Senate · 26 US House · 2 US Senate). Zero missing contact info, 99.8% of NCSL count.
- [x] **Active bills** — 38 tracked (19 anti · 18 pro · 1 neutral). Live syncing via OpenStates + LegiScan.
- [x] **Bill sponsors** — 149 sponsor rows across 38 bills, 98% matched to legislators. Surfaces by name in briefing.
- [x] **News pipeline** — 21 articles last 30 days, FP defense pipeline filters ~30% noise.
- [x] **Campaigns** — 5 active, dedup architecture (PR #149) prevents queue bloat.

### Intel layer
- [x] **Capital metadata** — Albany address, session dates, public-comment URL, scheduling info, field-work notes.
- [x] **Committee assignments (Assembly)** — 1077 chair+member rows, 205 flagged kratom-relevant.
- [x] **AI-drafted stances** — 153 legislators have stance + rationale (8 champions · 16 hostile · 36 sympathetic · 11 neutral · 82 unknown).
- [x] **BoP/regulatory sources** — 3 configured (NYSED Office of Professions Pharmacy Board, NY DOH, legacy entry).

### Surfaces
- [x] **/briefings/state/NY** — 8,007-char briefing names champions, cites session deadline, per-bill primary sponsor + cosponsor count, tactical talking-points.
- [x] **/admin/stance?state=NY** — Owner review surface for the AI drafts.
- [x] **Per-state PWA pages** — /install/ios, /install/android, /install hub.

### User experience
- [x] **Calls page (/calls)** — Priority targets, in-app dialer launcher, on-device Web Speech transcription, AI summary, badges + achievements.

## 🟡 Pending — these complete the NY picture

### Manual admin work (cheap; ~30-60 min total)
- [ ] **Review 153 AI-drafted stances at `/admin/stance?state=NY`** — Spot-check champions + hostiles especially. Click to confirm or flip. AI was conservative (82 marked unknown honestly) so most rows just need a single click.
- [ ] **Confirm capital metadata field-work notes** — visit /briefings/state/NY, read the field-work tactical section, edit any inaccuracies via /admin (TODO: build that surface).

### Free + scriptable (need only existing API keys)
- [ ] **NY Senate committee scraper** — Cloudflare-blocked at nysenate.gov. Free workaround: use Claude in Chrome MCP to drive a logged-in browser one committee at a time. Slow but works. **Action:** ask Claude in the next session to do this batch.
- [ ] **Vote roll-call history** — OpenStates exposes votes via `include=votes` on the bill detail endpoint. **Action:** extend `scripts/sync-bills.mjs` to pull + insert into a new `bill_votes` table. Schema needed.
- [ ] **News-to-stance signal** — when a news_item mentions a legislator by name and quotes them on kratom, auto-update their stance rationale. **Action:** extend `verify-news-body.mjs` to extract legislator quotes + write to `legislator_kratom_stance.rationale_md` appendix.

### Free + manual (needs your sign-up but no payment)
- [ ] **OpenSecrets donor map for NY** — Once you add `OPENSECRETS_API_KEY` to env, the `scripts/sync-legislator-donors.mjs` script will pull donor data per legislator. Surfaces in briefings as "this hostile rep's top donors are pharma X + Y" — actionable adversary intel.
- [ ] **PostHog product analytics** — Once `NEXT_PUBLIC_POSTHOG_KEY` set, every surface gets tracked. AI can identify dead UX paths.

### Blocked by paid services (gracefully deferred)
- [ ] **NY Senate committees via Browserbase** — single biggest blocker. ~$39/mo unlocks Cloudflare-protected pages. Free workaround above buys time.
- [ ] **NYC municipal officials** (51 council members + 5 borough presidents + mayor) — could scrape manually with Skyvern self-host or Browserbase. Wait until budget allows.
- [ ] **Twilio call infrastructure** — current `tel:` + Web Speech API is free and works for 80% of users. Twilio gives us server-side call recording, callbacks, and IVR routing for power users. Defer until validated demand.

## ⛔ Out of scope tonight (next session work)

- Cross-state bill similarity via vector embeddings (Block 3 of roadmap)
- Self-critique loop on briefing outputs (Block 3)
- Self-healing cron agent (Block 4)
- Admin dashboards over all signals (Block 4)
- Roll-out to TX/FL/CA — only after this checklist is fully green for NY

## How to know we're "done with NY"

The simplest test: a stranger NY advocate visits `/briefings/state/NY` and within 60 seconds knows:
1. Which bills are live + active + who the primary sponsor is — ✓ today
2. Who their champions and hostile reps are — ✓ today (pending admin confirm)
3. Where to go in person (Albany capital info) — ✓ today
4. Which committees + chairs control kratom-relevant bills — ✓ Assembly today (Senate pending)
5. Recent news context — ✓ today
6. What field-work to actually do — ✓ today (tactical section)
7. Their own reps' contact info, including phone for call tracker — ✓ today

**6.5 of 7 are green.** Senate committee data is the last gap before NY is a complete template.
