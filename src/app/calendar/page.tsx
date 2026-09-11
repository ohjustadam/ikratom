import { Suspense } from "react";
import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CalendarView } from "./CalendarView";
import { etYmd, type CalendarSnapshot } from "./types";

export const metadata = {
  title: "Community Calendar — every public kratom event",
  description: "The kratom community calendar: elections + primaries, town halls + hearings, city/county meetings, bill actions, and legislative sessions in one place. Subscribe to the .ics feed.",
};

/**
 * Static + ISR. Was `force-dynamic`.
 *
 * WHY (2026-09-10 egress work). Two things pinned this page to a per-request
 * render, and neither was the data: the nine calendar sources have been a
 * cookieless service-role snapshot inside unstable_cache all along.
 *   - A COOKIE READ. `getCachedAuthProfile()` plus a `profiles` row lookup,
 *     used only to geofence election rows to the viewer's home state. That
 *     read now comes from the one /api/me chrome fetch real browsers already
 *     make — crawlers don't run JS, so they never trigger it.
 *   - searchParams. state/kind/view/month/day all steered the server render.
 *     They now live in CalendarView via useSearchParams(), inside the Suspense
 *     boundary Next requires for a prerendered page.
 *
 * Nothing per-viewer is baked into the cached HTML. The election geofence is a
 * convenience filter over public, already-approved rows — not access control —
 * so shipping the full set to the client and filtering there leaks nothing.
 *
 * And the reason this matters beyond egress: exceeding the Supabase free-tier
 * cap RESTRICTS the project rather than billing for it. A dynamic route 500s
 * in that state; a prerendered one is a file on the CDN and keeps serving.
 */
/**
 * ⚠ FROZEN WINDOW — RESTORE TO 900 ON 2026-09-16. ⚠
 *
 * Supabase free-tier egress was at 96.3% with the cycle resetting 09-16, and
 * exceeding it RESTRICTS the project (the API stops answering; the site goes
 * down). ISR is lazy — a cached page only re-renders when a request arrives
 * after its window — so the window IS the per-page cost ceiling. Stretching it
 * past the reset means this page renders at most once more for the rest of the
 * cycle and then costs nothing at all, while still serving instantly from the
 * CDN.
 *
 * The usual objection — "but the content goes stale" — barely applies here:
 * the cron fleet is ALREADY deferred by the egress gate, so the underlying
 * data is not moving either. Freezing the presentation of data that is itself
 * frozen loses almost nothing, and on-demand revalidation still works if
 * something genuinely urgent needs to publish.
 *
 * tests/egress-freeze-expiry.test.ts turns red after 2026-09-16 so this
 * reverts on evidence rather than on someone remembering.
 */
export const revalidate = 604800; // 7d — frozen; normal is 900

