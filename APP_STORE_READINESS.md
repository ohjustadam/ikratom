# App store readiness — iKratom

Status: **PWA-ready**, app-store-listing-ready with one-time setup.

## What's wired in the codebase

| Piece | Where | Notes |
|---|---|---|
| Web app manifest | `src/app/manifest.ts` | id, scope, display, maskable icon, screenshots, shortcuts |
| Icons (multi-res) | `src/app/icon.tsx`, `src/app/apple-icon.tsx`, `public/ikratom-icon-{180,512}.png` | 180 + 512 PNG, plus Next.js dynamic icon route |
| Theme color + viewport | `src/app/layout.tsx` metadata | Matches manifest |
| Service worker | `public/sw.js` | Cache-first for static, network-first for HTML, never caches /admin/api/account/etc. |
| Offline page | `src/app/offline/` | Served from cache when network unavailable |
| Install prompt | `src/components/InstallPrompt.tsx` | Listens for `beforeinstallprompt`, shows iOS Safari hint otherwise |
| Sitemap + robots | `src/app/sitemap.ts`, `src/app/robots.ts` | For SEO + Google's mobile-app indexing |
| OpenGraph + Twitter cards | per-page `generateMetadata()` | bills, briefings, library, legislators |

## Right now, users can already install on:

- **Android Chrome / Edge / Brave**: native install prompt fires; PWA installs as standalone with home-screen icon + push notifications
- **iOS Safari**: manual "Add to Home Screen" from share sheet; PWA runs standalone with home-screen icon (no push notifications until iOS 16.4+ adds web push — which it has)
- **Desktop Chrome / Edge**: install prompt fires; PWA gets its own window with window-controls-overlay

This is the "free" install path. No store, no review, no fees.

---

## Path to official app stores

### Google Play Store ($25 one-time developer fee)

**Method: Trusted Web Activity (TWA) via Bubblewrap**

1. **Pay $25** at <https://play.google.com/console/signup>. One-time, lifetime.
2. **Install Bubblewrap CLI:** `npm i -g @bubblewrap/cli`
3. **Initialize the project** from our deployed manifest:
   ```bash
   bubblewrap init --manifest https://www.ikratom.org/manifest.webmanifest
   ```
   Answers when prompted:
   - Package ID: `org.ikratom.app`
   - Host: `www.ikratom.org`
   - Signing key: let Bubblewrap generate one (back it up!)
4. **Set up Digital Asset Links** so the TWA opens fullscreen without the URL bar. Bubblewrap will print the SHA-256 fingerprint of your signing cert. We add `/public/.well-known/assetlinks.json` with that fingerprint pointing back at our domain. Already laid out in the script section below.
5. **Build the APK / AAB:**
   ```bash
   bubblewrap build
   ```
6. **Upload to Google Play Console**, fill in store listing (description, screenshots, content rating, privacy policy URL — pointing at our `/privacy`), submit for review.

Google review: typically 1-3 days.

#### assetlinks.json setup

Once you have Bubblewrap's signing cert fingerprint, create `public/.well-known/assetlinks.json`:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "org.ikratom.app",
    "sha256_cert_fingerprints": ["XX:XX:..."]
  }
}]
```

Next.js will serve this at `https://www.ikratom.org/.well-known/assetlinks.json` automatically (public/ folder).

---

### Apple App Store ($99/year Apple Developer Program)

**Method: PWABuilder → Xcode**

1. **Pay $99/year** at <https://developer.apple.com/programs/>. Required to publish to the App Store at all.
2. **Generate an iOS package** at <https://www.pwabuilder.com/>:
   - Paste `https://www.ikratom.org`
   - Click "Package for stores" → iOS
   - Download the generated Xcode project zip
3. **Open in Xcode** (Mac required; can also use a cloud Xcode service like MacStadium if you're on Windows):
   - Set the Bundle ID: `org.ikratom.app`
   - Sign with your Apple Developer cert
   - Build → Archive
4. **Upload to App Store Connect** via Xcode Organizer
5. **Submit for review** in App Store Connect

Apple review: typically 24-48 hours, often less. They're stricter than Google on PWA wrappers — make sure:
- The app does something meaningful offline (we have offline page + sw caching ✓)
- We're not just wrapping a website with no native features (we have web push + share sheets + install behavior — counts as native-feel)

#### Alternative: Capacitor (more native, more work)

If Apple rejects the PWABuilder version (rare but possible), Capacitor wraps a Next.js app in a real iOS shell with full native API access. Heavier but bulletproof for review.

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init "iKratom" "org.ikratom.app"
npx cap add ios
```

---

## Pre-submission checklist

Before submitting to either store:

- [ ] Privacy policy URL is reachable and current (`/privacy` — already exists)
- [ ] Terms of service URL is reachable (`/terms` — already exists)
- [ ] App icons render correctly at 180, 192, 512, 1024 (Apple requires 1024)
- [ ] Screenshots (3-5) for the store listing — capture from /pulse, /campaigns, /bills, /dashboard, /forum
- [ ] App description (4000-char limit for Play; 4000 for Apple)
- [ ] Promo text / keywords
- [ ] Content rating questionnaire answered (no objectionable content, political-advocacy category)
- [ ] Privacy nutrition label / data safety questionnaire (we collect email + civic info + analytics; no third-party data sharing)
- [ ] Support email + URL
- [ ] Age rating: 17+ recommended (drug-policy discussion + civic engagement could be off-platform for under 13 by COPPA regardless)
- [ ] Push notification capability description (we use it for legislative alerts — explicitly stated)

## Costs summary (the "free way" interpreted strictly)

| Path | Cost |
|---|---|
| PWA only (current state) | $0, no review, no listing |
| Google Play TWA | $25 one-time |
| Apple App Store | $99/year (recurring) |
| Both stores | $25 once + $99/year |

If "free" means truly $0: the PWA install path already works on every modern device. The "Install" CTA via `<InstallPrompt>` surfaces this automatically.

If "free" includes the standard developer fees: $25 + $99/year is the floor for store presence.

If "free" means no monthly SaaS bills: yes — Bubblewrap (free) + PWABuilder (free) + Xcode (free) — we only pay the platforms' developer-program fees, not Appflow or similar paid wrappers.

## Maintenance after listing

- Each meaningful UX update → bump app version, rebuild TWA / Xcode archive, upload. PWA updates flow live without store re-submission for content changes (TWAs and Capacitor reflect the live website in real time).
- Signing key for Android: keep backups. Loss = can't publish updates to the same listing.
- Apple cert renewal: yearly, alongside the developer-program renewal.

## Open follow-ups (not blockers)

- Capture proper portrait + landscape screenshots for the manifest's `screenshots` array (currently the wide OG image stands in)
- Generate a properly-padded maskable icon variant (currently the regular icon doubles as maskable — Bubblewrap will warn, not block)
- Add `share_target` to the manifest so the iKratom PWA can RECEIVE shares from other apps ("Share to iKratom" from the Android share sheet → could route to /alerts/submit)
- Consider a separate `news` shortcut in addition to `pulse` since they're the two most-visited surfaces
