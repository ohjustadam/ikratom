# Email scaling

Free-tier caps make any single provider a bottleneck. The router in
`src/lib/email/router.ts` stacks 4 providers so combined free cap is
~700/day with provider redundancy.

## Provider table

| Provider | Free daily | Free monthly | Auth | Notes |
|---|---|---|---|---|
| **Brevo** (Sendinblue) | **300** | 9,000 | API key | Highest free daily — first in router priority |
| **Mailjet** | 200 | 6,000 | Key + secret (HTTP Basic) | Stable, good European delivery |
| **Resend** | 100 | 3,000 | API key | Already wired, reliable, modern |
| **MailerSend** | ~100 | 3,000 | API key | Reasonable fallback |

**Combined free cap:** ~700 emails/day, ~21,000/month.

**Paid scaling option (when free isn't enough):**
- **AWS SES** — pay-as-you-go at $0.10 per 1,000. 100K emails = $10/month. Best at scale; some setup overhead (region, domain verification, sandbox-out request).
- Don't move to paid until you're consistently bumping the combined free cap. The router shows daily quota status at `/admin/ai-control` (when built) so you'll see it coming.

## Router behavior

1. On every send, query `email_quota_log` for today's per-provider counts.
2. Walk providers in priority order: brevo → mailjet → resend → mailersend.
3. Skip any not configured (no API key) or already at cap.
4. Send via the first available; on success, increment `sent_count`; on failure, increment `failed_count` and try next.
5. Return `{ ok, provider, id }` on success or `{ ok: false, tried: [...] }` if all 4 failed.

## Cost projections at scale

| Daily volume | What's needed | Monthly cost |
|---|---|---|
| < 700/day | Combined free | $0 |
| 700–3,000/day | Add AWS SES as 5th provider | $5–10 |
| 3,000–30,000/day | AWS SES primary | $10–90 |
| 30K+/day | Dedicated SES + IP warming | $100+ |

For comparison: 30K emails/day = ~10K active advocates each receiving 3 alerts. That's a real audience.

## Setup checklist (per provider)

The pattern is identical for each:

1. Sign up at the provider's site
2. Add your sending domain (e.g. `ikratom.org`)
3. Add the DNS records they show (SPF, DKIM, DMARC) in Cloudflare
4. Wait until provider console shows ✓ verified
5. Create an API key with sending scope
6. Add to Vercel env: `<PROVIDER>_API_KEY`, `<PROVIDER>_FROM_EMAIL`, `<PROVIDER>_FROM_NAME`
7. Redeploy. The router automatically picks up the new provider.

You **don't** need to add all 4. The router gracefully handles however many are configured. Recommended order:
- Set up Resend first (already done — re_xxx in your saved notes)
- Then Brevo (highest cap, biggest gain)
- Then Mailjet (good long-tail capacity)
- MailerSend last if you want full belt-and-suspenders

## Migration from existing single-provider code

`src/lib/email/transactional.ts` (the original Resend-only sender)
remains in place — existing call sites work unchanged. New code should
import `sendEmail` from `src/lib/email/router.ts` instead, which does
the same thing with multi-provider fallover.

To migrate an existing call site:
```diff
- import { sendTransactionalEmail } from "@/lib/email/transactional";
- await sendTransactionalEmail({...});
+ import { sendEmail } from "@/lib/email/router";
+ await sendEmail({...});
```

The signatures are identical. Migrate gradually as you touch files.

## Quota log table

`email_quota_log` (per-day, per-provider counter) is service-role-write
only. The router uses the service-role client when bumping the counter,
so the policy is "no INSERT policy needed because nothing else writes
here." `prune_email_quota_log()` is called manually or by cron to drop
rows older than 90 days.
