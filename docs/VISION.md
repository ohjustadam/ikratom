# iKratom — Vision & elevator pitch

A canonical short-form description of what we're building. Use this when
introducing the platform to outsiders, journalists, potential partners,
or new collaborators.

---

## The 60-second pitch

iKratom is the **war room for kratom advocacy** — a nonpartisan
political action platform that turns hours of advocacy work into a few
minutes a day.

While most "civic engagement" tools are glorified email forms, we are
building a coordinated action engine:

- **Real-time bill tracking** across all 50 states + federal Congress, with deep PDF analysis classifying every bill as friendly or hostile to natural-leaf kratom — not via keyword matching, but via local LLM understanding the actual statute text.
- **One-click legislator emails** that find your reps from your address, prefill a personalized message, and send via your own Gmail — so the email appears genuinely from you, not from a service.
- **Auto-generated campaigns** the moment a hostile bill drops. Within seconds, every matched advocate gets a push notification, an in-app alert, and an email.
- **A live community Lounge** with realtime chat, presence ("12 online now"), spam/bot defenses (URL gating, flood detection, rate limits, mute history with ban-review queue).
- **A printable shop kit** — register a partner shop in the admin portal, print a 4-piece counter set with QR codes that credit signups back to that shop.
- **Multi-language support** — Indonesian, Thai, Malay, Vietnamese, Filipino — for the SE Asian farmers and distributors at the source of supply.
- **End-to-end encrypted DMs** so the war-room can plan privately.
- **Web push notifications** for instant alerts even when the browser is closed.
- **Multi-AI orchestration** — Claude for novel work, Gemini for grounded research, Ollama (local) for privacy-sensitive bulk work, Groq for speed — with a router that picks the right model for each task.
- **Discord integration** so existing kratom communities can paste a webhook and get bill alerts in their server channels.
- **A vendor verification system** so businesses can co-advocate with dual signatures legally and clearly.
- **Audit logs on every privileged action**, MFA, password breach detection, IP-based rate limiting, security policies in the database itself.

All free-tier hosted (Vercel + Supabase + Cloudflare + Ollama), open architecture, everything documented in `/docs`. Built so any engineer could be productive in a week.

**Most "send emails to your reps" tools are sending postcards. We're building air traffic control.**

---

## The "why now"

Kratom is at an inflection point. Multiple states actively considering
schedule-1 bans. The DEA has flirted with federal scheduling. The
community is large (15M+ users in the US alone) but politically
disorganized — fragmented across forums, Discord servers, vendor
mailing lists, Reddit threads. There is no central command + control.

The opposition is well-funded, focused, and runs through a small
number of legislative offices. **An advocacy community of 15M people
with no coordinated layer is a community of zero.** Our job is to
build that layer — not to lead it, just to enable it.

---

## Hard rules (from CLAUDE.md, restated for clarity)

- **Nonpartisan.** The platform is a tool, not a faction.
- **Empower the advocate, not the org.** Features remove friction for the individual.
- **One-click is the standard.** >2 clicks for any action = broken.
- **Free-tier only for v1** — proves we can scale before raising money or charging users.
- **Real data only** — bill status, legislator info, news scraped/synced; never manually curated past initial seed.
- **Recruitment angle.** Shop owners, medical pros, SE Asian farmers, Discord communities are first-class users.
- **Open source aesthetic.** Code documented, decisions logged, AI-assisted from day one.

---

## Aesthetic & feel

The platform should feel like **mission control** — heads-up display,
real-time data streaming, ambient awareness of what's happening across
the network. Not a corporate dashboard.

Metaphors that should resonate when designing UI:
- **Fighter jet cockpit** — every datum at-a-glance, no hunting through menus
- **War room** — multiple feeds, voice/text comms, situational awareness
- **Air traffic control** — coordinated movements, every advocate is a pilot, every campaign is a flight plan
- **Operations center** — calm under pressure, briefing rooms, deployable assets

What this is **not**:
- A social media app (we don't optimize for engagement, we optimize for action taken)
- A news aggregator (we summarize, but we exist to drive action on what's summarized)
- A marketplace (Iron Gate is the marketplace; iKratom is the action engine)

---

## What "winning" looks like

- 10,000+ advocates onboarded across all 50 states within 12 months
- Every state with a kratom bill has at least 50 active iKratom users in that state
- Every shop in our partner network adds 20+ users/month via QR code
- Major Discord communities (multi-thousand-member) integrated via webhook
- Average advocate sends 10+ legislator emails per quarter (~40K/year for a 10K userbase)
- One major win: a hostile bill dies in committee with iKratom-driven email volume cited as a factor
- The platform itself is open source enough that other movements (cannabis, psychedelics, gun rights, anti-surveillance) could fork it

---

## Where this fits in the broader picture

iKratom is a proving ground. The bigger thesis: **disorganized
communities deserve organizing tools that aren't owned by a political
party or corporate platform.** The kratom community is a perfect
testbed because it's:
- Large enough to validate the model
- Politically diverse (cuts across left/right)
- Already engaged but lacking infrastructure
- Genuinely threatened (gives users skin in the game)
- Not currently captured by any major political org

Build it for kratom. If it works, the architecture transfers anywhere
a community needs to act in concert without surrendering to a faction.
