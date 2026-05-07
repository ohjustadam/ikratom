# Discord integration — design

**Status:** design only. Implementation tracked in todo. Owner picks scope from the options below; nothing ships until then.

The kratom community has several large active Discord servers (kratom-focused subreddits' linked Discords, vendor communities, harm-reduction groups). Hundreds to thousands of users each. Recruiting from these into political action — without disrupting their existing community fabric — is the underground-network play.

This doc lays out **what we can do**, **what we can't**, and **what's worth building**.

---

## What we CAN do (free, within Discord TOS)

### 1. Outbound webhooks → server channels (low-friction, high-leverage)
- Server admin creates a webhook URL for a channel like `#kratom-bills`
- They paste it into our admin UI: `/admin/discord-integrations`
- We post automated alerts: bill drops, campaign launches, wave reminders, federal action moments
- **Server admin keeps full control** — they pick the channel, can revoke at any time
- **No bot, no permissions** — webhooks are the lightest possible integration
- We never see anything in their server; only push to their channel

### 2. Discord OAuth login
- "Sign in with Discord" button on `/login` and `/signup`
- We get: Discord ID, username, avatar URL, email (if scope granted)
- One-click signup; reduces friction from Discord-native users
- Doesn't auto-add them to any server; doesn't read DMs; doesn't post on their behalf

### 3. Per-server attributed recruitment links
- Like the partner kit but for digital deployment
- Server admin generates `https://ikratom.org/?ref=discord&host=<server-slug>`
- Pastes anywhere — `#resources`, server description, channel topic, pinned message
- Existing `proxy.ts` referral capture credits attribution back
- Server admin gets a public stats page at `/partners/<server-slug>` showing the impact

### 4. "Discord verified" community badge (optional, requires bot)
- We run a small bot in 2-3 trusted kratom community Discords
- Users link their Discord (via OAuth above) → bot checks if they're a member
- They get a "Discord verified" badge on their profile + adjacent to forum posts
- Reduces fake-account spam, signals real community membership
- Bot only reads member rosters of servers it's invited to

### 5. Slash commands (in our own official Discord, if/when we have one)
- `/bill OK SB123` → fetches bill status from the platform
- `/scoreboard OK` → returns top advocates this month
- `/help` → quick links
- Only works in servers that opt-in to invite our bot
- Optional; nice-to-have, not core

---

## What we CANNOT do (TOS, encryption, or just bad UX)

### Hard NOs (would get us banned from Discord)
- **Mass DM users** — TOS violation, instant ban
- **Scrape member lists from servers we're not in** — TOS violation
- **Auto-post in servers we don't have admin/webhook permission for** — TOS violation
- **Read private channel messages** — Discord's bot scope intentionally doesn't expose this without explicit invite + intent
- **Pretend to be Discord** — phishing-adjacent; ban + legal risk

### Soft NOs (allowed but bad ideas)
- **Cross-post our forum threads automatically into their channels** — would feel like spam to their members. Even with webhook permission, only post things they explicitly opted into.
- **Replace Discord with our chat** — Discord users are loyal to Discord. We're the action layer, not the community layer. Fighting their habits = losing.
- **Force-link Discord to take action** — keep it optional. A user without Discord must have full functionality.

### Subtle limits
- Discord IDs are pseudonymous. We can verify "this user is in X community" but not "this is John Smith." Identity verification still requires email + the platform's own auth.
- Webhook URLs are secrets. If leaked, anyone can post to that channel. Treat them like API keys (RLS, never log, etc.)
- Discord rate-limits webhook posts (5/sec/channel). For high-volume events we'd batch.

---

## Recommended build order (cheapest → biggest impact)

| # | Feature | Effort | Impact | Why this order |
|---|---|---|---|---|
| 1 | **Webhook outbound (#1 above)** | ~3 hr | High | Lowest friction for server admins; we don't ask them to install anything. Gets us into N servers fast. |
| 2 | **Discord OAuth login (#2)** | ~2 hr | Medium | One-click signup for the Discord-native crowd. Compounds with #1 — they see an alert in their server, sign up via OAuth. |
| 3 | **Server-attributed recruitment links (#3)** | ~2 hr | Medium | Server admins love attribution dashboards. Easy add since the partner kit attribution already exists. |
| 4 | **Discord verified badge (#4)** | ~6 hr | Low-medium | Requires us to run + maintain a bot. Worth it after we've onboarded 5+ servers via #1-3. |
| 5 | **Slash commands (#5)** | ~8 hr | Low | Only matters once our own Discord exists or is being requested. Defer. |

Total realistic v1 (#1-3): **~7 hours** of work over 2-3 PRs.

---

## What gets built (when approved)

### Phase 1: Webhook outbound

**Schema (migration 0045-ish):**
```sql
create table discord_integrations (
  id uuid primary key default gen_random_uuid(),
  webhook_url text not null,                    -- encrypted at rest? see below
  server_name text not null,                    -- "Kratom Connect"
  server_slug text not null unique,             -- "kratom-connect" — for ?ref=discord&host=
  channel_name text,                            -- "#kratom-bills"
  added_by_user_id uuid references profiles(id),
  events_enabled jsonb not null default '[]',  -- ["bill_drop","campaign_launch","wave_fire"]
  state_filter text,                            -- "OK" or null for all states
  active boolean default true,
  created_at timestamptz default now(),
  last_post_at timestamptz,
  total_posts int default 0
);
```

Webhook URL encryption: optional v2. v1 just uses RLS (admin-only read/write).

**Routes:**
- `/admin/discord-integrations` — list + manage (CRUD)
- `/admin/discord-integrations/new` — paste webhook URL, pick events
- `/admin/discord-integrations/[id]/test` — sends a "✓ test post" so they confirm it works

**Server-side hooks** (where alerts trigger):
- `bill_drop`: when `auto_create_campaigns_for_new_anti_bills` runs in cron
- `campaign_launch`: when admin publishes a campaign
- `wave_fire`: when `fireDueWaves` runs

Each hook iterates `discord_integrations WHERE active AND <event> IN events_enabled AND (state_filter IS NULL OR state_filter = bill.state)` and POSTs.

**Embed format** (Discord's rich embed):
```json
{
  "embeds": [{
    "title": "🚨 New anti-kratom bill in OK",
    "description": "OK SB 1234 was just introduced — would schedule kratom Schedule I.",
    "url": "https://ikratom.org/bills/<id>",
    "color": 16711680,
    "fields": [
      { "name": "Sponsor", "value": "Sen. Smith (R)" },
      { "name": "Status", "value": "Introduced" }
    ],
    "footer": { "text": "Take 30s action via iKratom" }
  }]
}
```

### Phase 2: Discord OAuth

Standard OAuth 2.0 flow. `discord_id`, `discord_username`, `discord_avatar_url` columns added to `profiles`. Login button. Same security model as the existing Google OAuth (state nonce, redirect URI whitelist).

### Phase 3: Recruitment links

Already 90% done — extend the existing partner-kit pattern:
- `partners` table gains a `kind` column: `shop` | `discord_server`
- Discord-server partners get a different kit format (digital banner + invite copy + paste-ready embed code, not a printable poster)

### Phase 4 (later): Verified badge bot

Discord bot in Node, deployed as a separate Vercel project (or runs on the same Ollama machine as a long-running script). Subscribes to `GUILD_MEMBERS` intent on the 2-3 trusted servers we're invited to. Endpoint: `POST /api/discord/verify-membership` checks if `discord_id` is in roster. Updates `profiles.discord_verified_servers`.

---

## What I need from you to start

1. **Confirm phase 1 scope** (webhook outbound) is what you want first — or pick a different starting point
2. **Discord developer account** — sign up at https://discord.com/developers/applications, create a new application named `iKratom`
3. **OAuth credentials** (only if doing Phase 2 now): under your application → OAuth2 → Client ID + Client Secret. Add redirect URI `https://ikratom.org/api/oauth/discord/callback`. Add to Vercel env as `DISCORD_OAUTH_CLIENT_ID` + `DISCORD_OAUTH_CLIENT_SECRET`.
4. **Identify 2-3 target servers** — which kratom Discords do you want to onboard first? I'll draft the outreach copy for the server admins (template for "hey I'd love to put a webhook in your #kratom-bills channel — here's exactly what it'd post").

When you're ready, say "build phase 1" and I'll ship the webhook outbound feature on a fresh PR.

---

## Risks / things to watch

- **Discord server admins are the gatekeepers.** Without their buy-in, we can't post into their server. The pitch needs to be: "free advocacy alerts, you control what posts, you can revoke instantly." Not "let us spam your server."
- **Webhook URL leakage.** If a webhook URL leaks (e.g. via a screenshot in our admin UI), anyone can post anything to that channel. Mitigate: never log the URL in plaintext, mask in UI (`https://discord.com/api/webhooks/12345/****`), audit-log access.
- **Webhook revoked.** If a server admin revokes our webhook, our posts return 404. The integration should mark `active=false` after 3 consecutive 404s and surface a "needs reattention" badge in `/admin/discord-integrations`.
- **TOS changes.** Discord occasionally changes what bots/webhooks can do. Subscribe to their developer changelog; revisit this doc when major API changes ship.
