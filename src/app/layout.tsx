import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { siteConfig } from "@/config/site.config";
import { statusBanner } from "@/config/status-banner";
import { HeaderAuth } from "@/modules/auth/components/HeaderAuth";
import { MobileAuthPill } from "@/modules/auth/components/MobileAuthPill";
import { HeaderNav } from "@/components/HeaderNav";
import { HeaderShare } from "@/components/HeaderShare";
import { InstallAppButton } from "@/components/InstallAppButton";
import { CookieBanner } from "@/components/CookieBanner";
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { GlobalAnnouncement } from "@/components/GlobalAnnouncement";
import { MobileNav } from "@/components/MobileNav";
import { MobileTabBar } from "@/components/MobileTabBar";
import { RegisterSW } from "@/components/RegisterSW";
import { PushBackStop } from "@/components/PushBackStop";
import { PresenceHeartbeat } from "@/components/PresenceHeartbeat";
import { InstallPrompt } from "@/components/InstallPrompt";
import FeedbackWidget from "@/components/FeedbackWidget";
import ShareBanner from "@/components/ShareBanner";
import { ChatPopup } from "@/modules/chat/ChatPopup";
import { ThemeQuickControls } from "@/components/ThemeQuickControls";
import { PostHogProvider } from "@/lib/posthog/PostHogProvider";
import { SignInProvider } from "@/components/auth/SignInContext";
import { LeaderTourController } from "@/modules/dashboard/LeaderTourController";
import { LeaderTourBanner } from "@/modules/dashboard/LeaderTourBanner";
import { ChromeProvider } from "@/components/chrome/ChromeProvider";
import { LeaderTourGate, MobileNavGate, LocaleSwitcherGate, PresenceHeartbeatGate } from "@/components/chrome/ChromeGates";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const BASE = process.env.APP_URL?.replace(/\/$/, "") || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(BASE),
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [
    "kratom advocacy",
    "kratom legislation",
    "7-OH",
    "KCPA",
    "kratom community",
    "contact legislators kratom",
  ],
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: siteConfig.name,
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: siteConfig.name,
    description: siteConfig.description,
    url: BASE,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
  },
  robots: {
    index: true,
    follow: true,
    // Standard "noai" / "noimageai" hints (Cloudflare/IETF AI Preferences
    // proposal) telling AI crawlers our content isn't fair game for
    // training. Combined with robots.txt this is the strongest non-paywall
    // signal we can give. Honor-system; not technically enforced.
    "max-snippet": -1,
    "max-image-preview": "large",
    "max-video-preview": -1,
  },
  other: {
    "ai-content-declaration": "no-ai-training",
    "noai": "1",
    "noimageai": "1",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0a0a0a",
  viewportFit: "cover",  // iPhone notch / safe-area support
};

