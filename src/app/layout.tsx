import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { siteConfig } from "@/config/site.config";
import { HeaderAuth } from "@/modules/auth/components/HeaderAuth";
import { MobileAuthPill } from "@/modules/auth/components/MobileAuthPill";
import { HeaderNav } from "@/components/HeaderNav";
import { HeaderShare } from "@/components/HeaderShare";
import { CookieBanner } from "@/components/CookieBanner";
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { MobileNav } from "@/components/MobileNav";
import { MobileTabBar } from "@/components/MobileTabBar";
import { RegisterSW } from "@/components/RegisterSW";
import { InstallPrompt } from "@/components/InstallPrompt";
import { PostHogProvider } from "@/lib/posthog/PostHogProvider";
import { LeaderTourController } from "@/modules/dashboard/LeaderTourController";
import { LeaderTourBanner } from "@/modules/dashboard/LeaderTourBanner";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { readLocale } from "@/modules/auth/actions-locale";
import { createClient } from "@/lib/supabase/server";
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
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin, is_owner, is_advocate_leader, leader_tour_pending, leader_acknowledged_at")
        .eq("id", user.id)
        .single();
      isAdmin = !!(profile?.is_admin || profile?.is_owner);
      isLeader = !!(isAdmin || profile?.is_advocate_leader);
      leaderTourPending = isLeader && !!profile?.leader_tour_pending;
      leaderAcknowledged = !isLeader || !!profile?.leader_acknowledged_at;
    }
  } catch {
    // non-fatal — drawer just hides admin / leader section
  }

  return (
    <html lang={locale} className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-[family-name:var(--font-geist)]">
        <PostHogProvider>
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
              <span className="mx-1 h-5 w-px bg-zinc-800" aria-hidden />
              <HeaderShare />
              <HeaderAuth />
            </nav>

            {/* Mobile right-side controls (<md): always-visible auth
                pill + the hamburger. Pill gives one-tap access to
                Sign in / Dashboard without opening the menu, since
                that's the most-common destination. */}
            <div className="flex items-center gap-2 md:hidden">
              <MobileAuthPill />
              <MobileNav authSlot={<HeaderAuth />} isAdmin={isAdmin} isLeader={isLeader} />
            </div>
          </div>
        </header>

        {/* Mobile gets pb-20 so tab bar doesn't cover the bottom of pages */}
        <main className="flex-1 pb-20 md:pb-0">{children}</main>

        <footer className="border-t border-zinc-800 bg-zinc-950 py-8">
          <div className="mx-auto max-w-6xl px-4 text-center text-xs text-zinc-500 sm:px-6 lg:px-8">
            <nav className="mb-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
              <a href="/how-it-works" className="hover:text-emerald-400">How it works</a>
              <a href="/ethics" className="hover:text-emerald-400">Ethics</a>
              <a href="/research" className="hover:text-emerald-400">Research</a>
              <a href="/calendar" className="hover:text-emerald-400">Calendar</a>
              <a href="/deadlines" className="hover:text-emerald-400">Deadlines</a>
              <a href="/whats-new" className="hover:text-emerald-400">What&apos;s new</a>
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
          </div>
        </footer>

        <CookieBanner />
        <MobileTabBar />
        <RegisterSW />
        <InstallPrompt />
        </PostHogProvider>
      </body>
    </html>
  );
}
