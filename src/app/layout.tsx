import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { siteConfig } from "@/config/site.config";
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
import { InstallPrompt } from "@/components/InstallPrompt";
import FeedbackWidget from "@/components/FeedbackWidget";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PostHogProvider } from "@/lib/posthog/PostHogProvider";
import { SignInProvider } from "@/components/auth/SignInContext";
import { LeaderTourController } from "@/modules/dashboard/LeaderTourController";
import { LeaderTourBanner } from "@/modules/dashboard/LeaderTourBanner";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { readLocale } from "@/modules/auth/actions-locale";
import { getCachedAuthProfile } from "@/lib/supabase/server";
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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await readLocale();

  // Cheap auth check so MobileNav can show admin / leader sub-section,
  // plus leader-tour bootstrap state. Single row read; never blocks
  // render — falls back to non-admin on error.
  let isAdmin = false;
  let isLeader = false;
  let leaderTourPending = false;
  let leaderAcknowledged = true; // assume true so we don't flash a banner for non-leaders
  // Signed-in users' saved UI prefs, server-rendered onto <html> so they
  // apply cross-device with no flash. Null for anon → the inline script
  // falls back to localStorage (or the app defaults).
  let uiTheme: string | undefined;
  let uiAccent: string | undefined;
  let uiAccentHex: string | undefined;
  let uiMode: string | undefined;
  try {
    // Request-cached: shares the single auth round-trip + profile read
    // with HeaderAuth (see getCachedAuthProfile). Was a per-render
    // getUser() + profile select; now deduped across the chrome.
    const { profile } = await getCachedAuthProfile();
    if (profile) {
      isAdmin = !!(profile.is_admin || profile.is_owner);
      isLeader = !!(isAdmin || profile.is_advocate_leader);
      leaderTourPending = isLeader && !!profile.leader_tour_pending;
      leaderAcknowledged = !isLeader || !!profile.leader_acknowledged_at;
      uiTheme = profile.ui_theme ?? undefined;
      uiAccent = profile.ui_accent ?? undefined;
      uiAccentHex = profile.ui_accent_hex ?? undefined;
      uiMode = profile.ui_mode ?? undefined;
    }
  } catch {
    // non-fatal — drawer just hides admin / leader section
  }

  return (
    <html
      lang={locale}
      className={`${geist.variable} h-full antialiased`}
      suppressHydrationWarning
      data-theme={uiTheme}
      data-accent={uiAccentHex ? "custom" : uiAccent}
      data-accent-hex={uiAccentHex}
      data-mode={uiMode}
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-geist)]">
        {/* Set theme/accent/mode on <html> before paint to avoid a flash of
            the wrong UI (FOUC). For signed-in users the server already set
            the data-* attributes from their profile — respect those and
            mirror them into localStorage. For anon, read localStorage (or
            fall back to the app defaults: dark / emerald / normal). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.documentElement;try{var t=d.dataset.theme;if(t==='light'||t==='dark'){localStorage.setItem('ikratom-theme',t)}else{var s=localStorage.getItem('ikratom-theme');d.dataset.theme=(s==='light'||s==='dark')?s:'dark'}function rmp(hex){var mm=/^#?([0-9a-f]{6})$/i.exec(hex);if(!mm)return;var nn=parseInt(mm[1],16),rr=(nn>>16&255)/255,gg=(nn>>8&255)/255,bb=(nn&255)/255,mx=Math.max(rr,gg,bb),mn=Math.min(rr,gg,bb),Lf=(mx+mn)/2,df=mx-mn,sf=df===0?0:df/(1-Math.abs(2*Lf-1)),Hf=0;if(df){if(mx===rr)Hf=((gg-bb)/df)%6;else if(mx===gg)Hf=(bb-rr)/df+2;else Hf=(rr-gg)/df+4;Hf*=60;if(Hf<0)Hf+=360}var SP=sf*100,LP=Lf*100,st=d.style;st.setProperty('--accent',hex);var dl={500:0,400:8,300:18,200:30,100:42,50:50,600:-8,700:-16,800:-24,900:-32,950:-40};for(var kk in dl){var ll=Math.max(0,Math.min(100,LP+dl[kk]));st.setProperty('--color-emerald-'+kk,'hsl('+Hf+' '+SP+'% '+ll+'%)')}d.dataset.accent='custom'}var a=d.dataset.accent;if(a==='custom'){var hx=d.dataset.accentHex;if(hx){localStorage.setItem('ikratom-accent-hex',hx);localStorage.setItem('ikratom-accent','custom');rmp(hx)}}else if(a){localStorage.setItem('ikratom-accent',a);localStorage.removeItem('ikratom-accent-hex')}else{var shx=localStorage.getItem('ikratom-accent-hex');var sa=localStorage.getItem('ikratom-accent');if(sa==='custom'&&shx){rmp(shx)}else if(sa){d.dataset.accent=sa}}var m=d.dataset.mode;if(m){localStorage.setItem('ikratom-mode',m)}else{var sm=localStorage.getItem('ikratom-mode');if(sm)d.dataset.mode=sm}}catch(e){if(!d.dataset.theme)d.dataset.theme='dark'}})();`,
          }}
        />
        <PostHogProvider>
        <SignInProvider>
        {/* Leader-tour banner — visible on every page until a leader
            completes the multi-page walkthrough + signs the
            acknowledgment. Non-leaders never see it. */}
        {isLeader && !leaderAcknowledged && <LeaderTourBanner />}

        {/* Multi-page tour controller. Mounts on every page; only fires
            when leader_tour_pending=true and acknowledgment is missing.
            Persists state via localStorage across navigation. */}
        {isLeader && (
          <LeaderTourController
            pending={leaderTourPending}
            alreadyAcknowledged={leaderAcknowledged}
          />
        )}

        {/* Site-wide soft announcement (editable from /admin/content) — renders
            only when admin sets global.announcement content. */}
        <GlobalAnnouncement />

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
              <ThemeToggle />
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
              <ThemeToggle />
              <InstallAppButton variant="mobile" />
              <MobileAuthPill />
              <MobileNav authSlot={<HeaderAuth />} isAdmin={isAdmin} isLeader={isLeader} />
            </div>
          </div>
        </header>

        {/* Mobile gets tab-bar-height + safe-area-inset-bottom padding so
            content never sits behind the bottom nav OR the iPhone home
            indicator / Android gesture pill. The 5rem matches MobileTabBar's
            ~56px height; safe-area adds the gesture-bar offset on devices
            that need it. */}
        <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>

        <footer className="border-t border-zinc-800 bg-zinc-950 py-8">
          <div className="mx-auto max-w-6xl px-4 text-center text-xs text-zinc-500 sm:px-6 lg:px-8">
            <nav className="mb-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
              <a href="/how-it-works" className="hover:text-emerald-400">How it works</a>
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
              <a href={`mailto:${siteConfig.links.support}`} className="hover:text-emerald-400">Contact</a>
            </nav>
            <div className="mb-4 flex items-center justify-center gap-2">
              <span className="text-zinc-600">🌐</span>
              <LocaleSwitcher current={locale} />
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
        <RegisterSW />
        <InstallPrompt />
        <FeedbackWidget />
        </SignInProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
