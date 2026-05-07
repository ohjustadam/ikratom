# Glossary

Definitions of in-house terms. Saves "what does this mean?" grep loops for new contributors and AI agents.

## Domain — kratom advocacy

| Term | Definition |
|---|---|
| **kratom** | Plant (Mitragyna speciosa) sold OTC in the US for pain, energy, opioid-cessation. Heavily contested by FDA + some states. |
| **7-OH** | 7-hydroxymitragynine. A *natural* alkaloid in kratom that's also being synthesized + sold in concentrated form. Many bills target the synthesized version while accidentally outlawing the natural plant. The platform pays close attention to this distinction (`bills.targets_natural_leaf` vs `bills.targets_synthetic_only`). |
| **KCPA** | Kratom Consumer Protection Act. Industry-friendly state legislation requiring labeling, age limits, banning adulterated products. Generally pro-advocate. |
| **Schedule I** | Federal controlled-substance category. Bans research, sales, possession. Anti-kratom bills typically aim here or for state-level Schedule equivalents. |
| **AKA** | American Kratom Association. Largest trade org. Pro-KCPA. |
| **GKC** | Global Kratom Coalition. Industry org. |
| **BAE** | Botanical Action Education. Advocacy org. |
| **MAC** | Mitragyna Action Coalition. Advocacy org. |
| **Adulteration** | Spiking kratom with synthetics (kratom + tianeptine, kratom + opioid analogs). What KCPA aims to ban. |

## Platform — iKratom internals

| Term | Definition |
|---|---|
| **owner** | The single root account. `profiles.is_owner = true`. |
| **admin** | Promoted by owner. Can moderate users, sync data, manage campaigns. `profiles.is_admin = true`. |
| **advocate leader** (or "creator") | Authors campaigns + waves. Below admin. `profiles.is_advocate_leader = true`. |
| **scope** (campaign scope) | Geographic + jurisdictional reach: `state:OK`, `local:tulsa-ok`, `federal`. Notifications fan out by matching scope to user's profile. |
| **wave** | A scheduled batch send of a campaign action. Users join → at fire time, server sends a personalized email to each user's matched legislator(s). |
| **action** | A single advocate event: email sent, call logged, town-hall RSVP, story submitted. Logged in `campaign_actions`. |
| **lounge** | The global live chat room on `/forum`. Realtime, presence, ephemeral. Different from forum threads. |
| **thread** | Long-form forum post in a state-keyed forum. Persistent. Indexed for search. |
| **partner** | A real-world shop registered by admin. Has slug used in printable kit QR codes. **Different** from a `profile` with the "shop owner" self-flag. |
| **vendor** (verified) | A shop owner whose business representation is admin-approved. Can sign campaign emails as the business. Distinct from partner record. |
| **scope match** | DB-level rule: a campaign with scope `state:OK` notifies users whose `profiles.state = 'OK'`. |
| **deep analysis** (bill) | LLM-driven extraction of a bill's actual text intent — does it target plain leaf, only synthetics, or both. Migration 0030. |
| **embed referral** | When a user lands via `?ref=embed&host=<slug>`, `proxy.ts` sets a 60-day cookie. Subsequent campaign actions get `referred_from = <slug>` for partner attribution. |
| **FED** | Special state code meaning "federal." Used for federal-jurisdiction bills + the national forum board. |

## Tech / infrastructure

| Term | Definition |
|---|---|
| **proxy.ts** | Next.js 16's replacement for `middleware.ts`. Same purpose (request preprocessing), different filename. |
| **Realtime presence** | Supabase Realtime feature: clients in a channel announce themselves; server tracks the set; "X online now" counter. |
| **Realtime postgres_changes** | Supabase Realtime feature: clients subscribe to INSERT/UPDATE/DELETE on a table; payloads delivered respecting RLS. |
| **REPLICA IDENTITY FULL** | Postgres setting on a table: full row logged in WAL on UPDATE/DELETE. Required for Realtime DELETE events when filtering on non-PK columns. |
| **SECURITY DEFINER** | Postgres function attribute: runs with the privileges of the function owner, not the caller. Used to bypass RLS for narrow, whitelisted reads (e.g. `get_public_profile`). |
| **Auto-flag** | New-account / link / pattern-based forum flagging. Routes posts to admin queue instead of going public. |
| **Backup codes** | Single-use 6-digit codes for MFA bypass. Each redeems for a 1-hour aal2 grace window. |
| **AAL** | Authenticator Assurance Level. `aal1` = password only. `aal2` = password + TOTP. Some sensitive admin actions require aal2. |
| **VAPID** | Voluntary Application Server Identification. Asymmetric keypair used for Web Push. Public key in browser, private key on server. |
| **CRON_SECRET** | Bearer token gating `/api/cron/*` endpoints. Same value lives in Vercel env + `.github/workflows/cron-hourly.yml` repo secret. |
