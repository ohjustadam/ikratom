# iKratom — Security Notes

## Threat model
iKratom is a public-facing political action platform. Worst-case attacks:

1. **Account takeover** — attacker gains a user's session and sends emails to legislators in their name. Reputational harm.
2. **DB exfiltration** — attacker reads `profiles` table to harvest names + addresses of advocates.
3. **DB bloat / DoS** — attacker spams writes to bloat the free-tier DB.
4. **Forged campaigns** — attacker writes a fake campaign that sends out a bad-faith message.

## Controls in place

| Control | Where | Threat |
| --- | --- | --- |
| RLS on `profiles` and `campaign_actions`, self-only | `supabase/migrations/0001_init.sql` | DB exfiltration |
| Public-read only on `states`, `legislators`, `bills`, `campaigns` | same | DB write abuse |
| HttpOnly + SameSite cookies via `@supabase/ssr` | `src/lib/supabase/*` | Session theft |
| CSRF auto-protection via Server Actions | Next.js 16 default | Cross-site form abuse |
| Open-redirect guard on `redirect=` param | `src/modules/auth/actions.ts` (`safeRelative`) | Phishing |
| Length caps + format validation on profile inputs | same | DB bloat / injection |
| Email format validation on signup | same | Spam signup |
| Security headers (HSTS, CSP, X-Frame-Options, etc.) | `next.config.ts` | Clickjacking, XSS, MIME |
| `poweredByHeader: false` | `next.config.ts` | Fingerprinting |
| Service role key never imported in client code | enforced by lint review | Privilege escalation |

## Rules for future code

1. **NEVER** put `SUPABASE_SERVICE_ROLE_KEY` behind `NEXT_PUBLIC_`. NEVER import it in any file under `src/app/**` that is rendered as `"use client"` or imported by one.
2. **NEVER** call `supabase.from('campaigns').insert(...)` from a user-facing form. Campaign creation is admin-only and goes through service role, not RLS.
3. **NEVER** trust `searchParams` or `params` directly — always validate format (state codes, slugs).
4. **NEVER** accept HTML in email body templates without escaping. Templates are plain text.
5. **NEVER** expose user email lists. Only the user themselves can read their `profiles.email` (RLS enforced).

## Open work (before public launch)

- [x] Rate limiting on `/login` and `/signup` — Postgres-backed via `check_rate_limit` RPC
- [x] Admin role + `is_admin(uid)` SQL function used by RLS
- [ ] Verify Supabase Auth → Email → "Confirm email" is **on** in dashboard
- [ ] Add audit log table for sensitive admin actions
- [ ] Pen test the campaign action flow once it's built (mailto: link generation must escape user input)
- [ ] Add Cloudflare in front for WAF + DDoS shield (free)
- [ ] Set up Supabase advisors check (`mcp__supabase__get_advisors`) before each deploy

## Incident response

1. **Suspected key leak** — rotate the affected key in Supabase dashboard immediately. Update `.env.local` and Vercel/host env. Force-redeploy.
2. **Compromised user** — disable user via Supabase Auth dashboard, invalidate all sessions, audit `campaign_actions` for that user_id.
3. **DB-level abuse** — kill RLS-permitted abuse with a temporary policy update, then patch the action code.