/**
 * ROOT LAYOUT — MUST STAY STATIC.
 *
 * This function previously awaited `readLocale()` and `getCachedAuthProfile()`.
 * In the App Router a cookie read anywhere in the render tree opts that route
 * out of static generation, and from the ROOT layout that means EVERY route in
 * the app. The result: 215 pages server-rendered on every hit, 688K function
 * invocations, 12h of Fluid CPU against a 4h allowance, and the 2026-07-22
 * account block that took the site down.
 *
 * ⚠ DO NOT reintroduce `cookies()`, `headers()`, `getCachedAuthProfile()`,
 * `readLocale()`, or any cookie-bound Supabase client here or in any component
 * this layout renders. Per-user state belongs in /api/me, read client-side by
 * ChromeProvider — crawlers don't execute JS, so they never pay for it.
 * Full context: `private/STATIC_CHROME_PLAN.md`.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // No auth/locale reads here — see the header comment. `lang` is static and
  // the theme `data-*` attributes are now set by the inline script below (from
  // localStorage) and corrected by ChromeProvider once /api/me lands.
  return (
    <html
      lang="en"
      className={`${geist.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-geist)]">
        {/* Set theme/accent/mode on <html> before paint to avoid a flash of
            the wrong UI (FOUC). For signed-in users the server already set
            the data-* attributes from their profile — respect those and
            mirror them into localStorage. For anon, read localStorage (or
            fall back to the app defaults: dark / emerald / normal). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.documentElement;try{var t=d.dataset.theme;if(t==='light'||t==='dark'){localStorage.setItem('ikratom-theme',t)}else{var s=localStorage.getItem('ikratom-theme');d.dataset.theme=(s==='light'||s==='dark')?s:'dark'}function rmp(hex){var mm=/^#?([0-9a-f]{6})$/i.exec(hex);if(!mm)return;var nn=parseInt(mm[1],16),rr=(nn>>16&255)/255,gg=(nn>>8&255)/255,bb=(nn&255)/255,mx=Math.max(rr,gg,bb),mn=Math.min(rr,gg,bb),Lf=(mx+mn)/2,df=mx-mn,sf=df===0?0:df/(1-Math.abs(2*Lf-1)),Hf=0;if(df){if(mx===rr)Hf=((gg-bb)/df)%6;else if(mx===gg)Hf=(bb-rr)/df+2;else Hf=(rr-gg)/df+4;Hf*=60;if(Hf<0)Hf+=360}var SP=sf*100,LP=Lf*100,st=d.style;st.setProperty('--accent',hex);var dl={500:0,400:8,300:18,200:30,100:42,50:50,600:-8,700:-16,800:-24,900:-32,950:-40};var cp={400:40,300:34,200:30},li=d.dataset.theme==='light';for(var kk in dl){var ll=Math.max(0,Math.min(100,LP+dl[kk]));if(li&&cp[kk]!=null)ll=Math.min(ll,cp[kk]);st.setProperty('--color-emerald-'+kk,'hsl('+Hf+' '+SP+'% '+ll+'%)')}d.dataset.accent='custom'}var a=d.dataset.accent;if(a==='custom'){var hx=d.dataset.accentHex;if(hx){localStorage.setItem('ikratom-accent-hex',hx);localStorage.setItem('ikratom-accent','custom');rmp(hx)}}else if(a){localStorage.setItem('ikratom-accent',a);localStorage.removeItem('ikratom-accent-hex')}else{var shx=localStorage.getItem('ikratom-accent-hex');var sa=localStorage.getItem('ikratom-accent');if(sa==='custom'&&shx){rmp(shx)}else if(sa){d.dataset.accent=sa}}var m=d.dataset.mode;if(m){localStorage.setItem('ikratom-mode',m)}else{var sm=localStorage.getItem('ikratom-mode');if(sm)d.dataset.mode=sm}}catch(e){if(!d.dataset.theme)d.dataset.theme='dark'}})();`,
          }}
        />
        <PostHogProvider>
        <ChromeProvider>
        <SignInProvider>
        {/* Leader-tour banner + multi-page controller. Visible on every page
            until a leader completes the walkthrough + signs the
            acknowledgment; non-leaders never see it. Gated client-side off
            /api/me now — the leader flags used to come from a server-side
            profile read in this layout, which forced every route dynamic. */}
        <LeaderTourGate />

        {/* Site-wide soft announcement (editable from /admin/content) — renders
            only when admin sets global.announcement content. */}
        <GlobalAnnouncement />

        {/* Static service-status banner — code-committed so it renders even
            when the DATABASE is the outage (the DB-driven EmergencyBanner
            below can't turn on in that case). Flip off in status-banner.ts. */}
        {statusBanner.enabled && (
          <div role="alert" className="border-b-2 border-amber-500 bg-amber-950/40 text-amber-100">
            <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 lg:px-8">
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">⚠ Service notice</p>
              <p className="mt-0.5 text-sm font-semibold leading-tight sm:text-base">{statusBanner.title}</p>
              <p className="mt-0.5 text-xs sm:text-sm">{statusBanner.body}</p>
            </div>
          </div>
        )}

        {/* Site-wide emergency banner — renders only when admin toggles emergency_mode on */}
        <EmergencyBanner />

        <header
          className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/85 backdrop-blur"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <a
              href="/"
              className="flex items-center gap-1 text-lg font-bold leading-none"
              aria-label="iKratom home"
            >
              <span className="text-emerald-400">i</span>
              <span>Kratom</span>
            </a>

            {/* Desktop nav (md+). The 10 flat sections from v1 are
                grouped into 4 dropdown categories inside HeaderNav so
                the toolbar reads cleanly. The Share button is server-
                rendered (HeaderShare) so we can pre-pick the user's
                personal /i/CODE link or a generic URL depending on
                auth state without round-tripping to the client. */}
            <nav className="hidden items-center gap-3 text-sm md:flex">
              <HeaderNav />
              <a
                href="/search"
                aria-label="Site search"
                title="Search bills, research, legislators, campaigns, discussions"
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-zinc-200 hover:text-emerald-400"
              >
                🔎<span className="sr-only">Search</span>
              </a>
              <ThemeQuickControls placement="toolbar" />
              <span className="mx-1 h-5 w-px bg-zinc-800" aria-hidden />
              <InstallAppButton variant="desktop" />
              <HeaderShare />
              <HeaderAuth />
            </nav>

            {/* Mobile right-side controls (<md): always-visible auth
                pill + the hamburger. Pill gives one-tap access to
                Sign in / Dashboard without opening the menu, since
                that's the most-common destination. */}
            <div className="flex items-center gap-2 md:hidden">
              <ThemeQuickControls placement="toolbar" />
              <InstallAppButton variant="mobile" />
              <MobileAuthPill />
              <MobileNavGate />
            </div>
          </div>
        </header>

        {/* Mobile gets tab-bar-height + safe-area-inset-bottom padding so
            content never sits behind the bottom nav OR the iPhone home
            indicator / Android gesture pill. The 5rem matches MobileTabBar's
            ~56px height; safe-area adds the gesture-bar offset on devices
            that need it. */}
        {/* Bottom padding clears: mobile tab bar (3.5rem) + donation strip
            (~1.75rem) + device safe-area; desktop just the strip. */}
        <main className="flex-1 pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-7"><ShareBanner />{children}</main>

        <footer className="border-t border-zinc-800 bg-zinc-950 py-8">
          <div className="mx-auto max-w-6xl px-4 text-center text-xs text-zinc-500 sm:px-6 lg:px-8">
            <nav className="mb-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
              <a href="/how-it-works" className="hover:text-emerald-400">How it works</a>
              <a href="/academy" className="hover:text-emerald-400">Academy</a>
              <a href="/roles" className="hover:text-emerald-400">Roles</a>
              <a href="/spread" className="hover:text-emerald-400">Storefront kit</a>
              <a href="/ethics" className="hover:text-emerald-400">Ethics</a>
              <a href="/research" className="hover:text-emerald-400">Research</a>
              <a href="/intel" className="hover:text-emerald-400">Intel hub</a>
              <a href="/calendar" className="hover:text-emerald-400">Calendar</a>
              <a href="/deadlines" className="hover:text-emerald-400">Deadlines</a>
              <a href="/whats-new" className="hover:text-emerald-400">What&apos;s new</a>
              <a href="/support" className="font-semibold text-emerald-400 hover:text-emerald-300">♥ Support</a>
              <a href="/status" className="hover:text-emerald-400">Status</a>
              <a href="/glossary" className="hover:text-emerald-400">Glossary</a>
              <a href="/communities" className="hover:text-emerald-400">Communities</a>
              <a href="/install" className="hover:text-emerald-400">Install</a>
              <a href="/terms" className="hover:text-emerald-400">Terms</a>
              <a href="/privacy" className="hover:text-emerald-400">Privacy</a>
              <a href="/cookies" className="hover:text-emerald-400">Cookies</a>
              <a href="https://github.com/ohjustadam/ikratom/blob/main/LICENSE.md" target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400">Source &amp; license</a>
              <a href={`mailto:${siteConfig.links.support}`} className="hover:text-emerald-400">Contact</a>
            </nav>
            <div className="mb-4 flex items-center justify-center gap-2">
              <span className="text-zinc-600">🌐</span>
              <LocaleSwitcherGate />
            </div>
            <p>
              {siteConfig.name} is a nonpartisan advocacy tool. Not affiliated with any
              kratom organization. Kratom statements have not been evaluated by the FDA.
            </p>
            <p className="mt-2">
              &copy; {new Date().getFullYear()} {siteConfig.name}. The advocate&apos;s toolbelt.
            </p>
            <p className="mt-3">
              <a
                href="https://www.r3dpillai.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-[11px] text-zinc-500 transition-colors hover:border-emerald-700/50 hover:text-emerald-400"
              >
                <span aria-hidden>⚡</span>
                Powered by r3dpillai
              </a>
            </p>
          </div>
        </footer>

        <CookieBanner />
        <MobileTabBar />

        {/* Donation strip — always visible along the bottom border
            (above the tab bar on mobile). Deliberately simple: plain
            text; the cashtag links straight to the Cash App profile. */}
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-emerald-900/50 bg-zinc-950/95 px-3 py-1.5 text-center text-[11px] text-zinc-400 backdrop-blur md:bottom-0">
          💚 iKratom is free &amp; community-funded — chip in on Cash App:{" "}
          <a
            href="https://cash.app/$ohjustadam"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono font-semibold text-emerald-300 underline decoration-emerald-700/60 underline-offset-2 hover:text-emerald-200"
          >
            $ohjustadam
          </a>
        </div>
        <RegisterSW />
        <PushBackStop />
        <PresenceHeartbeatGate />
        <InstallPrompt />
        <FeedbackWidget />
        {/* Floating appearance control — a small icon on every screen, sitting
            just above the Feedback tab. Opens the same theme/color popover the
            toolbar button does. */}
        <ThemeQuickControls placement="floating" />
        {/* Lounge live chat as a floating widget on every page (its full home
            stays at /forum, where this self-hides). Gated on the forum flag. */}
        {siteConfig.features.forum && <ChatPopup />}
        </SignInProvider>
        </ChromeProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
