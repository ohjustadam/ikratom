# Decisions log

Non-obvious tradeoffs we've already debated. **Don't relitigate** — if you want to change a decision, propose the change with new evidence, don't quietly rewrite it.

Format: each entry is a heading. Keep them short.

---

## Use `mailto:` not Resend for legislator emails (v1)

**Why:** Resend is paid past 100/day. With 1,000 advocates × 2 actions/week = 8,000+/month, we'd be paying. mailto: opens the user's mail client — they hit send themselves. Slightly worse UX, but $0 + works without any sender-domain setup + the recipient sees a real human's address.

**Watch:** if conversion-on-send drops below 50%, revisit (could mean the mail-client friction is killing actions).

---

## `proxy.ts` not `middleware.ts`

Next.js 16 renamed middleware to proxy. Same purpose. AI training data still calls it middleware — don't be confused, the new file is `src/proxy.ts`.

---

## pdf-parse v2 via CJS bridge

v2 of pdf-parse switched to a class-based ESM-incompatible API. We can't import it normally. Workaround:
```ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");
const parser = new PDFParse(buffer);
```
Don't try to upgrade or refactor without testing the import. v1 had `pdf(buffer)` — v2 is different.

---

## `FED` as a state code for federal

Reserved value for the `state` column on bills, campaigns, threads. Cleaner than a separate `is_federal` boolean (which would require all queries to filter both). The `STATE_RE` regex in `proxy.ts` allows `^([A-Z]{2}|FED)$`.

---

## Vercel cron limits → GitHub Actions for hourly jobs

