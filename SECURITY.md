# Security Posture — iKratom

This document captures the platform's current security posture, the
threat model we design against, and known issues we're aware of.

If you've found a vulnerability, see [Reporting](#reporting) below.

---

## Threat model

iKratom is a public-facing political-advocacy platform. Realistic
threats, ranked:

1. **Spam / commercial abuse** — actors trying to use the forum or DMs
   to push product. Addressed by the forum moderation system (auto-flag
   of non-whitelisted URLs / contact info, first-3-posts review queue,
   user reporting). DMs are E2E encrypted so server-side spam scanning
   isn't possible there; user blocking + report flow apply.
2. **Account takeover** — credential stuffing, phishing. Mitigated by
   strong-password requirement, rate limits on auth endpoints, MFA
   (TOTP + backup codes), audit log of admin mutations.
3. **Stored XSS** in forum / profile / library — addressed by strict
   tag/attr whitelist sanitizer in `src/lib/markdown.ts`. Test coverage
   in `src/lib/__tests__/markdown.test.ts`.
4. **Privilege escalation** — addressed by RLS on every table,
   service-role isolation in audit/backup-code helpers,
   `getAdminContext()` guard on all admin mutations,
   `requireMfaForMutation()` aal2 enforcement.
5. **Mass assignment** — every server action explicitly projects fields
   from FormData; no bulk inserts. Role flags (`is_admin`, `is_owner`,
   `is_advocate_leader`) are only writeable via the dedicated
   `setUserRoles()` admin action.
6. **Hostile scraping** — public data is intentionally public.
   Authenticated areas (forum write, DMs, account) require login.
   Forum + profile RLS hides per-user data from anon callers.
7. **DB bloat / DoS** — length caps on every text input, rate limits on
   auth + reporting endpoints.
8. **Forged campaigns** — campaign creation requires `is_admin`,
   `is_owner`, or `is_advocate_leader` plus aal2 if MFA enrolled.

Out of scope:
- Targeted state-actor attacks (no PII worth that level of effort)
- Physical security of operator's laptop (operator's own concern)
- Vulnerabilities in Supabase / Vercel (we trust upstream)

---

## What's deployed

### Transport
- TLS via Vercel (HSTS preload header set; 2-year max-age)
- HTTP → HTTPS redirect via Vercel default
- `upgrade-insecure-requests` directive in CSP

