# App-store packaging — the free path (owner playbook)

Goal: get iKratom into the **Google Play Store**, **Apple App Store**, and as a
**desktop app**, spending as little as possible. Chosen path (owner, 2026-07-05):
**TWA (Bubblewrap) for Android + PWABuilder for iOS**, wrapping the live PWA.

Nothing here changes the site — a TWA/PWABuilder wrapper is a thin native shell
around `https://www.ikratom.org`. You ship once (the website); the stores just
point at it. When the site updates, the apps update — no re-submission.

The code side is done (manifest, service worker, icons, privacy/terms, security
headers). What remains is **account setup + generating the store artifacts**,
which needs *your* logins and the store fees. Steps below.

---

## Prereqs (one-time)
- Node.js installed (you have it).
- The PWA is live at `https://www.ikratom.org` with a valid manifest at
  `https://www.ikratom.org/manifest.webmanifest` (it is).

---

## 1. Android — Google Play (TWA via Bubblewrap) — **$25 one-time**

1. **Create a Google Play Console account** — https://play.google.com/console
   ($25 one-time, ever). This is the only hard gate.
2. **Generate the app package** on your PC:
   ```bash
   npm install -g @bubblewrap/cli
   bubblewrap init --manifest https://www.ikratom.org/manifest.webmanifest
   # accept defaults; it creates an app id like org.ikratom.twa and a signing keystore
   bubblewrap build
   # → produces app-release-bundle.aab (upload this) + a signing keystore (KEEP SAFE)
   ```
   ⚠️ **Back up the keystore + passwords Bubblewrap creates.** Lose them and you
   can never update the app under the same listing.
3. **Finalize Digital Asset Links** so deep links open the app (not the browser):
   - In Play Console → your app → **Setup → App integrity**, copy the
     **SHA-256 fingerprint** of the *Play App Signing* key.
   - Put it (and the real package name Bubblewrap chose) into
     `public/.well-known/assetlinks.json` — it currently has placeholders
     (`org.ikratom.twa` / `REPLACE_WITH_SHA256_FROM_BUBBLEWRAP`). Commit +
     deploy that change **before** you finish the Play listing, so Google's
     link verification passes.
4. **Store listing assets:**
   - Upload **2–8 phone screenshots** (portrait) + a feature graphic in Console.
     Capture them from a real phone or Chrome DevTools device mode.
   - **Data Safety form:** fill from `/privacy` — collects email, name/address
     (optional), phone (optional), push endpoint (optional), Gmail token
     (optional if connected), **first-party product analytics (PostHog/Vercel)**.
     No data sold/shared, no third-party ad trackers. (The privacy page was
     refreshed 2026-07-05 to state this accurately.)
   - **Content rating** questionnaire → likely *Teen* (civic content + chat).
5. Upload the `.aab`, complete the listing, submit for review.

## 2. iOS — Apple App Store (PWABuilder) — **$99/yr + a Mac**

Only proceed if you decide the $99/yr Apple Developer fee is worth it **and**
you have access to a Mac (or a paid Mac-in-cloud) for the final upload step —
Apple requires Xcode to archive/submit.

1. Enroll in the **Apple Developer Program** ($99/yr).
2. Generate the iOS package at https://www.pwabuilder.com → enter
   `https://www.ikratom.org` → **Package for stores → iOS**. Download the Xcode
   project.
3. On a Mac: open in Xcode, set the bundle id + team, **Archive**, upload to
   App Store Connect.
4. (Optional deep links) add `public/.well-known/apple-app-site-association`
   (JSON, served as `application/json`, no file extension) with your app id.
   iOS ignores the manifest `share_target`, which is fine.
5. Fill the **App Privacy ("nutrition label")** from `/privacy` (same data map
   as Play), set age rating, submit.

## 3. Desktop — already shipped (Tauri)

- The Windows `.exe` builds via `.github/workflows/desktop-build.yml`
  (`tauri icon` generates the icon set from `public/ikratom-icon-1024.png`, then
  `tauri build`). Users install it from the `/install` page.
- It's **unsigned**, so Windows SmartScreen shows a one-time warning. The
  install page already routes users to the PWA "Install" button as the primary
  path (identical result + desktop push), which is the right free choice.
- Optional: a code-signing cert (~$100–400/yr) removes the SmartScreen warning.
  Deferred — not worth it pre-revenue.
- For a cold **local** `tauri build`, run `tauri icon ...` first (CI does this);
  otherwise the referenced `icons/icon.ico` is missing.

---

## Cost summary
| Platform | Cost | Blocker |
|---|---|---|
| Android (Play) | **$25 one-time** | Play Console account |
| iOS (App Store) | **$99/yr** | Apple account **+ a Mac** |
| Desktop (Tauri) | **$0** (already shipping) | none; cert optional |

**Recommendation:** do Android first (cheapest, strongest platform for a civic
app), keep the desktop PWA as-is, and decide iOS once there's traction/budget.

## Still-open code items before submit (small, tracked)
- Real **portrait screenshots** into `public/screenshots/` + `manifest.ts`
  `screenshots[]` (only a wide OG image today). Needs device capture — yours.
- (done 2026-07-05) shortcut icon size declarations fixed; privacy policy
  refreshed to disclose analytics + push accurately.
