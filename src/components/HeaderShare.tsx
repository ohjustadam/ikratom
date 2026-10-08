"use client";

import { useChrome } from "@/components/chrome/ChromeProvider";
import { HeaderShareButton } from "./HeaderShareButton";
import { InviteFriends } from "./InviteFriends";

/**
 * Picks the right share payload based on auth state, then hands it to the
 * HeaderShareButton modal trigger.
 *
 *   Signed-in:  user's personal /i/CODE invite link → attributed share
 *   Signed-out: generic homepage URL → unattributed but functional
 *
 * Client component (2026-07-22) — was a server component awaiting
 * `getMyInviteSummary()`, a cookie read in the ROOT layout that forced every
 * route in the app to render dynamically. The invite code now rides along on
 * /api/me. See `private/STATIC_CHROME_PLAN.md`.
 *
 * The URL is built from `window.location.origin` rather than APP_URL: the user
 * is already on the canonical host, so it's correct by construction and needs
 * no server round-trip. Falls back to the production URL for the pre-mount
 * render.
 */
export function HeaderShare() {
  const { me } = useChrome();

  const origin =
    typeof window !== "undefined"
      ? window.location.origin.replace(/\/+$/, "")
      : "https://www.ikratom.org";

  const inviteCode = me?.inviteCode ?? null;
  const isPersonal = !!inviteCode;
  const inviteUrl = isPersonal ? `${origin}/i/${inviteCode}` : origin;

  return (
    <HeaderShareButton>
      <p className="text-xs text-zinc-400">
        {isPersonal
          ? "Your personal invite link — anyone who signs up through it gets credited to you on your /account/invite page."
          : "Spread the word. Anyone who joins helps push back on hostile rulemaking. Sign in first if you want credit for invites you bring in."}
      </p>
      <div className="mt-3">
        <InviteFriends inviteUrl={inviteUrl} compact />
      </div>
      {isPersonal && (
        <p className="mt-3 text-center text-xs">
          <a href="/account/invite" className="text-emerald-400 hover:underline">
            Open full invite hub →
          </a>
        </p>
      )}
    </HeaderShareButton>
  );
}
