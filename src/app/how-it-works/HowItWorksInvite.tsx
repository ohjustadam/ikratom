"use client";

import { InviteFriends } from "@/components/InviteFriends";
import { useChromeMe } from "@/components/chrome/ChromeProvider";

/**
 * The invite widget on the public tour, with attribution resolved CLIENT-side.
 *
 * WHY THIS EXISTS (2026-09-10 egress work). This used to be an async server
 * component that awaited `getMyInviteSummary()` — which calls
 * `auth.getUser()`. That single cookie read opted /how-it-works out of static
 * generation entirely, so every crawler hit re-ran the page's four count
 * queries against Supabase to answer a question about a visitor who, being a
 * bot, was never signed in.
 *
 * Worse for a page we now cache: the old markup embedded the viewer's own
 * `invite_code` in the URL. Caching that HTML would have handed one advocate's
 * personal referral link to every other visitor. This is the identical fix
 * already applied to `PageShareWithAttribution` — read the code on the client,
 * from the single `/api/me` fetch ChromeProvider already makes, so the cached
 * server HTML contains nothing personal and adds no extra network request.
 *
 * Behaviour is unchanged for real users: signed-in advocates get their
 * attributed `/i/<code>` link, signed-out visitors get the bare homepage URL —
 * exactly what `buildInviteUrl()` and its fallback produced before.
 */
export function HowItWorksInvite() {
  const { inviteCode } = useChromeMe();
  // Must be NEXT_PUBLIC_* to exist in the browser bundle. Unset today, so the
  // canonical production origin is the effective value — which is what belongs
  // in a share link regardless of which host rendered the page.
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ikratom.org").replace(/\/+$/, "");
  const inviteUrl = inviteCode ? `${base}/i/${inviteCode}` : base;
  return <InviteFriends inviteUrl={inviteUrl} />;
}
