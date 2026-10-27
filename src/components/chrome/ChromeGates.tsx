"use client";

import { useEffect, useState } from "react";
import { useChrome } from "./ChromeProvider";
import { LeaderTourBanner } from "@/modules/dashboard/LeaderTourBanner";
import { LeaderTourController } from "@/modules/dashboard/LeaderTourController";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { MobileNav } from "@/components/MobileNav";
import { HeaderAuth } from "@/modules/auth/components/HeaderAuth";
import { PresenceHeartbeat } from "@/components/PresenceHeartbeat";

/**
 * Thin client gates that supply what the root layout used to pass down from
 * its server-side auth/locale reads.
 *
 * These components were ALREADY client components — the only reason the layout
 * had to read cookies on the server was to compute their props. Sourcing those
 * props from /api/me (and from document.cookie for locale) is what lets the
 * root layout render statically. See `private/STATIC_CHROME_PLAN.md`.
 */

/** Leader-tour banner + controller. Renders nothing for non-leaders. */
export function LeaderTourGate() {
  const { me, loading } = useChrome();
  // Render nothing until we know — a banner that flashes in for every
  // anonymous visitor would be worse than one that appears a beat late.
  if (loading || !me?.isLeader) return null;
  return (
    <>
      {!me.leaderAcknowledged && <LeaderTourBanner />}
      <LeaderTourController
        pending={me.leaderTourPending}
        alreadyAcknowledged={me.leaderAcknowledged}
      />
    </>
  );
}

/**
 * Admin-only build stamp, bottom-left: the live commit and its build time, so
 * the owner can tell whether a fix is live before reporting it again. The
 * commit is public (the repo is), so the client-side admin flag is enough.
 */
export function BuildStampGate() {
  const { me } = useChrome();
  if (!me?.isAdmin) return null;
  const sha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev";
  const built = new Date(process.env.NEXT_PUBLIC_BUILD_TIME ?? Date.now()).toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  return (
    <a
      href={sha === "dev" ? "#" : `https://github.com/ohjustadam/ikratom/commit/${sha}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Live build (admins only)"
      className="fixed bottom-1 left-1 z-40 rounded bg-zinc-900/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 hover:text-zinc-300 max-md:bottom-[4.5rem]"
    >
      build {sha} · {built} CT
    </a>
  );
}

/** Mobile drawer — needs admin/leader flags to show its privileged sections. */
export function MobileNavGate() {
  const { me } = useChrome();
  return (
    <MobileNav
      authSlot={<HeaderAuth />}
      isAdmin={!!me?.isAdmin}
      isLeader={!!me?.isLeader}
    />
  );
}

/**
 * Locale switcher. The layout used to read the `locale` cookie server-side
 * purely to set this control's current value; it's a non-HttpOnly preference
 * cookie, so the client can read it directly.
 */
// Mirrors LocaleSwitcher's accepted values. Anything else in the cookie is
// ignored rather than trusted — the cookie is client-writable.
const LOCALES = ["en", "id", "th", "ms", "vi"] as const;
type Locale = (typeof LOCALES)[number];
const isLocale = (v: string): v is Locale => (LOCALES as readonly string[]).includes(v);

export function LocaleSwitcherGate() {
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    try {
      const m = document.cookie.match(/(?:^|;\s*)locale=([a-zA-Z-]{2,8})/);
      if (m?.[1] && isLocale(m[1])) setLocale(m[1]);
    } catch {
      /* keep the default */
    }
  }, []);

  return <LocaleSwitcher current={locale} />;
}

/**
 * Presence heartbeat — only meaningful for signed-in users. The layout used to
 * gate this on a server-side `signedIn` flag; now it gates on /api/me.
 */
export function PresenceHeartbeatGate() {
  const { me } = useChrome();
  if (!me?.userId) return null;
  return <PresenceHeartbeat />;
}