Vercel Hobby plan only allows daily crons. Our `fire-waves` job needs to run hourly (so users wait ≤1h after their wave's scheduled time). Solution: hourly cron lives in `.github/workflows/cron-hourly.yml`, hits `/api/cron/fire-waves` with bearer auth. Free, reliable enough (~5 min skew during high GH load is fine).

**Don't** try to add another sub-daily cron to `vercel.json` — the deploy will fail. Add to the GitHub Actions workflow instead.

---

## Partner table separate from `profiles.is_shop_owner` flag

Two distinct flows:
- **`profiles.is_shop_owner`** — a *user* self-declares as a shop owner during signup. Lightweight, no verification, just an outreach signal.
- **`partners` table** — admin-curated list of real shops that have been physically visited and recruited. Drives the printable kit + QR attribution.

Reasoning: the kit is a real-world artifact (printed materials shipped on USB) — gating on user signup would block the recruitment workflow ("I just talked to a shop owner who isn't on iKratom yet"). And we want the curated quality bar admin-controlled.

**Future link:** when we ship verified vendor accounts (see VENDOR_ACCOUNTS.md), an approved vendor *could* trigger auto-creation of a partner record. Not v1.

---

## Realtime + RLS = need to set auth manually

`@supabase/ssr`'s `createBrowserClient` doesn't auto-attach the user's JWT to the realtime WebSocket on first mount. If a table's SELECT RLS is `to authenticated`, the channel silently drops events. Fix: call `supabase.realtime.setAuth(session.access_token)` before `.channel()`.

We hit this with `chat_messages`. `forum_posts` has `to public` SELECT and works without it — that masked the bug for weeks.

---

## Realtime DELETE filtering = need REPLICA IDENTITY FULL

Default replica identity logs only the primary key on DELETE. If your realtime channel filter is on a non-PK column (e.g. `room=eq.lounge`), Supabase can't evaluate it without that column in the WAL payload — events drop silently.

Fix: `alter table T replica identity full;` for any table where realtime delete + filter is needed. We did this for `chat_messages`; INSERT was unaffected because new rows are always logged in full.

Cost: marginally bigger WAL writes on UPDATE/DELETE. Negligible at our scale.

---

## Bot blocklist in `proxy.ts`, not WAF

Vercel WAF is a paid feature. Our free substitute: a regex of declared AI crawlers + abusive scrapers checked in `proxy.ts`. Returns 403 before any Supabase work happens. Adding a UA to the blocklist is one PR — instant deploy.

**Limit:** doesn't stop bots that lie about UA. For real defense we'd need rate-limit-per-IP (we have it for some endpoints) or paid WAF. Acceptable for v1.

---

## VAPID keys: rotated once, currently in plain `.env.local`

The first VAPID keypair was leaked in chat (regenerated). Current keypair only lives in `.env.local` (gitignored) + Vercel env. **Don't ever paste these in chat or commit them.** Rotate again if exposure suspected.

Web Push uses asymmetric crypto: leaking the *public* key is fine (browsers expose it anyway). Leaking the *private* key means anyone could push to subscribed devices.

---

## Slugs are immutable in production

Once a slug is encoded in any user-facing artifact (printed QR codes for partners, share links for campaigns), changing it breaks every existing reference. The schema constraint allows updates, but our admin UIs deliberately don't expose slug edit fields.

Want to "rename" a partner? Create a new partner record. Old QRs keep working until they wear out.

---

## Lounge author names via SECURITY DEFINER RPC

`profiles` SELECT RLS is admin-only + self. So a regular user reading the lounge can't resolve author names directly. Fix: `get_public_profile(uuid)` and `get_public_profiles(uuid[])` — both `SECURITY DEFINER`, both whitelist only public-safe columns (no email/addr/phone).

When in doubt: prefer a SECURITY DEFINER RPC over loosening RLS.

---

## New-account chat throttle: 5 msg/min (was 2)

2/min was tripping legit new users typing 3 short messages in quick succession. 5/min still blocks stuck-key floods (cap is per-minute, not per-second) without UX hostility.

The flood regex (`/(.)\1{9,}/`) catches the actual abuse pattern (10+ same char in a row) regardless of rate.

---

## Mute history capped at 168h per event for "ban review"

If we summed raw mute durations, a single "forever" mute (5 years) would dominate every other user's history forever. Capping each event at 168h (1 week) lets the 72h ban-review threshold trip from genuinely repeat offenses (3×24h, 4×18h, etc.) — and a single forever-mute trips it on its own (168 ≥ 72), which is the intended signal.

---

## Token efficiency rules for AI contributors

- Don't re-grep the codebase to refresh context already in this session
- Use partial reads with offset/limit when only a fragment is needed
- Lean commit messages over verbose ones
- No re-exploration just to be thorough

Treat AGENTS.md as the cold-start brief. Treat this DECISIONS.md as "what we already know." Don't search for context that's already documented.

---

## AI provider routing (toolkit)

See `docs/AI_TOOLKIT.md`. Short version: Claude for novel work, Gemini for grounded research, Ollama for bulk + privacy, Groq for fast bulk fallback. Don't burn Claude (paid seat) on tasks Ollama can do for free.

---

## Auto-merge on green for trusted classes of PRs

Owner's rule: "as long as you are only merging one at a time and we confirm it is working after, then it is no problem." Refined into trust classes:

- **Auto-merge OK** (no human gate): docs-only, scaffolding (uncalled new code), non-breaking npm audit fixes
- **Wait for human:** schema/RLS changes, behavior changes, anything user-facing that requires manual smoke-test
- **Hard stop:** anything paid, anything destructive, anything outside agreed scope

This file plus AGENTS.md is the trust contract.

---

## Campaign dedup uses THREE keyspaces, intentionally distinct

Campaign de-duplication is enforced in three places that **do not share a key format**. This is deliberate — do **not** "align" them by string-equality without owner sign-off (that's a runtime behavior change, not a cleanup). Pinned by `tests/campaign-autoapprove.test.ts` → "three-keyspace dedup relationship".

1. **DB unique index — insert-time hard gate.** `campaign_topic_key(state,title)` (migration 0107) → `STATE|kw|event`, enforced by `ux_campaigns_topic_key_live` (0108) across `pending_review | auto_active | manual`. Narrow event vocabulary; a title that doesn't parse both a keyword and an event becomes `STATE|unknown|unknown`, which the index **excludes** (the DB refuses to collapse what it can't confidently key). The trigger (`auto_campaign_on_alert`, 0183) and `auto-campaign-from-alert.mjs` catch the 23505 and **link the new alert to the canonical row** — so a DB-clustered duplicate *never becomes a second row*.

2. **Auto-approve engine — decision-time dedup.** `auto-approve-campaigns.mjs` does **not** read `topic_key` and does **not** use the broad `topicKey()`. It keys via `keysFor()` = `billKey` ⊕ `normalizedTitleKey` ⊕ `strongTopicKey` (a STRICT event set: `ban|restrict|schedul|hearing|enact|veto|repeal|ordinance|crackdown|prohibit|classif|outlaw`). Conservative on purpose: a wrong auto-supersede silently buries a real call-to-action, so it only collapses on a strong-specific event, an exact normalized title, or a bill number.

3. **Daily janitor — broad cleanup.** `cleanup-pending-campaigns.mjs` uses `topicKey()` with the BROAD `EVENT_RX` (adds `propose|introduce|vote|advance|warn|action|…`). Broadest of the three; only sweeps the pending queue, never sends anything.

**Why three keyspaces is safe (the relationship the test pins):**
- The engine's only *fuzzy* collapse (`strongTopicKey`) always lands **inside** DB-enforced space: any title that yields a strong key also yields a DB key that is *not* `…|unknown|unknown` (the keyword always parses), so the index actively enforces it. The engine never guesses a supersede in the DB's blind spot.
- The engine **covers** the DB's blind spot: for `…|unknown|unknown` titles the index ignores (incl. keyword-free bill-step alerts), the engine still dedups via exact normalized title and `billKey`. This is the intended safety-net — see the `scripts/lib/topic-key.mjs` header.
- Approve only flips `pending_review → auto_active`; both states are inside the index's `WHERE`, and `topic_key` doesn't change on the flip, so an approve can never raise a fresh 23505.

**Known asymmetry (watch, don't fix without sign-off):** the DB key has **no bill-number awareness**. Two genuinely distinct bills in the same state both phrased as e.g. "kratom ban" collapse to one DB cluster at insert (the second alert links to the first), even though the engine's `billKey` would keep them apart. In practice procedural bill-step alerts are keyword-free → `…|unknown|unknown` → the DB punts → the engine/`billKey` separates them correctly; the over-merge only bites news-style titles carrying *both* a keyword and a strong event. If a second same-state bill ever fails to get its own campaign, this is why.

**Doc drift, noted not fixed:** migration 0107's header claims its keyword+event lists "match `cleanup-pending-campaigns.mjs`". They don't anymore — the janitor's `EVENT_RX` is far broader. The mismatch is benign given the above, but don't trust that comment.
