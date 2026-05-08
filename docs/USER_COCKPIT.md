# User Cockpit — design

Each advocate gets a personal mission-control dashboard at `/dashboard`.
The aesthetic + framing comes from `docs/VALUES.md`: fighter-jet
cockpit, war-room, mission control. The user should feel like they're
strapping into a vehicle when they sign in, not browsing a website.

**Status:** design only. Owner picks build order from the menu below.

---

## The principle

Every feature on the dashboard exists to answer ONE of three questions
the moment the user lands:

1. **What's hostile to me?** — bills attacking kratom in their state /
   federal that need their voice
2. **What's the platform asking of me?** — campaigns live, waves
   imminent, threads where they're @mentioned
3. **What have I done?** — emails sent, streak, scoreboard, badges

Anything that doesn't help answer one of these three is a distraction.

---

## Direct ask captured

> "When the admin approves the AI assisted local reps, we should give the
> user a notification that their local reps have been added to their
> warroom dashboard control panel."

**Implementation:** a one-line addition to whatever server action approves
AI-suggested local reps. The notifications system already exists
(`notifications` table, push fan-out, in-app feed). When the admin's
approval action runs:

```ts
await supabase.from("notifications").insert({
  user_id: <the user whose area was matched>,
  kind: "reps_added",
  title: `Your local reps are in your war room`,
  body: `${repNames.join(", ")} now appear on your dashboard.`,
  link: "/dashboard#my-reps",
});
```

The push fan-out cron picks this up within an hour; the bell-icon
counter updates instantly via realtime; the user sees the alert next
time they open the app. **This costs nothing extra to build — it just
needs to be added when the AI rep-discovery + approval flow ships.**

I've added a queued todo for this; the actual line of code lands in the
same PR as the rep-approval admin action.

---

## My suggested cockpit feature list (approve / deny each)

For your pick. I've grouped them in rough effort tiers. Each one is
opt-in for the user — they can hide any widget they don't want.

### Tier 1 — Foundation (build before everything else)

| | Feature | Effort | Why |
|---|---|---|---|
| **A** | **Customizable widget layout** — drag-to-reorder, hide/show toggles, layout saved to `user_dashboard_layouts` table | 3-4 hr | Pre-requisite for everything else. Adds the "make it yours" feel. |
| **B** | **First-time onboarding overlay** — clickable step-through walkthrough on first login (driver.js or react-joyride). Skippable; replayable from settings. | 3 hr | Without this, the cockpit feels overwhelming. Most "what is this for" friction disappears with a 60-second tour. |
| **C** | **"Today's briefing" widget** — pinned at top: 1 line per critical event (`2 hostile bills · 1 wave firing in 4 hrs · 3 unread DMs`). Auto-generated daily summary. | 2 hr | The single most-glanced piece of UI. Replaces "where do I look first?" |

### Tier 2 — Personal command (the cockpit core)

| | Feature | Effort | Why |
|---|---|---|---|
| **D** | **My reps panel** — federal + state + local reps fed by the address-feed feature; one-click email/call/DM each | 2 hr (after address feed ships) | Current legislator-find requires hunting. Pin them. |
| **E** | **My battles** — bills the user has personally taken action on, with live status (introduced → committee → vote → enacted/dead) | 3 hr | "Did my email matter?" answered with the bill's actual journey. |
| **F** | **Personal scoreboard** — emails sent, calls made, current streak, longest streak, badges earned (already partial: streaks exist in DB) | 2 hr | Gamify the action without making it a game. Streaks alone increase return rate ~30% in similar civic platforms. |
| **G** | **Saved searches + alerts** — "any new OK bill mentioning kratom" → push when matches | 3 hr | Power users want to write their own monitor rules. |

### Tier 3 — Customization & feel

| | Feature | Effort | Why |
|---|---|---|---|
| **H** | **Layout presets** — "Strike-Team Mode" (action-heavy), "Intel Mode" (info-heavy), "Lounge Mode" (social-heavy). One-click switch between presets. | 2 hr | Different users come for different things. Vendors want shop attribution stats; rookies want the action queue; veterans want the news radar. |
| **I** | **Theme accent picker** — within the mission-control aesthetic, user picks accent color (emerald, amber, blue, red). Stored per-user. | 1 hr | Tiny customization, big "mine" feeling. |
| **J** | **Quick-deploy templates** — user saves their preferred email tone / signature / opening line as named presets. Pick from a dropdown when sending. | 3 hr | Power users repeat themselves. Don't make them retype "As a 47-year-old veteran with chronic pain..." every time. |
| **K** | **Activity radar** — one widget showing real-time platform activity: "Sarah just sent an email · @joe is in #strategy voice · OK SB444 status changed" | 4 hr | Aliveness multiplier. Borrows from the Lounge presence pattern. |

