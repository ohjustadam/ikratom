# Google OAuth Verification — submission handout

This walks through getting the iKratom Google OAuth client moved out of "Testing" into "In production" so any Gmail user can connect (not just the ~100 test users you can manually whitelist).

**Time:** ~30 minutes to fill out, ~3–6 weeks for Google to review.

**Why now:** We're using the `gmail.send` scope, which Google classifies as **sensitive** (not "restricted" — that's gmail.readonly etc., much harder). Sensitive scopes go through "OAuth verification" but skip the more painful "CASA security assessment" required for restricted scopes.

---

## Before you start

Make sure these are live and stable:

| Required | Where it is | Status |
|---|---|---|
| ✅ Privacy Policy | `https://<yourdomain>/privacy` | Shipped |
| ✅ Terms of Service | `https://<yourdomain>/terms` | Shipped |
| ✅ Homepage that explains the app | `https://<yourdomain>/` | Shipped |
| ✅ App logo (120x120) | Auto-generated at `/icon` (we can also export a PNG manually) | Shipped |
| ✅ Production domain | `www.ikratom.org` (hosted on Netlify behind Cloudflare). Shared-host subdomains such as `*.netlify.app` are not eligible for verification, and none is used | Live |
| ⚠ Domain ownership verified in Google Search Console | One DNS TXT record, added in Cloudflare DNS | Check it before submitting |

**Critical:** Google won't verify an OAuth client that uses a shared-host URL (`*.netlify.app`, `*.vercel.app`). The client must use the custom domain, with ownership verified in Search Console, before you submit.

**Status (2026-10-24):** the client is still in **Testing** mode and has not been submitted for verification. Until it is, only the 100 listed test users (a lifetime cap) can connect Gmail, and each sees an "unverified app" warning. Outlook, Yahoo, AOL and iCloud sending do not need this review.

---

## Step 1 — The domain (already done)

The production domain is `ikratom.org` (canonical host `www.ikratom.org`), with DNS on Cloudflare in front of the Netlify site. Nothing to buy or point. Just confirm `https://www.ikratom.org` loads the app, `/privacy` and `/terms` load, and the domain is the one on the OAuth client's authorized redirect URIs (`https://www.ikratom.org/api/oauth/google/callback`).

---

## Step 2 — Verify domain ownership at Google

