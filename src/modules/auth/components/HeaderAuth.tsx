"use client";

import { useChrome } from "@/components/chrome/ChromeProvider";
import { SignOutButton } from "./SignOutButton";
import { HeaderBell } from "@/modules/notifications/components/HeaderBell";
import { MessagesIcon } from "@/modules/dm/components/MessagesIcon";
import { HeaderAvatar } from "./HeaderAvatar";

/**
 * Header auth cluster.
 *
 * Client component (2026-07-22). This used to `await getCachedAuthProfile()`
 * on the server, and because it renders in the ROOT layout that cookie read
 * opted every route in the app out of static generation — the root cause of
 * the Fluid-CPU outage. State now comes from /api/me via ChromeProvider, which
 * crawlers never trigger. See `private/STATIC_CHROME_PLAN.md`.
 */
export function HeaderAuth() {
  const { me, loading } = useChrome();

  // Fixed-width placeholder while the first /api/me lands. Matches the
  // "Sign in" button's footprint so the header doesn't reflow on hydration —
  // without this every page load would visibly jump.
  if (loading) {
    return (
      <span
        aria-hidden
        className="inline-block h-[30px] w-[72px] rounded-md bg-zinc-900/60"
      />
    );
  }

  if (!me?.userId) {
    return (
      <a
        href="/login"
        className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
      >
        Sign in
      </a>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <MessagesIcon count={me.unreadDms} />
      <HeaderBell count={me.unreadNotifications} />
      <a href="/dashboard" className="hidden text-zinc-300 hover:text-emerald-400 lg:inline">
        Dashboard
      </a>
      {me.isLeader && (
        <a
          href={me.isAdmin ? "/admin" : "/leader"}
          className="rounded-md border border-emerald-700/50 px-2 py-1 text-emerald-300 hover:border-emerald-500"
        >
          {me.isAdmin ? "Admin" : "Leader"}
        </a>
      )}
      <HeaderAvatar
        username={me.username}
        avatarUrl={me.avatarUrl}
        fullName={me.fullName}
      />
      <span className="hidden lg:inline">
        <SignOutButton />
      </span>
    </div>
  );
}