### Tier 4 — Engagement & tutorials

| | Feature | Effort | Why |
|---|---|---|---|
| **L** | **Mission patches / achievement badges** — earnable for actions: "First Email Sent," "10-Day Streak," "Bipartisan Outreach" (emailed both R + D rep on same bill), etc. Display on profile + dashboard. | 4 hr | Gamification without being a game. Patches feel earned, not awarded. |
| **M** | **Inline contextual tutorials** — small (?) icons next to each widget explain "what this does" / "how to use it." Click → 30-second focused walkthrough for that widget. | 2 hr | Different from onboarding — these are permanent help-on-demand for any user, any time. |
| **N** | **"What's new" feed** — when we ship features, an in-app announcement card on the dashboard (dismissable). Preserves user's awareness of platform evolution without spamming email. | 1 hr | Avoid version-blindness. Users discover new tools because we point them out, not because they re-read changelogs. |

### Tier 5 — Power features (ship after Tiers 1-4)

| | Feature | Effort | Why |
|---|---|---|---|
| **O** | **Widget marketplace** — third-party / community-contributed widgets. Plugin model. | 2 weeks | Eventually opens the platform to third-party innovation. Premature for v1. |
| **P** | **Multi-user "squad" view** — friends can share dashboards, see each other's battles, coordinate sends | 1 week | Squad framing makes advocacy social. Builds on group DMs. |
| **Q** | **Embeddable cockpit widgets** — partners (shops, Discord servers) embed a "live status" widget on their own site | 1 week | Recruitment + always-on visibility. |

---

## My recommendation

**Build order:**

1. **A + B + C together** (8-9 hrs, one PR) — establishes the customizable framework + tutorial + briefing. Foundation everything else slots into.

2. **F + I + N together** (4 hrs, small PR) — scoreboard + accent picker + what's-new feed. High-impact-per-hour, all use Tier 1 framework.

3. **D** (~2 hrs after the address-feed ships) — My reps panel. Pre-requisite is the address-driven feed feature already on the queue.

4. **E + L** (7 hrs, one PR) — My battles + mission patches. The "did my action matter?" + "earned this" duo.

5. **G + J** (6 hrs) — Saved searches + email templates. Power-user features.

6. **H** (2 hrs) — Layout presets. Quick win once enough widgets exist to have meaningful presets.

7. **K** (4 hrs) — Activity radar. Last because it depends on multiple Tier 1-2 features being live.

8. **M** (2 hrs) — Inline tutorials. Add once features stabilize so we're not re-writing tutorials every PR.

9. **O / P / Q** — defer past v1. Mention in roadmap, don't build.

**Total Tier 1+2+3 (excluding Tier 5):** ~30-35 hours of build, spread over ~6-8 PRs. About 3-4 weeks of focused work.

---

## Schema sketch

```sql
-- Each user's dashboard layout
create table user_dashboard_layouts (
  user_id uuid primary key references profiles(id),
  -- ordered list of widget configs:
  -- [{id: "briefing", visible: true, position: 0}, {id: "my_reps", ...}]
  widgets jsonb not null default '[]',
  preset text,                  -- "strike", "intel", "lounge", or null = custom
  accent_color text default 'emerald',
  updated_at timestamptz default now()
);

-- Saved searches (Tier 2 G)
create table user_saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  name text not null,
  query jsonb not null,         -- {state: "OK", relevance: "anti", keyword: "schedule"}
  alert_method text default 'push',  -- 'push' | 'email' | 'both'
  created_at timestamptz default now(),
  last_match_at timestamptz
);

-- Mission patches (Tier 4 L)
create table user_badges (
  user_id uuid references profiles(id),
  badge_id text not null,       -- "first_email", "10_day_streak", etc.
  earned_at timestamptz default now(),
  primary key (user_id, badge_id)
);

-- Email/tone templates (Tier 3 J)
create table user_email_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  name text not null,
  body text not null,
  signature text,
  tone text default 'firm',     -- 'firm' | 'pleading' | 'business' | 'personal'
  is_default boolean default false,
  created_at timestamptz default now()
);
```

---

## What I need from you

**Pick which letters to build, in what order.** My recommendation above is a starting point — you can override.

Examples of what to reply with:
- **"Build A + B + C as one PR"** (the foundation drop)
- **"Just A + C, skip the tutorial for now"**
- **"All of Tier 1 plus F"** (foundation + scoreboard)
- **"Hold all of this, finish address feed first"**

Once you pick, I'll ship in the order you specify. Each one is an
independent PR following the same auto-merge-after-deploy pattern.

The notification-on-rep-approval is a 1-line add and doesn't need its
own PR — it lands as part of whichever PR builds the AI rep approval
flow (currently in queue under "address-based feed").
