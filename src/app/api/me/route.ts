import { NextResponse } from "next/server";
import { getCachedAuthProfile } from "@/lib/supabase/server";
import { getUnreadNotificationCount } from "@/modules/notifications/actions";
import { getUnreadDmCount } from "@/modules/dm/actions";
import { getMyInviteSummary } from "@/modules/invite/actions";

/**
 * /api/me — the ONE per-user read the site chrome needs.
 *
 * WHY THIS EXISTS (2026-07-22 outage): the root layout used to await
 * `getCachedAuthProfile()` + `readLocale()`. A cookie read in the ROOT layout
 * opts EVERY route out of static generation, so all 215 pages server-rendered
 * on every hit — 688K function invocations and 12h of Fluid CPU against a 4h
 * allowance, while PostHog recorded 43 human pageviews in the same month.
 * ~16,000 machine requests per human, all of it rendering pages for crawlers.
 *
 * Moving this read here inverts the economics: **crawlers don't execute
 * JavaScript, so they never call this route.** Public pages become static
 * files served from the CDN at zero compute, and per-user work happens once
 * per real browser. Compute now scales with humans, not bots.
 *
 * This route SHOULD be dynamic — it is the one place per-viewer work belongs.
 * Never cache it, never prerender it, and never move these reads back up into
 * a layout. See `private/STATIC_CHROME_PLAN.md`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type ChromeMe = {
  userId: string | null;
  username: string | null;
  avatarUrl: string | null;
  fullName: string | null;
  isAdmin: boolean;
  isLeader: boolean;
  leaderTourPending: boolean;
  leaderAcknowledged: boolean;
  unreadNotifications: number;
  unreadDms: number;
  inviteCode: string | null;
  ui: {
    theme: string | null;
    accent: string | null;
    accentHex: string | null;
    mode: string | null;
  };
};

const ANON: ChromeMe = {
  userId: null,
  username: null,
  avatarUrl: null,
  fullName: null,
  isAdmin: false,
  isLeader: false,
  leaderTourPending: false,
  // `true` so a non-leader never flashes the leader-tour banner.
  leaderAcknowledged: true,
  unreadNotifications: 0,
  unreadDms: 0,
  inviteCode: null,
  ui: { theme: null, accent: null, accentHex: null, mode: null },
};

export async function GET() {
  try {
    const { userId, profile } = await getCachedAuthProfile();
    if (!userId || !profile) {
      return NextResponse.json(ANON, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const isAdmin = !!(profile.is_admin || profile.is_owner);
    const isLeader = isAdmin || !!profile.is_advocate_leader;

    // Counts + invite code are best-effort: the chrome must render even if one
    // of these fails. A failed badge is a cosmetic loss; a thrown route would
    // blank the header on every page.
    const [notifications, dms, invite] = await Promise.all([
      getUnreadNotificationCount().catch(() => 0),
      getUnreadDmCount().catch(() => 0),
      getMyInviteSummary().catch(() => null),
    ]);

    const me: ChromeMe = {
      userId,
      username: profile.username ?? null,
      avatarUrl: profile.avatar_url ?? null,
      fullName: profile.full_name ?? null,
      isAdmin,
      isLeader,
      leaderTourPending: isLeader && !!profile.leader_tour_pending,
      leaderAcknowledged: !isLeader || !!profile.leader_acknowledged_at,
      unreadNotifications: typeof notifications === "number" ? notifications : 0,
      unreadDms: typeof dms === "number" ? dms : 0,
      inviteCode: invite?.invite_code ?? null,
      ui: {
        theme: profile.ui_theme ?? null,
        accent: profile.ui_accent ?? null,
        accentHex: profile.ui_accent_hex ?? null,
        mode: profile.ui_mode ?? null,
      },
    };

    return NextResponse.json(me, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Fail as anonymous rather than 500 — a broken chrome read must never take
    // down the page it renders on.
    return NextResponse.json(ANON, { headers: { "Cache-Control": "no-store" } });
  }
}