// All 9 calendar sources are public + identical for everyone (elections are
// geofenced in JS, per viewer, from the full cached set) → one shared snapshot
// across requests instead of 9 DB reads per visit/crawl. Service-role client
// because the data is public and unstable_cache can't use the cookie-bound
// request client; explicit public-safe columns only, never select("*"). The
// value is JSON-serialized, so raw rows (date strings) are cached and Date
// objects are built client-side. State/kind filtering also happens there, so
// searchParams never fragment the cache.
const getCalendarData = unstable_cache(
  async (): Promise<CalendarSnapshot> => {
    const supabase = createServiceRoleClient();
    const now = new Date();
    const horizon = new Date(now.getTime() + 90 * 86_400_000);  // next 90 days
    // Elections look further out than meetings — the general election + many
    // primaries sit months ahead — so election rows use a 1-year horizon.
    const electionHorizon = new Date(now.getTime() + 365 * 86_400_000);

    // Pull from multiple sources in parallel
    const [meetings, alerts, billActions, sessions, elections, townhalls, billsEffective, billsSunset, localVotes] = await Promise.all([
      supabase.from("municipal_meetings")
        .select("id, state, locality, body_name, meeting_at, format, zoom_url, livestream_url, agenda_url, agenda_text, in_person_address, public_comment_signup_url, source_url")
        .eq("moderation_status", "approved")
        .gte("meeting_at", now.toISOString())
        .lte("meeting_at", horizon.toISOString())
        .order("meeting_at", { ascending: true }),
      supabase.from("policy_alerts")
        .select("id, kind, severity, title, body, locality, source_url, occurs_at, bill_id")
        .eq("moderation_status", "approved")
        .not("occurs_at", "is", null)
        .gte("occurs_at", now.toISOString())
        .lte("occurs_at", horizon.toISOString())
        .in("severity", ["critical", "alert"])
        .order("occurs_at", { ascending: true }),
      supabase.from("bills")
        .select("id, state, bill_number, title, last_action, last_action_at, kratom_relevance, status")
        .eq("active", true)
        .in("kratom_relevance", ["anti", "pro"])
        .not("last_action_at", "is", null)
        .gte("last_action_at", new Date(now.getTime() - 14 * 86_400_000).toISOString())
        .order("last_action_at", { ascending: false })
        .limit(80),
      supabase.from("state_capital_info")
        .select("state, current_session_id, current_session_start, current_session_end, capital_city, legislature_url, hearing_schedule_url"),
      supabase.from("election_dates")
        .select("scope, state, locality, election_type, title, election_date, registration_deadline, source_url")
        .eq("moderation_status", "approved")
        // Eastern day, not UTC — else today's election vanishes from the calendar
        // + every ICS feed after ~8pm ET when the UTC date rolls (memory
        // civic-dates-anchor-eastern). Same for effective/sunset date columns below.
        .gte("election_date", etYmd(now))
        .lte("election_date", etYmd(electionHorizon))
        .order("election_date", { ascending: true }),
      supabase.from("legislator_events")
        .select("id, state, locality, title, description, event_type, starts_at, venue, source_url, legislator_id")
        .eq("active", true)
        .gte("starts_at", now.toISOString())
        .lte("starts_at", horizon.toISOString())
        .order("starts_at", { ascending: true }),
      // Upcoming "takes effect" dates for tracked bills — the most-asked
      // question ("when does this hit me?"). effective_date is a date column
      // (0029); look 1yr out like elections since laws are dated months ahead.
      supabase.from("bills")
        .select("id, state, bill_number, title, effective_date, kratom_relevance")
        .in("kratom_relevance", ["anti", "pro"])
        .not("effective_date", "is", null)
        .gte("effective_date", etYmd(now))
        .lte("effective_date", etYmd(electionHorizon))
        .order("effective_date", { ascending: true }),
      // Upcoming sunset/expiration dates — when a law's kratom provision auto-
      // repeals (0209). Sparse (most bans are permanent); 1-yr horizon like effective.
      supabase.from("bills")
        .select("id, state, bill_number, title, sunset_date, kratom_relevance")
        .in("kratom_relevance", ["anti", "pro"])
        .not("sunset_date", "is", null)
        .gte("sunset_date", etYmd(now))
        .lte("sunset_date", etYmd(electionHorizon))
        .order("sunset_date", { ascending: true }),
      // Local (city/county) kratom vote OUTCOMES (0210) — past events, so a
      // backward window; they populate calendar history + the month grid with a
      // pass/fail badge the raw alert never carried.
      supabase.from("local_vote_outcomes")
        .select("id, state, locality, vote_date, outcome, measure, source_url, policy_alert_id")
        .gte("vote_date", new Date(now.getTime() - 180 * 86_400_000).toISOString().slice(0, 10))
        .order("vote_date", { ascending: false })
        .limit(200),
    ]);

    // Supabase's generated types lag several of these migrations, so the row
    // shapes are declared in ./types and cast at this boundary.
    return {
      meetings: (meetings.data ?? []) as unknown as CalendarSnapshot["meetings"],
      alerts: (alerts.data ?? []) as unknown as CalendarSnapshot["alerts"],
      billActions: (billActions.data ?? []) as unknown as CalendarSnapshot["billActions"],
      sessions: (sessions.data ?? []) as unknown as CalendarSnapshot["sessions"],
      elections: (elections.data ?? []) as unknown as CalendarSnapshot["elections"],
      townhalls: (townhalls.data ?? []) as unknown as CalendarSnapshot["townhalls"],
      billsEffective: (billsEffective.data ?? []) as unknown as CalendarSnapshot["billsEffective"],
      billsSunset: (billsSunset.data ?? []) as unknown as CalendarSnapshot["billsSunset"],
      localVotes: (localVotes.data ?? []) as unknown as CalendarSnapshot["localVotes"],
    };
  },
  ["calendar-events"],
  { revalidate: 900, tags: ["calendar-events"] },
);

export default async function CalendarPage() {
  const snapshot = await getCalendarData();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Suspense is REQUIRED: CalendarView calls useSearchParams(), and Next
          refuses to prerender a page that reads them outside a boundary.
          renderedAtIso pins "now" so the prerender and the first client render
          agree; the client corrects to the real clock on mount. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-zinc-900/50" />}>
        <CalendarView snapshot={snapshot} renderedAtIso={new Date().toISOString()} />
      </Suspense>
    </div>
  );
}
