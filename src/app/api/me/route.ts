import { NextResponse } from "next/server";
import { getCachedAuthProfile } from "@/lib/supabase/server";
import { getUnreadNotificationCount } from "@/modules/notifications/actions";
import { getUnreadDmCount } from "@/modules/dm/actions";
import { getMyInviteSummary } from "@/modules/invite/actions";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { readLocale } from "@/modules/auth/actions-locale";

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
  state: string | null;
  emailConnected: boolean;
  locale: string;
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
  state: null,
  emailConnected: false,
  locale: "en",
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
    // This is the one endpoint every real browser hits on every page load, and
    // it does a profile read plus three counts. The cap is deliberately high —
    // normal browsing never approaches 300/min, and shared NAT egress means a
    // tight limit would punish an office or campus before it stopped anyone.
    // Returns the ANON shape rather than an error so the site chrome still
    // renders; a rate-limited reader sees a signed-out header, not a broken page.
    const ip = await getClientIp();
    if (!(await checkRateLimit(`chrome-me:${ip}`, 300, 60))) {
      return NextResponse.json(ANON, {
        status: 429,
        headers: { "Cache-Control": "no-store" },
      });
    }

    // Locale is resolved for EVERYONE, before the signed-out early return: an
    // anonymous reader can still have a language cookie, and this route is now
    // the only place the site reads it (see components/TranslatedText.tsx).
    const locale = await readLocale().catch(() => "en");

    const { userId, profile } = await getCachedAuthProfile();
    if (!userId || !profile) {
      return NextResponse.json({ ...ANON, locale }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const isAdmin = !!(profile.is_admin || profile.is_owner);
    const isLeader = isAdmin || !!profile.is_advocate_leader;

    // Counts + invite code are best-effort: the chrome must render even if one
    // of these fails. A failed badge is a cosmetic loss; a thrown route would
    // blank the header on every page.
    // email_integrations is a light self-read (RLS allows own row) that drives
    // the "sync your email" nudge. It lives here rather than on /campaigns so
    // that page can be a cached static file — see src/app/campaigns/page.tsx.
    const sb = await (await import("@/lib/supabase/server")).createClient();
    const [notifications, dms, invite, integ] = await Promise.all([
      getUnreadNotificationCount().catch(() => 0),
      getUnreadDmCount().catch(() => 0),
      getMyInviteSummary().catch(() => null),
      Promise.resolve(
        sb.from("email_integrations").select("account_email").eq("user_id", userId).maybeSingle(),
      ).then((r) => r.data).catch(() => null),
    ]);

    const me: ChromeMe = {
      userId,
      username: profile.username ?? null,
      avatarUrl: profile.avatar_url ?? null,
      fullName: profile.full_name ?? null,
      state: profile.state ?? null,
      emailConnected: !!integ?.account_email,
      locale,
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
