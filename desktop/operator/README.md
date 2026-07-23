# iKratom Operator Shell

A **local control panel** for operating, debugging, and fixing iKratom — that
works when the public site is down and without Claude. It talks straight to the
platform APIs (Supabase Management API, GitHub, Vercel/Netlify) and to your
on-box free toolbox (Ollama / SearXNG via the AI router). Nothing routes through
www.ikratom.org — in an outage, the site is the one thing you can't reach.

## Run it

```bash
npm run operator
```

It prints a URL with a one-time token — open it in your browser:

```
http://127.0.0.1:8787/?t=<token>
```

That's it. No build step, no internet required for the app itself.

## Panels

- **Status** — one-click platform diagnosis (reuses `scripts/lib/rescue-tools.mjs`):
  is the site up? is Vercel blocking? is the database reachable? which crons are
  stale? what failed in CI? — with a plain-English verdict and next action.
- **Database** — run SQL through the Supabase Management API (open even when the
  app gateway is restricted). Click a table to browse it. **Reads are free;
  writes are blocked** unless you flip the "allow writes" toggle.
- **Ops** — recent GitHub Actions runs + one-click dispatch of any allowlisted
  cron/pipeline (confirm-gated).
- **Assistant** — a troubleshooter powered by the **free** AI router
  (Ollama/Groq/Gemini/…, never a paid API). It can see the latest diagnosis as
  context. This is the never-need-Claude brain.
- **Config** — which credentials are wired in (presence only — secret values
  never leave your machine).

## Security

- Binds to **127.0.0.1 only** — never reachable from another machine.
- Every `/api/*` call requires the per-launch **token** (defends against a
  malicious page in your browser POSTing to localhost). Static UI files aren't
  gated (they hold no secrets).
- **Writes are opt-in + confirmed** at both the UI and the server. A statement
  that looks like a write is refused unless you explicitly allow it.
- Reads `.env.local` for credentials; **never** sends secret values to the UI.

## Desktop app integration (next step)

The existing Tauri app (`desktop/src-tauri`) is currently a thin window onto the
live site — so it shows nothing when the site is down. The plan: bundle this
operator as a Node **sidecar** the Tauri app launches on start, and point the
window at `http://127.0.0.1:<port>`. Then the `.exe` itself is the operator
shell, offline-capable. The operator server works today via `npm run operator`;
the Tauri packaging is a thin wrapper on top and lands next.

## Extending it

Add an API route in `server.mjs` (the `api` object) and a panel in
`ui/index.html` + `ui/app.js`. The toolbox is all `.mjs` — import any of
`scripts/lib/*` directly (that's how Status and Assistant reuse rescue-tools and
the AI router verbatim).
