import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { siteConfig } from "@/config/site.config";
import { HeaderAuth } from "@/modules/auth/components/HeaderAuth";
import { CookieBanner } from "@/components/CookieBanner";
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
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-[family-name:var(--font-geist)]">
        <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <a href="/" className="flex items-center gap-2 text-lg font-bold">
              <span className="text-emerald-400">i</span>
              <span>Kratom</span>
            </a>
            <nav className="flex items-center gap-5 text-sm">
              <a href="/campaigns" className="hover:text-emerald-400">Campaigns</a>
              <a href="/legislators" className="hover:text-emerald-400">Legislators</a>
              <a href="/bills" className="hover:text-emerald-400">Bills</a>
              <a href="/news" className="hover:text-emerald-400">News</a>
              <a href="/library" className="hover:text-emerald-400">Library</a>
              <a href="/forum" className="hover:text-emerald-400">Forum</a>
              <HeaderAuth />
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-zinc-800 bg-zinc-950 py-8">
          <div className="mx-auto max-w-6xl px-4 text-center text-xs text-zinc-500 sm:px-6 lg:px-8">
            <nav className="mb-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
              <a href="/terms" className="hover:text-emerald-400">Terms</a>
              <a href="/privacy" className="hover:text-emerald-400">Privacy</a>
              <a href="/cookies" className="hover:text-emerald-400">Cookies</a>
              <a href={`mailto:${siteConfig.links.support}`} className="hover:text-emerald-400">Contact</a>
            </nav>
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
      </body>
    </html>
  );
}
