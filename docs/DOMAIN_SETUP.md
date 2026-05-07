# Domain setup — ikratom.org

Owner-side runbook. Steps in order. Tick each as you complete.

## ✅ Done
- [x] Bought `ikratom.org` at Cloudflare Registrar (auto-renew on)
- [x] Codebase references switched from `ikratom.app` → `ikratom.org` (PR #15)

## ☐ Connect domain to Vercel

1. Vercel dashboard → `ikratom` project → **Settings** → **Domains**
2. **Add Domain** → `ikratom.org` → submit
3. Vercel will show 1-2 DNS records (typically an `A` record on `@` to a Vercel IP, and a `CNAME` for `www`)
4. **Cloudflare** → click `ikratom.org` → **DNS** → **Records** → add each record Vercel showed
   - Set proxy status to **DNS only** (gray cloud), NOT Proxied (orange cloud)
5. Wait 2–15 min. Vercel should flip the entry to ✓ "Valid Configuration."
6. Set `ikratom.org` as the **primary domain** in Vercel.

## ☐ Update `APP_URL` in 3 places

A. **Vercel Production env** → Settings → Environment Variables → `APP_URL` = `https://ikratom.org`
B. **GitHub Actions repo secret** → Settings → Secrets → `APP_URL` = `https://ikratom.org`
C. **Local `.env.local`** — leave at `http://localhost:3001` for dev (or comment-noted)

Then trigger a Vercel redeploy (env changes don't auto-redeploy): Deployments → ⋯ on latest → **Redeploy**.

## ☐ Resend setup (transactional email)

1. Sign up at https://resend.com (free)
2. **Domains** → **Add Domain** → `ikratom.org`
3. Resend gives 3-4 DNS records (SPF/DKIM/DMARC). Add each in Cloudflare DNS.
4. Wait until verified ✓ in Resend console.
5. **API Keys** → Create with sending access. Save `re_...` value.
6. Add to **Vercel Production env**:
   - `RESEND_API_KEY=re_xxx`
   - `RESEND_FROM_EMAIL=alerts@ikratom.org`
   - `RESEND_FROM_NAME=iKratom`
7. Add the same to local `.env.local` if you want dev sends to work too.
8. Redeploy Vercel.

Once these are set, password-change emails start sending automatically (already wired in `src/modules/auth/actions-password.ts`).

## ☐ Cloudflare Email Routing (receive email at the domain)

So `support@ikratom.org`, `info@ikratom.org`, `*@ikratom.org` forward to your Proton inbox.

1. Cloudflare → `ikratom.org` → **Email** → **Email Routing** → enable
2. **Routing rules** → add:
   - `support@ikratom.org` → `ohjustadam@proton.me`
   - `info@ikratom.org` → `ohjustadam@proton.me`
   - Catch-all `*@ikratom.org` → `ohjustadam@proton.me`
3. Verify your Proton address (Cloudflare sends a confirmation email)

## ☐ Google OAuth verification (Gmail send-on-behalf)

Already configured for `localhost`; needs prod domain added.

1. https://console.cloud.google.com → existing OAuth project
2. **APIs & Services** → **OAuth consent screen**
   - **App domain:** `https://ikratom.org`
   - **Authorized domains:** add `ikratom.org`
   - **Developer contact:** `support@ikratom.org`
3. **Credentials** → click your OAuth client ID
   - **Authorized redirect URIs:** add `https://ikratom.org/api/oauth/google/callback`
4. **OAuth consent screen** → **Publish App**
5. Submit for verification (4-6 weeks for `gmail.send` scope)

## ☐ Trademark "iKratom" (separate from domain but typically done together)

- USPTO TEAS Plus, ~$250 per class
- Class 35 (Advertising/Business Services) is most relevant for an advocacy platform
- File at https://www.uspto.gov/trademarks
- Use ™ immediately; ® only after registration

## Verification checklist (post-setup)

After all the above:

- [ ] `https://ikratom.org` loads the site with a valid SSL cert (green padlock)
- [ ] `https://www.ikratom.org` redirects to root
- [ ] `http://ikratom.org` upgrades to HTTPS automatically
- [ ] `/api/cron/fire-waves` responds with JSON when called with bearer token (GitHub Actions cron path)
- [ ] Password change on `/account/security` triggers an email to your inbox within 30s
- [ ] Email sent from `alerts@ikratom.org` is delivered, not in spam
- [ ] `support@ikratom.org` forwards to your Proton inbox
- [ ] Existing partner kits' QR codes (e.g. `/admin/partners/test-shop/kit`) now show URLs starting with `https://ikratom.org`

## Stale-asset notes

The old vercel.app URL (`https://ikratom-ohjustadam-3182s-projects.vercel.app`) keeps working as a deploy preview alias but is no longer the primary. Push subscriptions registered with VAPID and pointing to the old origin **continue to work** — VAPID is keyed to the keypair, not the URL.

Existing partner kits already printed in the wild (none yet — we just shipped this) would still work because the proxy.ts referral capture matches on `host` slug, not on URL origin. New prints from the kit page will use the new domain.