1. Open **[Google Search Console](https://search.google.com/search-console)**
2. Click **Add property** → **URL prefix** → enter `https://www.ikratom.org`
3. Google gives you a TXT record like `google-site-verification=abc123...`
4. Add the TXT record at your DNS provider (Cloudflare/etc.)
5. Click **Verify** in Search Console → confirms within ~1 min

---

## Step 3 — Fill out the OAuth consent screen

Open **[Google Auth Platform → Branding and Verification Center](https://console.cloud.google.com/auth/verification)** for your iKratom project. (Google moved the old "OAuth consent screen" page here; the fields below are the same, split across Branding, Audience and Data Access.)

### App information
| Field | Value |
|---|---|
| App name | `iKratom` |
| User support email | your verified email (the one tied to your Google Cloud account) |
| App logo | Upload a 120x120 PNG. **Tip:** open `https://www.ikratom.org/icon` in a browser, save as PNG, scale to 120x120 |

### App domain
| Field | Value |
|---|---|
| Application home page | `https://www.ikratom.org` |
| Application privacy policy link | `https://www.ikratom.org/privacy` |
| Application terms of service link | `https://www.ikratom.org/terms` |

### Authorized domains
Add: `ikratom.org`. **Without `https://` and without paths.**

### Developer contact information
Your email.

**Save and continue.**

---

## Step 4 — Scopes

You should already have `https://www.googleapis.com/auth/gmail.send` listed.

**That's the only scope we use.** Don't add others — every additional sensitive scope adds review time.

If Google asks for a justification at this step, paste this:

> iKratom is a nonpartisan political action platform for the kratom advocacy community. Users compose pre-written, personalized emails to their elected legislators about kratom policy. The `gmail.send` scope lets users send these emails from their own Gmail account in one click — preserving the authenticity of constituent-to-legislator communication (legislators read emails from their actual constituents, not platform domains). We never read, list, or modify other emails. We only send messages the user has reviewed and approved through our action UI.

**Save and continue.**

---

## Step 5 — Test users

While in "Testing" mode you can have up to 100 test users. Once submitted for verification, you don't need this list anymore — but it doesn't hurt to leave it populated.

---

## Step 6 — Prepare the verification submission

Click **Publish App** → status changes from "Testing" to "In production". A button appears: **Prepare for Verification** (or similar).

Click it. You'll be asked for:

### A. App demo video (REQUIRED)

A 2–4 minute screen recording showing:

1. Land on the homepage — show the URL bar with your verified domain
2. Sign up for an account (any account is fine for the demo)
3. Navigate to `/account`
4. Click **Connect Gmail** → Google consent screen → grant permission → returned to /account showing connected
5. Navigate to `/campaigns/[any-active-campaign]`
6. Show the green "⚡ One-click send" button
7. Click it → demonstrate emails being sent (open Gmail Sent folder in another tab to prove they arrive)
8. Show the post-send success state with the count

**Recording tip:** use Loom (free), Mac QuickTime, or Windows Game Bar. Upload to YouTube as **Unlisted** and paste the YouTube link in the form.

**Script to narrate:** [download/paste from below — or copy from `supabase/email-templates.md` style]

> "Hi, this is the iKratom verification demo. iKratom is a nonpartisan platform for the kratom advocacy community — it helps users send personalized emails to their elected legislators in one click. I'll show how we use the gmail.send scope.
>
> Here's the homepage at www.ikratom.org. I'll sign in to an account I've set up.
>
> On the Account page, the user clicks Connect Gmail. They see Google's consent screen — only the gmail.send scope is requested, nothing else. After granting, they're returned to iKratom showing the email connected.
>
> Now they navigate to an active campaign — this one is for Oklahoma residents. The platform automatically matched them to their state senator and representative. The email subject and body are pre-filled with the user's name and address.
>
> The user clicks the green Send button. We use the gmail.send scope to send one personalized email per legislator from the user's Gmail account. Here's the success state showing 4 of 4 sent. And here's their Gmail Sent folder showing the 4 emails — sent from their actual address.
>
> We never read, list, or modify any other emails. We only send what the user has reviewed and approved. Thanks for reviewing."

### B. App functionality justification (REQUIRED, free-text)

Paste:

> iKratom helps US-based kratom advocates contact their elected legislators about kratom policy. The platform matches users to their specific state and federal representatives by address (via the US Census Geocoder). When a campaign is active, users can send personalized emails to their specific legislators in one click.
>
> Without the gmail.send scope, users would have to either (a) manually copy/paste emails one-by-one, or (b) send from a platform domain — but legislators routinely filter out generic platform-sourced emails as spam. By sending from the user's own Gmail account, the email arrives as authentic constituent communication, which is the only kind legislators meaningfully respond to.
>
> The scope is used **only** when a user explicitly clicks Send on a campaign action they've personally reviewed. We never read inboxes, list messages, or modify any data in the user's Gmail. We only send.

### C. Limited use disclosure (REQUIRED, free-text)

Paste:

> iKratom's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Specifically:
>
> - Data accessed via Google APIs (Gmail) is used **only** for the user-facing feature directly visible at the time of grant — sending campaign emails the user has reviewed.
> - We do **not** transfer Gmail data to third parties except to provide or improve user-facing features (we do not transfer Gmail data anywhere — emails are sent directly from the user's account to the legislator's email address via Google's API; no copy is stored or forwarded).
> - We do **not** use Gmail data to serve advertisements.
> - We do **not** allow humans to read Gmail data, except (a) the user themselves, (b) with their explicit consent for specific messages, (c) where required for security purposes such as investigating abuse, (d) to comply with applicable law, or (e) for internal operations only when the data has been aggregated and anonymized — and none of these apply to iKratom's current operations.

---

## Step 7 — Submit + wait

Click **Submit for verification**.

Google emails you within 24–48 hours with either:
- "Approved" — done, anyone can connect Gmail going forward
- "Needs more info" — they ask for clarifications (usually about how scopes are used). Reply within 60 days or they close the request.

Average turnaround for `gmail.send` (sensitive but not restricted): **~3–6 weeks**, sometimes faster.

While you wait, the OAuth client still works for users you add to the test users list (up to 100). So friends testing now isn't blocked.

---

## After approval

Nothing changes in your code. The OAuth client just transitions from "test mode" to "in production" status, and any Gmail user can connect.

---

## If verification gets rejected

Common reasons + fixes:

| Reason | Fix |
|---|---|
| "Privacy policy doesn't mention how Gmail data is used" | Make sure /privacy explicitly says: "Gmail OAuth refresh token... encrypted at rest... used solely to send campaign emails on your behalf." (Already covered in our /privacy.) |
| "Demo video doesn't show the consent screen" | Re-record showing the Google consent screen step explicitly |
| "Scope is broader than needed" | We only request gmail.send — not an issue |
| "Domain not verified" | Check Search Console — re-verify the TXT record |
| "Limited use disclosure missing from privacy policy" | Add a line to /privacy: "Our use of Google APIs adheres to the Google API Services User Data Policy, including Limited Use requirements." |

I can address any of these inline once Google replies — just paste me the rejection email.
