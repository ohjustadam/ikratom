# Email-provider strategy for user send-on-behalf

> Owner directive 2026-05-17: *"are we able to do proton, and what top other email providers can we offer to sync with? we want to be able and service all people equally, not just for gmail."*

This doc captures the realistic strategy for every major US consumer/work email provider as a user send-on-behalf integration. **Send-on-behalf** = user grants OAuth, we send from their address via the provider's API. Distinct from transactional system mail (which is covered by `src/lib/email/router.ts` — Brevo/Mailjet/Resend/MailerSend).

## What's live (Q3 #1, this PR)

| Provider | Status | OAuth | Scope | Notes |
|---|---|---|---|---|
| **Gmail** (consumer + Workspace) | ✅ Live | Google Identity | `gmail.send` (narrowest) | First provider; ~60% of US consumers. Refresh tokens last indefinitely with `prompt=consent`. |
| **Outlook.com / Microsoft 365** | ✅ Live (this PR) | Microsoft Identity v2 (`common` tenant) | `Mail.Send offline_access User.Read` | Personal Outlook + work M365 in one integration. Refresh tokens expire after ~90 days idle — self-healed via `OutlookTokenRevokedError`. |

Combined, these cover **~85% of US email users**.

## What's feasible but deferred

| Provider | Effort | Reason |
|---|---|---|
| **Yahoo Mail** | Low | YDN OAuth + `mail-w` scope. ~6% of US users. Add when usage demand emerges. |
| **AOL** (now Yahoo-managed) | Low | Same backend as Yahoo. Auto-supported when Yahoo lands. |
| **Zoho Mail** | Low | OAuth2 with `ZohoMail.messages.CREATE` scope. Tiny consumer share but real B2B presence. |
| **Fastmail** | Medium | OAuth2 + JMAP. Solid privacy-focused consumer base. Needs a JMAP client lib. |
| **Mailbox.org** | Medium | IMAP+SMTP only — no OAuth send API. Would need user app-password flow (UX friction). |

## What's NOT feasible without paid integrations

### Proton Mail
- **No public OAuth send API.** Proton's design is end-to-end encrypted; the server can't see message contents, so there's no scoped send permission to grant.
- **Two paths exist but neither is good for our use case:**
  1. **Proton Bridge** — desktop app that exposes IMAP/SMTP locally. Requires the user to install + run Bridge. Bridge is paid (Mail Plus/Unlimited only). Even then, the integration is per-machine, not cloud — we can't send from a server-side cron.
  2. **Proton Mail REST API (paid Business)** — currently in limited preview for Business customers. Not generally available, not free.
- **Honest answer for users**: Proton intentionally cannot offer a send-on-behalf flow without compromising their E2E encryption guarantee. The most we can offer Proton users:
  - The Web Share API / `mailto:` flow → opens their Proton webmail with the email pre-filled, they review and send manually. Same UX as the manual fallback that's always available.
  - Use a secondary Gmail/Outlook account for advocacy email if they want one-click batch sending.

### iCloud Mail (@icloud.com / @me.com)
- **No public OAuth API at all.** Apple's "Sign in with Apple" is for authentication only — it doesn't grant mail send permission.
- **App-specific passwords** exist but require IMAP+SMTP integration which is a bigger lift and worse security model.
- **Strategy**: don't build. Users with iCloud who want one-click can OAuth into a secondary Gmail/Outlook.

### Tutanota / Hey / Skiff (and other privacy-mail upstarts)
- **No public OAuth send APIs.** Same E2E-encryption / proprietary-protocol reasons as Proton.
- **Strategy**: manual-send fallback only.

## Self-healing across providers

All OAuth providers use the same revocation pattern:

1. User revokes our access (e.g. via Google permissions page or Microsoft account dashboard).
2. Next send call returns `invalid_grant`.
3. The provider-specific `*TokenRevokedError` bubbles to the unified `EmailTokenRevokedError` in `src/lib/email/user-send.ts`.
4. `markEmailIntegrationRevoked(userId, provider)` blanks the refresh token + stamps `last_error`.
5. The inline Connect CTA reappears on the user's next campaign page render.

User reconnects in one click. No support ticket, no manual admin intervention.

## What's in `email_integrations`

Single row per user (PK on `user_id`). Switching providers replaces the row — there's no "I have both Gmail AND Outlook connected" mode. This was intentional: most users have a single "from" identity they want to use for civic email. If demand for multi-provider per user surfaces later, the schema is a one-line migration (drop PK, add composite unique on `(user_id, provider)`).

## What this means for `creamcook@gmail.com` and the rest

- His friend can connect Gmail OR Outlook on the campaign page — whichever he uses for his real email.
- Both providers have identical privacy guarantees (narrowest send-only scope, no inbox/contacts/drafts read).
- Both self-heal on token revocation.
- If he later switches from Gmail to Outlook, one click replaces the connection — no support needed.

For the ~15% of users on Proton / iCloud / Yahoo / other: they keep using the manual mailto/Gmail-web/Outlook-web fallbacks that have always been there. The inline Connect CTA copy makes the trade-off explicit: *"Proton, Yahoo, iCloud — coming next"* sets expectations honestly while we ship Yahoo as the next-priority add when usage data shows demand.
