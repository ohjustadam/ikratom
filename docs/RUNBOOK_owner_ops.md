# Owner ops runbook — running iKratom with zero developer access

This is the "if we lose access to Claude (or any developer) tomorrow" document.
The platform is built to run itself; this page tells you, the owner, how to
operate, diagnose, and fix it **from inside the site**, with nothing but a
browser (or the desktop app) and your admin login.

---

## 1. Your command center

Everything below lives under **`/admin`** (sign in as owner/admin first).

| Surface | What it's for |
|---|---|
| **🧭 `/admin/ai-editor` — AI Editor-in-Chief** | Your daily driver. A free in-house AI you chat with. It reads live site status, **looks things up itself** (bills, campaigns, officials, review queues, cron health, recent errors), diagnoses problems, and **proposes actions you confirm with one click** — run a sync, approve/reject a pending campaign or alert, auto-resolve a whole queue, fix a wrong field. Nothing runs without your click; everything is audit-logged. |
| **🛡 `/admin/moderation`** | The unified review hub. One-click **Auto-resolve** clears the campaign + intel queues (dedup → supersede, junk → reject, verified-real → approve). A nightly cron does the same with zero clicks. |
| **🛠 `/admin/master-edit`** | Spreadsheet-style editor over bills, campaigns, officials, alerts, and states. Search → edit whitelisted fields inline → review the exact before→after diff → apply (audited). Use it for anything the AI editor proposes that you'd rather do by hand, or for batch fixes. |
| **📊 `/admin/intel-health`** | Pipeline observability — per-source freshness + recent failures. Green = the blood is flowing. |
| **🧪 `/admin/data-quality`** | Known data-integrity issues across bills/alerts/news, trending to zero. |
| **📮 `/admin/user-errors`** | User-reported errors. An auto-fix classifier handles user-side issues silently; real patterns bubble up here. |
| **🤖 `/admin/ai-control`** | Live status of the free AI providers (Ollama / Gemini / Groq) + quotas. |
| **📜 `/admin/audit`** | Every sensitive action ever taken (by you, by admins, by the AI editor's confirmed actions). |
| **🕹 `/admin/console`** | The nuclear option: manual cron triggers + raw SQL. Owner-only. Prefer the surfaces above. |

## 2. The desktop program

**The iKratom desktop app is your dedicated PC program.** It's a native
Windows window around the live site — same login, same admin panel, zero
maintenance (it always shows the latest deploy; there is nothing to update).

- Install: the **`/install`** page on the site → "Windows app" (or the PWA
  "Install" button — identical result, and the PWA gets desktop push).
- Open it → sign in → go to `/admin`. That's the command center, as a local app.
- Everything in this runbook works identically in the app, a browser, or your phone.

Why we didn't build a separate local editor program: a standalone app with its
own database access would need its own copies of the security rules, its own
updates, and its own secrets on your PC. Putting the full ops capability
**inside the site** means one security model (RLS + audit + MFA), one deploy,
usable from any device — and the desktop app wraps it natively for free.

## 3. The forever-free guarantee

- **AI:** every AI feature routes through the free chain (Groq → Gemini →
  Ollama, plus the script-side router's larger free pool). If one provider
  dies or rate-limits, the router falls through to the next automatically.
  Paid AI is disabled by platform policy — nothing on the site can silently
  start costing money.
- **Hosting:** Vercel Hobby (free) + Supabase free tier + GitHub Actions
  (free for public repos) + your box for the two residential-IP jobs.
- **Email:** mailto only — the user's own mail client sends, we never pay.
- If a free tier ever shrinks: the site keeps running; the affected feature
  degrades (slower AI, staler data) rather than breaking. `/admin/ai-control`
  and `/admin/intel-health` show you which leg is limping.

## 4. Self-healing (what runs without you)

- **Hourly (GitHub Actions):** news intake → enrich → actions → watchdog.
- **Daily (Vercel + GHA cloud chassis + box nightly):** bill/legislator syncs,
  state briefings, campaign generation + cleanup janitors, queue clearing,
  staleness self-checks.
- **Weekly:** portraits, elections, topic classification.
- Every job writes telemetry (`scraper_runs`); a staleness checker pages you
  (push notification) when a source goes quiet. The moderation queues drain
  themselves nightly; the AI editor and `/admin/moderation` are your manual
  override.

## 5. Common situations → what to do

| Symptom | Fix (no developer needed) |
|---|---|
| Data looks stale (bills/news/briefings) | Ask the AI editor "what's stale?" → confirm its `trigger_cron` proposal. Or `/admin/console` → run the sync. |
| Review queue piling up | `/admin/moderation` → Auto-resolve (or ask the AI editor to do it). |
| A bill shows the wrong status | AI editor: "look up <bill> — is its status right?" → confirm the fix. Or `/admin/master-edit` → Bills → edit `status`. |
| Wrong contact info on an official | `/admin/master-edit` → Officials, or ask the AI editor. |
| A user reports something broken | `/admin/user-errors` — most user-side issues auto-classify; real bugs need a coding session (see §6). |
| A cron source shows ERROR for days | AI editor: "show recent errors" — if it's an external site being down, it self-retries; if it persists >3 days, note it for a coding session. |
| Site is being abused / emergency | `/admin` → emergency controls (read-only mode / kill switches gate the automation too). |

## 6. What still needs a coding session

Code changes, database migrations, new features, dependency updates. The AI
editor will tell you when something crosses that line — it's honest about not
being able to edit code (free models can't do that safely).

When you get developer access (any capable AI coding tool or human):
1. Point them at **`AGENTS.md`** (repo root) — the cold-start brief.
2. Then **`private/V2_KICKOFF.md`** on the main checkout — what's in flight.
3. House rules: one focused PR, `npm run verify`, squash-merge, migrations via
   `npm run db:push`.

## 7. Keys that keep the lights on

Names only (values live in Vercel env, GitHub Actions secrets, and `.env.local`
on your box — never in this repo): Supabase URL/keys, `CRON_SECRET`,
`LEGISCAN_API_KEY`, `OPENSTATES_API_KEY`, Groq/Gemini/etc. free AI keys, VAPID
push keys, Google/Discord OAuth ids. If one is revoked/expired, the matching
feature degrades and `/admin/intel-health` or `/admin/ai-control` shows it.
Rotating a key = update it in Vercel (site) and GitHub secrets (crons), then
redeploy — no code change.
