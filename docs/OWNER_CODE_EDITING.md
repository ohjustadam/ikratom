# Editing iKratom yourself — without a Claude subscription

You asked: *"a Windows program I can download to edit iKratom, or a free
terminal LLM I could use."* Here's the honest, complete answer. There are **two
layers**, and most of what you do day-to-day is layer 1 (no coding at all).

---

## Layer 1 — run/fix the site with NO code (already built, forever free)

For operations, data fixes, and running automations you don't touch code at all:

- **`/admin/ai-editor`** — chat with the free in-house AI. Ask "what's broken?",
  "run the daily cron", "fix SB 891's status". It looks things up and proposes
  actions you confirm. (As of 2026-07-05 it can run **every** cron pipeline.)
- **`/admin/console` → "Run any pipeline"** — one-click run any automation.
- **`/admin/master-edit`** — spreadsheet-edit bills/campaigns/officials/alerts.
- **`/admin/ops`** — morning glance; **`docs/RUNBOOK_owner_ops.md`** is the map.

**~90% of "keep it running" needs never require a coding session.** Layer 2 is
only for actual code changes (new features, bug fixes, migrations, deps).

---

## Layer 2 — actual code editing on your PC, free

Real code editing needs a coding agent with repo access. Claude Code (what built
this) is the best, but here are **free** alternatives that run on your
PC/laptop and point at **free** model providers. You already have free API keys
in `.env.local` (Groq, Gemini, Cerebras, etc.), so a coding agent can reuse them.

### The tools (all free / open-source, "bring your own key")

| Tool | What it is | Best for |
|---|---|---|
| **Gemini CLI** | Google's official terminal agent; generous free tier, zero-cost to start | Easiest free start — `npm i -g @google/gemini-cli`, sign in with a Google account |
| **aider** | Mature terminal coding agent, model-agnostic, git-native (auto-commits) | Focused single/few-file edits; great diffs |
| **OpenCode** | Open-source terminal agent (TUI), model-agnostic | A Claude-Code-like TUI experience, free |
| **Cline** | VS Code extension (a "download a program" option) — GUI, BYO-key | If you prefer a window over a terminal |
| **Continue.dev** | VS Code/JetBrains extension, free | Inline edits + chat inside an editor |

> Install commands change over time — check each project's site for the current
> one. As of 2026-07 the two simplest free starts are **Gemini CLI** (Google
> account, free tier) and **aider** (`pip install aider-install && aider-install`).

### Recommended free setup (fastest path)

1. Install one: **Gemini CLI** (easiest) — `npm install -g @google/gemini-cli`,
   run `gemini` in `C:\claude\ikratom`, sign in with Google (free tier). Or
   **aider** and point it at your existing Groq/Gemini key from `.env.local`:
   ```bash
   pip install aider-install && aider-install
   # example using your existing Gemini key:
   aider --model gemini/gemini-2.5-flash
   ```
2. Point it at the repo root `C:\claude\ikratom` and tell it to **read
   `AGENTS.md` first** (that's the cold-start brief; the free model needs it).

### The honest caveat (important)

Free models (Llama-3.3, GPT-OSS-120B via Groq, Gemini Flash) are **noticeably
weaker** than Claude at editing a large, strict-TypeScript Next.js codebase.
Expect them to do well on:
- ✅ small, single-file fixes; copy/text changes; docs; simple components.

…and to struggle with:
- ⚠️ cross-file refactors, database migrations, subtle TypeScript type errors,
  anything touching auth/RLS/security.

**This is why the in-site AI editor deliberately does NOT edit code** — doing it
badly on the live site is worse than not doing it. For anything security-,
auth-, migration-, or money-adjacent, use a stronger model (Claude Code) or ask
carefully and review every line.

### Non-negotiable workflow (mirror `AGENTS.md`)

Whatever tool you use, keep the guardrails that keep the site safe:

1. **Never edit on `main`.** Make a branch: `git checkout -b fix/thing origin/main`.
2. **Verify before you trust it:** `npm run verify` (typecheck + tests). For UI
   changes, `npm run build`.
3. **Open a PR, let CI run, then squash-merge** (`gh pr merge --squash
   --delete-branch`). CI is your safety net against a bad free-model edit.
4. **Migrations** go through `npm run db:push` and touch production data — extra
   care; prefer a strong model or a human review for those.

### If you want a downloadable Windows "program" specifically

- **Cline** (VS Code extension) is the closest to "download a program": install
  VS Code → install the Cline extension → paste a free key (Groq/Gemini) → it's
  a chat panel that edits files. Free.
- **Cursor / Windsurf** are polished editors with AI, but their good tiers are
  paid — skip for free-only.
- The **iKratom desktop app** is NOT a code editor — it's the live site in a
  window (for using/administering, not developing).

### Bottom line
- **Running + fixing data/automations without code → already free, in-site.** Use it.
- **Editing code for free → Gemini CLI or aider on your PC, BYO free key,
  always via branch → verify → PR.** Good for small changes; use a stronger
  model for anything risky.
