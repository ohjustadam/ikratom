"use client";

import { useSyncExternalStore } from "react";
import Link from "@/components/Link";
import { useChrome } from "@/components/chrome/ChromeProvider";
import { hasSupabaseAuthCookie, viewerLooksSignedIn } from "@/lib/chrome-cookies";
import { connectHeroLinks } from "./hero-links";

const noSubscribe = () => () => {};
const authCookieNow = () => {
  try { return hasSupabaseAuthCookie(document.cookie); } catch { return false; }
};
// The prerendered HTML is the visitor's version: no cookie exists at build time.
const authCookieAtBuild = () => false;

/**
 * The hero buttons on /connect, decided in the browser so the page itself
 * stays static (a server cookie read would make every view a paid function
 * call). See `connectHeroLinks` for what each viewer gets.
 */
export function ConnectHeroActions() {
  const chrome = useChrome();
  const hasAuthCookie = useSyncExternalStore(noSubscribe, authCookieNow, authCookieAtBuild);
  const signedIn = viewerLooksSignedIn(
    { loading: chrome.loading, userId: chrome.me?.userId },
    hasAuthCookie,
  );
  return (
    <div className="mt-5 flex flex-wrap gap-3">
      {connectHeroLinks(signedIn).map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={
            l.primary
              ? "rounded-md bg-emerald-500 px-5 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400"
              : "rounded-md border border-zinc-700 px-5 py-2.5 font-semibold hover:border-emerald-500 hover:text-emerald-400"
          }
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