### HTTP security headers (`next.config.ts`)
| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera/mic/geo/cohorts/topics all `()` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Content-Security-Policy` | strict; `connect-src` pinned to project Supabase URL only |
| `X-Powered-By` | _removed_ |

### Authentication
- Email + password via Supabase Auth (PBKDF2 hashing)
- Password floor: 10 chars, max 200
- Rate limits (per IP and per email):
  - signup 5/IP/hour
  - signin 20/IP/5min and 10/email/5min
  - password reset 3/IP+email/hour
  - password change 5/user/hour and 20/IP/hour
- MFA: TOTP via Supabase MFA + 8 single-use backup codes (SHA-256 hashed)
- Login step-up: if user has verified factor, redirected to `/login/mfa`
  before reaching protected routes
- Backup-code redemption sets `mfa_bypass_until` cookie (1 hour, HTTPOnly)
  since Supabase MFA is TOTP-only and we can't mint aal2 from a non-TOTP source
- Anti-bot on signup: hidden honeypot field + timing trap (<2s = silent drop)

### Authorization
- Row Level Security on every public-schema table
- `getAdminContext()` / `getCreatorContext()` guards on every admin mutation
- `requireMfaForMutation()` blocks sensitive writes from aal1 sessions if
  user has factors enrolled
- `_ikratom_migrations` ledger has RLS-with-no-policies (locked to
  service role only — see migration 0021)

### Data
- Direct messages end-to-end encrypted (libsodium / Curve25519 +
  XChaCha20-Poly1305); keys live in user browsers, server cannot read
- Supabase database encryption at rest (AES-256, provider-managed)
- Gmail OAuth refresh tokens encrypted at rest with a per-user key
  derived from a server secret
- Audit log of admin mutations (`admin_audit_log`) is append-only,
  admin-read RLS, service-role-write only — and protected against
  service-role tampering by before-update/delete triggers that raise
  42501 regardless of caller (PR #123)

### Application defenses
- Open-redirect protection in `signIn` action (`safeRelative()`)
- Email-enumeration defense on signup (PR #124): "user already
  registered" errors are caught and the success shape returned
  regardless, so an attacker can't probe which emails have accounts.
  Best-effort heads-up email to existing-account holder via Resend.
  Login + password-reset already had this protection.
- SSRF defense on admin-supplied URLs (PR #118): `src/lib/url-safety.ts`
  blocks non-http(s) schemes, private IPv4 (RFC 1918) + loopback +
  link-local (covers AWS/GCP/Azure IMDS endpoints), private IPv6,
  suspicious hostnames (`localhost`, `metadata.google.internal`,
  `*.local|internal|lan|home|corp|intra`), non-standard ports, and
  URLs with embedded credentials. Used by `updateBopSource` admin
  action; both BoP adapters (`generic_html.mjs`, `playwright_browser.mjs`)
  also enforce at fetch/navigate time as defense-in-depth.
- Library embed iframe-allowlist sanitizer (PR #121,
  `src/lib/embed-safety.ts`): `library_items.embed_html` is rendered
  with `dangerouslySetInnerHTML`. Only single `<iframe>` elements
  from YouTube / YouTube-nocookie / Vimeo accepted; canonical
  reconstruction adds `sandbox`, `referrerpolicy`, `loading="lazy"`.
  18 test cases including subdomain-prefix tricks
  (`evil.com.www.youtube.com`), `on*` handlers, multiple iframes,
  trailing junk.
- Forum moderation (`src/lib/moderation.ts`): detects non-whitelisted
  URLs, bare domains, US phone numbers, emails, BTC/ETH wallet addresses;
  first 3 approved posts on a new account go to review queue
- Markdown sanitizer (`src/lib/markdown.ts`):
  - Strict tag whitelist
  - Per-tag attribute whitelist
  - HTML-entity decoding before URL filter (blocks `javasc&#114;ipt:`)
  - All anchors get `rel="noopener noreferrer" target="_blank"`
  - All images get `referrerpolicy="no-referrer" loading="lazy"`
  - HTTPS-only `<img src>` (no http://, no data:)
  - `<script>`, `<style>`, `<iframe>`, `<svg>`, `<object>`, `<embed>`,
    `<noscript>` and HTML comments stripped wholesale
  - Test coverage: 22 cases including hex/decimal-entity obfuscation,
    case-mixed event handlers, javascript:/data:/http: in href and src

---

## Rules for future code

1. **NEVER** put `SUPABASE_SERVICE_ROLE_KEY` behind `NEXT_PUBLIC_`. NEVER
   import it in any file under `src/app/**` that is rendered as
   `"use client"` or imported by one.
2. **NEVER** accept role flags (`is_admin`, `is_owner`, `is_advocate_leader`,
   `is_shop_owner`, `is_medical_professional`) from form data on user-facing
   profile editors. The only writer is `setUserRoles()` in `user-actions.ts`.
3. **NEVER** trust `searchParams` or `params` directly — always validate
   format (state codes, slugs, UUIDs).
4. **NEVER** call `dangerouslySetInnerHTML` with user-sourced content unless
   it has gone through `renderMarkdown()` from `src/lib/markdown.ts`.
   Admin-sourced content (e.g. `library.embed_html`) is exempt — admins are
   trusted.
5. **NEVER** expose user email lists. The `profiles.email` column is
   self-only via RLS; the `get_public_profile()` RPC explicitly excludes it.
6. **ALWAYS** explicitly project fields from `FormData` — never spread
   `Object.fromEntries(fd)` into a DB write.
7. **ALWAYS** call `getAdminContext()` (or `getCreatorContext()`) +
   `requireMfaForMutation()` at the top of any sensitive admin server action.
8. **ALWAYS** add an `enable row level security` clause to every new public-
   schema table, even if it's just metadata. Run
   `mcp__supabase__get_advisors` after migrations to verify.
9. **ALWAYS** wrap fetch from inside server actions with `getClientIp()` +
   `checkRateLimit()` if the action can be invoked anonymously or could
   trigger expensive work.

---

## Known issues

### Moderate — postcss CVE in Next.js bundle
`npm audit` reports a moderate XSS in PostCSS <8.5.10 (unescaped
`</style>` in CSS stringify output) bundled inside our Next.js install.
The "fix" `npm audit` suggests is downgrading Next to 9.3.3, which is
absurd. We don't accept user-controlled CSS in our build pipeline, so
this is not exploitable in our application. Will resolve when Next.js
ships an updated bundle in a patch release.

### Low — CSP `unsafe-inline` for scripts
Next.js 16's RSC payload requires inline `<script>` and we haven't
migrated to nonce-based CSP. This narrows but does not eliminate XSS
defense from CSP. The strict markdown sanitizer + framework defaults
remain primary XSS defenses. Track upgrade when Next.js ships
first-class nonce support.

### Low — no session list / "sign out all other devices" UI
If a user's session token leaks, current recovery is to change the
password (which invalidates all sessions on Supabase). UI to view +
revoke individual sessions is not yet built.

### Resolved tonight (2026-05-11)
- ~~No breached-password check on signup~~ — `isPasswordPwned()` is
  called in `signUp`. HIBP k-anonymity API; fails open on network error.
- ~~No email alert on new device sign-in~~ — `recordSignIn()` triggers
  in-app notification + Resend email (when configured) on every
  not-previously-seen-on-this-account device fingerprint.
- ~~Audit log tamper risk via service-role~~ — fixed in PR #123 via
  before-update/delete triggers that work regardless of caller.
- ~~Email enumeration on signup~~ — fixed in PR #124.
- ~~`recordSignIn` callable as forged-notification vector~~ — fixed in
  PR #120 by dropping `"use server"` and switching to `server-only`
  module pattern.
- ~~Rate-limit gaps on forum threads/posts/reports + stories + DM
  conversations + admin support actions~~ — closed in PRs #119, #120.
- ~~`get_public_profile` exposed `recruiters_only` users~~ — fixed in
  PR #122; filter now `= 'public'`.

### Informational — backup-code recovery via owner
If a user loses their phone *and* their backup codes, recovery requires
the platform owner (`ohjustadam@proton.me`) to manually clear their
`auth.mfa_factors` row in the Supabase dashboard. Fine for current scale;
will need a self-service flow if user count grows past hundreds.

---

## Incident response

1. **Suspected key leak** → rotate the affected key in Supabase dashboard
   immediately. Update `.env.local` and Vercel env. Force-redeploy.
2. **Compromised user account** → disable user via Supabase Auth dashboard,
   invalidate all sessions for that user, audit `campaign_actions` and
   `forum_posts` for that user_id, audit `admin_audit_log` if privileged.
3. **DB-level abuse** → kill RLS-permitted abuse with a temporary policy
   update, then patch the action code.
4. **Spam wave on forum** → tighten moderation thresholds (e.g. drop the
   "first 3 posts" gate to "first 10"), rotate any email leaked in posts,
   ban offending accounts via `setUserRoles({ ... })` after Supabase
   `auth.users` ban_until update.

---

## Reporting

If you've found a vulnerability:

- Email: `ohjustadam@proton.me` (PGP key on request)
- Or use GitHub's private vulnerability disclosure: <https://github.com/ohjustadam/ikratom/security/advisories/new>

Please include:
1. Steps to reproduce
2. The affected endpoint or component
3. Your assessment of impact

We commit to:
- Acknowledge within 72 hours
- Reasonable-effort fix timeline (severity-dependent)
- Public credit if you want it (or anonymity if you prefer)

Out of bounds:
- Don't access data belonging to other users
- Don't run automated scanners against `/api/*` or `/auth/*`
- Don't perform attacks that degrade service for real users
- Give us a reasonable window before public disclosure

---

_Last reviewed: 2026-05-11 — see `git log SECURITY.md` for change history._
