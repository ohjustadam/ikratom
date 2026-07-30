"use client";

import { PageShare } from "./PageShare";
import { useChromeMe } from "./chrome/ChromeProvider";

/**
 * Appends the signed-in user's invite code to the shared URL so attribution
 * flows when sharing a specific page (not just the homepage). Signed-out
 * visitors get the bare URL.
 *
 * ── WHY THIS IS A CLIENT COMPONENT (changed 2026-07-30) ──────────────────────
 * It used to be an async SERVER component that awaited `getMyInviteSummary()`,
 * which calls `auth.getUser()`. That single await made it impossible to cache
 * any page rendering it — and it is rendered by EIGHT pages (/banned,
 * /bills/:id, /briefings/:slug, /library/:id, /news, /pulse, /stories,
 * /takeback), several of which are the most-crawled surfaces in the app.
 *
 * Worse, it baked a per-user secret into the markup: the URL literally
 * contained `?via=<that viewer's invite_code>`. Anything that cached that HTML
 * would have handed one user's personal referral code to every other visitor.
 * A route audit caught this while building the Cloudflare edge-cache allowlist.
 *
 * Reading the code on the CLIENT fixes both problems at once. The server now
 * renders the same bare URL for everybody (cacheable, nothing personal in it),
 * and the code is filled in after hydration for whoever is actually signed in.
 * Attribution behaviour is unchanged for real users; crawlers, which don't run
 * JS, never trigger the lookup at all.
 *
 * This is the same pattern the root layout already uses — see the guard comment
 * in src/app/layout.tsx. `useChromeMe()` reads ChromeProvider's single
 * `/api/me` fetch, so this adds NO extra network request.
 */
export function PageShareWithAttribution({
  path,
  title,
  summary,
  align = "right",
}: {
  path: string;
  title: string;
  summary?: string;
  align?: "left" | "right";
}) {
  const { inviteCode } = useChromeMe();
  // Must be NEXT_PUBLIC_* to exist in the browser bundle. Unset today, so the
  // canonical production origin is the effective value — which is also what we
  // want in a share link regardless of which host rendered it.
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ikratom.org").replace(/\/+$/, "");
  const sep = path.includes("?") ? "&" : "?";
  const url = inviteCode ? `${base}${path}${sep}via=${inviteCode}` : `${base}${path}`;
  return <PageShare url={url} title={title} summary={summary} align={align} />;
}
