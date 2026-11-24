# Surge runbook: a rush of signups

Use this when signups spike: a shop event, a news story or a Reddit post. Measured 2026-11-17, re-checked 2026-11-24.

Every switch below changes production Auth config, so each one needs the owner's yes. Check where things stand first (this only reads):

```
node --env-file=.env.local scripts/auth-surge.mjs
```

## What breaks first

1. **Confirmation email.** The cap is 30 an hour for the whole project (Supabase `rate_limit_email_sent`), and Resend allows 100 a day, shared with platform mail.
   - With #1174 live, a signup past the cap still creates the account. Its link waits in `signup_email_queue`, and the hourly "Mail queued signup links" step sends it.
   - Before that build, the signup is lost while the form says "check your email". `auth-surge.mjs` status tells you which build is live.
2. **Netlify credits.** At 1,000 the site pauses. Check the meter with `npm run credits`.
   - On 11-24 the meter read 753 of 1,000, with about 14 used a day.
   - A surge day costs an estimated 100 to 250.
   - The owner's paid option is auto recharge (500 credits for $5).
3. **Member email.** The scheduled jobs can send about 350 a day (Brevo plus Resend). Since #1176 they rotate fairly, so nobody gets a second copy.
4. **Gmail one-click.** The app is unverified, so it allows 100 lifetime users. Members can still send with `mailto:`. Verification is free and only the owner can submit it.
5. **Signups from one IP address.** The limit is 15 an hour (shop Wi-Fi). Changing it is a code change in `src/modules/auth/actions.ts` and needs a build.

Supabase (database, egress, connections, realtime), the free AI router and web push hold well past 1,000 signups a day.

## Switches (each needs the owner's yes)

| Switch | Turn on | Undo | Notes |
|---|---|---|---|
| Captcha (Turnstile) | `node --env-file=.env.local scripts/auth-captcha.mjs enable` | `... auth-captcha.mjs disable` | Ready now. Stops bots from using up the email cap. |
| Auth mail on Brevo (300 a day) | `node --env-file=.env.local scripts/configure-auth-smtp.mjs --provider brevo --rate 60 --apply` | `... configure-auth-smtp.mjs --provider resend --apply` | Needs `BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY` and `BREVO_FROM_EMAIL` in `.env.local` (Brevo > SMTP & API > SMTP). Shares Brevo's 300 a day with member email. |
| Autoconfirm (no email at signup) | `node --env-file=.env.local scripts/auth-surge.mjs autoconfirm-on` | `... auth-surge.mjs autoconfirm-off` | Refuses unless the live build carries #1174. Addresses go unproven, so undo it once the rush is over. |

## Watching the queue

- `node --env-file=.env.local scripts/send-queued-signup-links.mjs --dry-run` lists the links still waiting.
- The hourly job records each run in `scraper_runs` under the source `signup_link_queue`.
