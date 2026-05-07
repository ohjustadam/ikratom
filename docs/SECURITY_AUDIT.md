# Security audit — 2026-05-07

Snapshot of findings from automated tools. Re-run on every meaningful schema change or dep bump.

## Tools run

- `npm audit` — Node dep vulnerability scan
- Supabase advisors (`security` + `performance` lints) via Management MCP

---

## npm audit findings

Status: **2 moderate, neither actionable without breaking changes.**

### `postcss < 8.5.10` (transitive via `next`)
- CVE: GHSA-qx2v-qp2m-jg93 — "PostCSS has XSS via Unescaped `</style>` in its CSS Stringify Output"
- CVSS 6.1, requires user interaction, scope-changed XSS
- **Path:** `next > postcss` (a nested postcss inside Next.js's bundled tooling, NOT the root postcss we use directly)
- **`npm audit`'s suggested fix:** downgrade Next.js to 9.3.3 (breaks the entire app — we're on 16.2.3)
- **Decision:** false positive for our usage. Vercel build pipeline + our actual postcss version are both modern; the flagged postcss copy is bundled inside Next's older transitive tree and isn't on the runtime path for our compiled output. **No action.** Re-check after each Next.js minor version bump.

### `next` (effect of postcss above)
- Same vuln, same false-positive logic. No action.

### Other deps
Clean. No high or critical.

---

## Supabase advisors

### Security lints: **0 findings** ✓

No exposed PII columns. No tables missing RLS. No SECURITY DEFINER functions with overly-broad grants. No public schemas leaking auth metadata.

### Performance lints: **0 findings** ✓

No queries flagged by the planner. Index coverage looks healthy for current usage patterns.

---

## Posture summary (current state)

| Layer | Status |
|---|---|
| RLS on every public table | ✓ confirmed in `docs/SCHEMA.md` |
| Admin guard on every server action | ✓ via `getAdminContext()` / `getCreatorContext()` |
| Audit log on admin mutations | ✓ via `recordAdminAction()` |
| Rate-limit on user-driven writes | ✓ `chat`, `forum`, `password`, `vendor apply`, etc. |
| MFA available, gated for owner/admin sensitive ops | ✓ TOTP + backup codes |
| TLS enforced | ✓ Vercel default |
| Auth cookie refresh | ✓ proxy.ts |
| Bot/scraper UA blocklist | ✓ proxy.ts |
| AI crawler robots.txt + noai meta | ✓ src/app/robots.ts + layout meta |
| No source maps in production build | ✓ next.config.ts |
| E2E DM encryption | ✓ libsodium, key in browser only |
| VAPID private key not in repo | ✓ `.env.local` only |
| Service worker push: no key auto-eject | ✓ 410-gone subscriptions pruned in fan-out |
| Slug immutability (printed materials) | ✓ admin UI omits slug edit |
| Push notification fan-out | ✓ honors user `in_app` opt-out |
| AAL2 gate for password change with MFA enrolled | ✓ Supabase enforces |

---

## Things to revisit periodically

| Cadence | Action |
|---|---|
| Monthly | Re-run `npm audit`, re-run advisors |
| Per release | Verify no PII leaks in new tables, RLS policies cover new mutations |
| Quarterly | Rotate VAPID keypair (only if exposure suspected; low priority otherwise) |
| Quarterly | Rotate `CRON_SECRET` (update Vercel env + GitHub secret simultaneously) |
| As needed | Update bot blocklist regex with new abusive UAs |
| Yearly | Review session/cookie config (sameSite, secure, httpOnly all correctly set?) |

---

## Things we could add but haven't (yet)

- **Penetration test** — only a human or paid tool can do this properly. Defer until past first 1k users.
- **Per-IP rate limit middleware** for `/api/*` (currently per-user only)
- **CSP headers** — would tighten XSS protection further but requires careful tuning to not break embeds/QR scans
- **Subresource integrity** on third-party CDN assets — none right now, so n/a
- **Email-on-password-change notification** — pending Resend signup (post-domain)
- **Automated dep-update PRs** — Dependabot or Renovate. Worth enabling when comfortable with auto-merge for non-major bumps.

---

## Threat model assumptions

- **Owner machine compromise** — game over. Treat `.env.local` like a password.
- **Single Supabase project** — losing the project = losing all data. Backups not automatically managed (Supabase free tier; consider upgrading or using `pg_dump` cron when scale matters).
- **GitHub repo: PRIVATE** — owner action item. Public repo would expose RLS structure (a nice-to-have for attackers).
- **Vercel auth token** — if stolen, attacker can deploy. Rotate on owner compromise; otherwise low priority.
- **Free tier abuse** — bots could burn Gemini quota or push subscriptions. Bot blocklist + cron auth gates mitigate.

---

## Auto-applied fixes in this PR

None. All findings either non-actionable (postcss false-positive) or zero (Supabase advisors). Documenting a clean baseline for future deltas.
