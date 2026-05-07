# Discord server — setup blueprint

The user owns the Discord server and configures it via the Discord UI.
This doc captures the channel/role/permission layout that mirrors our
mission so the server is action-ready, not just chat-ready.

Use this as a checklist when setting up the official iKratom Discord.

---

## Server name & top-level

- **Name:** iKratom — Advocate's War Room (or simpler: "iKratom")
- **Region:** US East (lowest combined latency for our user base)
- **Verification level:** Medium (must have verified email; reduces alt accounts)
- **Default notifications:** Only @mentions (avoids noise overload from chatty channels)
- **Explicit content filter:** Scan messages from members without roles

---

## Roles (top → bottom in hierarchy)

The role color matters less than the **hierarchy order** — Discord
uses position to resolve permission conflicts.

| Role | Color | Granted to | Permissions |
|---|---|---|---|
| **@Owner** | red | You only | All (auto) |
| **@Admin** | red | Trusted lieutenants | Moderate, manage channels, kick, timeout |
| **@State Lead** | orange | Per-state coordinators | Moderate own state channel, post in #strategy |
| **@Verified Vendor** | green | Approved vendors via iKratom | Post in #shop-talk, has badge |
| **@Verified Advocate** | blue | Anyone signed up on iKratom | Speak in all gen channels |
| **@Member** | gray | Default on join | View, react, speak in welcome/help |
| **@Bot** | (separate) | iKratom bot when phase 4 ships | Limited to webhook channels |

### Permission cheat sheet

- **@Member** is the default — gets read access to public channels but can only post in `#welcome`, `#help`, and voice. Forces a friction step (sign up on iKratom + react ✅) to upgrade to @Verified Advocate.
- **@Verified Advocate** can speak in all general channels. Encourages signup.
- **@State Lead** is granted manually after vetting. Gets mod power in their own state channel only.
- **@Verified Vendor** is auto-granted by the iKratom bot when a user is approved as a vendor on the platform (Phase 2 OAuth integration).

---

## Channel layout

### 📌 INFO category (read-only for most)
```
#welcome           — pinned: rules, signup link, mission
#announcements     — admin-only post; iKratom bot posts campaign launches
#server-rules      — server etiquette, off-topic policy, etc.
#mission           — copy of docs/VISION.md key bullets
```

### 🔔 ALERTS category (auto-fed by webhooks)
```
#federal-bills     — federal kratom bills, all auto-classified hostile/friendly
#state-bills       — all state bills (high-traffic; consider per-state spinoffs)
#campaigns-live    — when an admin publishes a campaign
#wins              — passed bills, killed bills, victories
```
**Webhook channel pattern:** create webhook in each channel → paste URL into iKratom `/admin/discord-integrations` → pick which events post here.

### 💬 GENERAL category (community talk)
```
#general           — main chat
#lounge            — casual, off-topic-ok
#help              — questions about the platform
#intl-farmers      — for SE Asian growers; multi-language welcome
#shop-talk         — vendor discussion (verified vendor only post)
```

### 📋 ACTION category (working space)
```
#strategy          — planning by state leads + admins
#flag-this         — community moderation reports
#feedback          — feature requests, bug reports
#testing           — for testing webhooks / bot commands
```

### 🎙 VOICE category — "war room"
```
🎙 Strike Team      — action coordination during campaigns
🎙 Planning Room    — long-form strategy
🎙 Casual Lounge    — drop-in voice
🎙 State Lead Calls — admin-only
```

---

## Auto-mod (Discord native)

Discord ships built-in auto-mod. Enable these:

| Filter | Threshold | Action |
|---|---|---|
| Spam (5+ messages in 5 sec) | medium | timeout 10 min |
| Mention spam (5+ unique mentions) | low | block message |
| @everyone protection | always | block for non-admins |
| Discord-curated word filter | "racist + sexist" | block message |
| Custom word filter | crypto-shill terms | flag to admin |
| Repeating messages | 3 in a row | block |
| Link cooldown in #general | 60 sec between any links per user | block second link |

---

## Bot setup (when iKratom bot ships in Phase 4)

When you create the Discord application at
https://discord.com/developers/applications:

1. **General Information** — name "iKratom," description copied from docs/VISION.md elevator pitch
2. **Bot** tab → enable "Public Bot" off (single-server only for v1)
3. **Bot scopes/permissions** when generating invite URL:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `View Channels`, `Send Messages`, `Embed Links`, `Manage Webhooks`
   - **NEVER grant Administrator.**
4. Save the **Bot Token** to Vercel env as `DISCORD_BOT_TOKEN` (NEVER share in chat)
5. Save the **Application ID** for OAuth flows

Phase 4 will use this for verified-server membership badges. Phase 1
(webhook outbound) doesn't need a bot at all — webhooks are simpler.

---

## Recommended welcome flow (manual setup)

In `#welcome`, pin a message like this:

```
🌿 Welcome to the iKratom War Room.

We're a nonpartisan advocacy network for the kratom community.
Bills, campaigns, strategy — all coordinated here, with action
tools at https://www.ikratom.org

To get @Verified Advocate role:
1. Sign up at https://www.ikratom.org/signup (free, no card)
2. React to this message with ✅
3. Bot will assign your role within 60s

Questions: #help
Bill alerts: #federal-bills, #state-bills
Strategy: #strategy (after verification)

Mission: docs/VISION.md
```

The reaction-based role assignment requires the iKratom bot (Phase 4)
or a third-party reaction-roles bot like Carl-bot or MEE6 (free) for
the interim.

---

## Phased Discord build

This server is configured manually. The integrations between iKratom
and the server come in phases:

| Phase | What | Built? |
|---|---|---|
| 0 | Manual server config (this doc) | You |
| 1 | Webhook outbound: bill/campaign alerts auto-post to channels | Coming next PR |
| 2 | Discord OAuth login on iKratom — "Sign in with Discord" | Designed, not built |
| 3 | Per-server attributed recruitment links | Designed, not built |
| 4 | iKratom bot — verified-membership badges + slash commands | Designed, deferred |

Setting up the server now (Phase 0) means Phase 1 can drop in
immediately when ready.

---

## Voice / radio Kratom global vision

The user has expressed interest in **realtime voice communications
across the network** — "war room voice," "Radio Kratom Globally."

Discord voice channels handle this for free for any-time-of-day chat.
For coordinated broadcasts (one-to-many, scheduled), options:

- **Discord Stage Channels** — built-in, free, supports moderated audience + speakers; perfect for "Bill X dropped, here's what to do" briefings
- **WebRTC inside iKratom** — embed voice rooms in the platform itself (LiveKit Cloud free tier: 50 minutes/user/month). Phase 5+ scope.

For Phase 0 + 1, Discord voice channels are sufficient. Add a Stage
Channel for scheduled briefings (#war-room-broadcast) when active
campaigns warrant it.

---

## Security / privacy posture

- Discord IDs are **pseudonymous** — we never assume the username is real identity.
- Webhook URLs in `#federal-bills` etc. are **shared secrets** — anyone with the URL can post to that channel. We treat them like API keys (never log in plaintext, mask in admin UI).
- Voice channels are **end-to-end encrypted by Discord between users** but Discord can technically log metadata. Truly sensitive coordination (legal strategy, etc.) should use the iKratom encrypted DMs instead.
- The server is a recruiting + coordination layer; the *platform* is the action layer. The two should not be confused.
