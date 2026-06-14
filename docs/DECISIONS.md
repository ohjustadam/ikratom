# Decisions log

Non-obvious tradeoffs we've already debated. **Don't relitigate** — if you want to change a decision, propose the change with new evidence, don't quietly rewrite it.

Format: each entry is a heading. Keep them short.

---

## The alert→news feeder seeds REAL NEWS only, never gov/portal links (PR F)

"If it's not in /news, create it" (`scripts/feed-news-from-alerts.mjs`): alerts with a `source_url` but no linked `news_item` get a /news row seeded + linked. But the unlinked population is dominated by `bill_event` alerts whose source is a legislative/gov portal (openstates.org, *.gov, nysenate.gov, leginfo…) — those are NOT news articles (they'd extract to an empty /news page and are already covered by the bill page). So the feeder applies a `NON_NEWS_HOST` denylist (gov / legislative / bill-tracker / advocacy-org) and a clean-publisher-URL check, seeding ONLY genuine news. On the first run that was 2 of 179 unlinked (130 portal-skip, 47 google-redirect-skip). Don't "fix" the low yield by removing the denylist — seeding the 130 portal alerts is the bug, not the feature. Seeded rows set `resolved_url`=the clean URL + `policy_classified_at` + `body_has_kratom_keyword=true` so the nightly extract+summarize pipeline enriches them; existing same-URL rows are linked, not duplicated (news_items.url is unique).

---

## In-app news = publisher EMBEDS + bounded lead, never rehosting (PR E)

Owner directive: "max in-app, ZERO legal risk." The line we hold on `/news/[id]`: we surface our own AI summary + a **bounded fair-use lead** (`PARAGRAPH_CAP=10` AND `EXCERPT_CHAR_CAP=2500` in `article-content.mjs` — the char cap is the real guard; never the full body even for long-paragraph articles) + the publisher's **own** media, then link out. Media is the publisher's served players ONLY: video (YouTube/Vimeo) + audio (SoundCloud/Spotify/Apple Podcasts) as iframes, images hotlinked from the publisher CDN. We do NOT: rehost text/images, nor hotlink raw publisher `.mp3`s into our own `<audio>` (that's closer to rehosting AND would force loosening `media-src` to `https:`). Audio extraction matches embed-iframe forms ONLY (`/embed/`, `w.soundcloud.com/player/`) — bare "follow us" profile links are deliberately ignored so a station's whole show doesn't attach to an unrelated story. Each render-side iframe src is host-gated (`page.tsx` EMBED_HOSTS, `^`-anchored) on top of CSP `frame-src`. Don't "improve" this by raising the cap to full text or adding direct-`<audio>` hotlinking.

---

## The auto-campaign LEAK fix lives in SQL, not the JS script (PR C)

News-spawned campaigns were pasting raw `news.google.com` redirect URLs into legislator letters. The obvious fix — guard the URL in `scripts/auto-campaign-from-alert.mjs` — is nearly useless, because that script is only a cron *safety net*. The **primary** campaign-creation path is the Postgres trigger `auto_campaign_on_alert`, which renders the letter body in SQL via `render_template_for_alert()`. And because `resolve-news-urls.mjs` runs *daily* while `classify-news-policy.mjs` runs *hourly*, `policy_alerts.source_url` is still a raw redirect at the instant the trigger fires. So the real fix is migration `0201`: `render_template_for_alert()` itself refuses Google redirects / video embeds and falls back to the internal `/alerts/<id>` page. The JS classifier also now stores a clean URL, and the JS safety net mirrors the same guard — but the SQL render is the load-bearing one. Don't "simplify" by removing it.

---

## News-story alert dedup keys carry NO day; bill-action keys do (PR D)

`compute_policy_alert_dedupe_key` (0079) keyed news-story alerts on `news:{title}:{locality}:{day}`. The trailing day let a syndicated story re-published a day or two later evade the unique index → one story spawned many alerts (a TN ban = 13, NC under-21 = 6) and /pulse showed it repeatedly. Migration 0202 drops the day from the **news-story branch only**: a re-publish of the same headline now collides regardless of date. The `bill:{bill_id}:{day}`, `bop:`, `stale:`, `intel:`, and fallback branches KEEP the day on purpose — a bill action on two different days is two genuinely different events. Don't "consistency-fix" by re-adding the day to news or removing it from bill. Title-based dedup only collapses same-headline re-publishes; cross-headline same-event clustering is the news_items.duplicate_of layer's job, not this. Existing dups were collapsed earliest-wins by `scripts/merge-duplicate-alerts.mjs` (matches the unique index's first-insert-wins).

---

## We FILL a NULL campaign bill_id — we never reassign one (PR C)

`campaigns_one_auto_per_bill_idx` (0024) allows only one auto-campaign per bill. When a *dead* duplicate (rejected/superseded) holds a bill link an *active* campaign wants, the tempting move is to "promote" — clear the dead holder, give the link to the live one. We considered it and the owner declined (2026-06-13). The right cure for a duplicate is collapsing it through the dedup/supersede system, not churning `bill_id` in a backfill. `scripts/backfill-campaign-bill-id.mjs` therefore only fills NULLs and skips any bill already held (active or dead).

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

**Bill axis aligned (migration 0186).** The DB key originally had **no bill-number awareness**: two distinct same-state bills both phrased as "kratom ban" collapsed to one DB cluster at insert, even though the engine's `billKey` keeps them apart. Migration **0186** makes `campaign_topic_key()` bill-aware — bill-numbered titles now key as `bill:ST|<chamber><num>`, identical to the engine's `billKey` — so distinct bills stay distinct and every step of one bill collapses, at insert and at decision time alike. The remaining divergences (topic-token normalization `7-OH → mitragynine`; narrower DB event vocabulary; the broad janitor keyspace) are intentional and must **not** be "aligned" away.

0186 safety: it **depends on 0183** (the trigger's 23505 auto-link — keyword-free bill steps now collide at insert where they didn't before), which is already applied to prod. Its back-fill is non-destructive — non-live rows bulk-update; live rows update oldest-first and any collision keeps its old key (the existing cleanup crons / engine collapse the dup later). Pre-apply sizing: `scripts/diagnose-topic-key-0186.mjs`.

**Doc drift, corrected:** migration 0107's header claimed its keyword+event lists "match `cleanup-pending-campaigns.mjs`". They don't — the janitor's `EVENT_RX` is far broader. The 0107 comment has been corrected to point here.
