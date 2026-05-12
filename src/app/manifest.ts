import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site.config";

/**
 * PWA manifest — what installs as an app on Android (via Chrome's "Add
 * to Home Screen" → APK via Bubblewrap), iOS (via Safari "Add to Home
 * Screen" → IPA via PWABuilder), and desktop (via Chrome / Edge install
 * prompt).
 *
 * Spec references that matter for app-store readiness:
 *   - id: stable identifier so the OS tracks installs across origin
 *     changes (matters if we ever move from .org to .app or similar)
 *   - scope: defines what URLs the PWA "owns" — anything outside this
 *     opens in the user's regular browser, in-app URLs stay in the
 *     PWA window
 *   - maskable icon: adaptive icons on Android require an icon with
 *     ~10% safe-zone padding; we expose both purpose:any and
 *     purpose:maskable
 *   - screenshots: Chrome Android shows these in the install prompt
 *     dialog
 *   - display_override: tries window-controls-overlay (cleaner desktop
 *     window chrome) and falls back through to standalone / browser
 *   - prefer_related_applications: false → tell the browser to install
 *     THIS PWA, not redirect to a native app
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/?ikratom-pwa",
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: siteConfig.description,
    start_url: "/dashboard?utm_source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui", "browser"],
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    orientation: "portrait-primary",
    lang: "en-US",
    dir: "ltr",
    prefer_related_applications: false,
    categories: ["news", "politics", "social", "lifestyle", "education"],
    icons: [
      {
        // 512x512 from app/icon.tsx
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Static high-res — falls through when /icon route is unreachable.
        src: "/ikratom-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Maskable for Android adaptive icons. Re-uses the 512 PNG
        // until we have a properly padded version — the centered logo
        // already sits within the safe zone, just no explicit
        // maskable badge. Bubblewrap will warn during APK gen if
        // padding is wrong; we can fix when we get there.
        src: "/ikratom-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/ikratom-icon-180.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
    screenshots: [
      // Chrome install prompt dialog uses these. opengraph-image
      // doubles as a wide-form screenshot; we can add proper
      // screenshots once we capture them.
      {
        src: "/opengraph-image",
        sizes: "1200x630",
        type: "image/png",
        form_factor: "wide",
        label: "iKratom — the advocate's toolbelt",
      },
    ],
    shortcuts: [
      {
        name: "Active campaigns",
        short_name: "Campaigns",
        description: "One-click emails to your legislators",
        url: "/campaigns",
        icons: [{ src: "/icon", sizes: "192x192" }],
      },
      {
        name: "Pulse — live alerts",
        short_name: "Pulse",
        description: "Critical / alert / watch feed",
        url: "/pulse",
        icons: [{ src: "/icon", sizes: "192x192" }],
      },
      {
        name: "BoP Watch",
        short_name: "BoP",
        description: "State pharmacy board monitoring",
        url: "/bop-watch",
        icons: [{ src: "/icon", sizes: "192x192" }],
      },
      {
        name: "Messages",
        short_name: "DMs",
        description: "Encrypted direct messages",
        url: "/messages",
        icons: [{ src: "/icon", sizes: "192x192" }],
      },
    ],
  };
}
