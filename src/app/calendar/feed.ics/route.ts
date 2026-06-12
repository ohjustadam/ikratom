/**
 * iCalendar feed for the kratom policy calendar.
 *
 * Users subscribe to this URL in Apple Calendar / Google Calendar /
 * Outlook to get every upcoming municipal meeting, BoP hearing, bill
 * action, and legislative-session bookend automatically on their phone
 * + computer — refreshed every 6 hours.
 *
 * Query params (identical to /calendar):
 *   ?state=XX   filter to a single state (case-insensitive)
 *   ?kind=K     filter to one event-kind: municipal|alert|bill_action|state_session
 *
 * Subscribe URLs you can hand to a user:
 *   https://www.ikratom.org/calendar/feed.ics            — everything (next 90d)
 *   https://www.ikratom.org/calendar/feed.ics?state=NY   — NY only
 *   https://www.ikratom.org/calendar/feed.ics?kind=municipal — municipal only
 *
 * For Apple Calendar (iOS/macOS): "File → New Calendar Subscription"
 * For Google Calendar: "Other calendars → Add by URL"
 *
 * Note: Apple/Google cache feeds aggressively (hours). The
 * X-PUBLISHED-TTL/REFRESH-INTERVAL headers tell well-behaved clients
 * 6 hours is fine; iOS often refreshes more often anyway.
 */
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildIcalDocument, type IcalEvent } from "@/lib/ical";

export const dynamic = "force-dynamic";
// Cache at the edge for 10 minutes — calendar clients revalidate every
// few hours anyway, this just protects against subscribe-flood traffic.
export const revalidate = 600;

const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";

const KIND_CATEGORIES: Record<string, string[]> = {
  municipal: ["Kratom", "Municipal meeting"],
  alert: ["Kratom", "Policy alert"],
  bill_action: ["Kratom", "Bill action"],
  state_session: ["Kratom", "Legislative session"],
  election: ["Election", "Voting"],
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const stateFilter = url.searchParams.get("state")?.toUpperCase() || null;
  const kindFilter = url.searchParams.get("kind") || null;

  const sb = await createClient();
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * 86_400_000);
  // Elections sit months out (general + many primaries) — 1-year horizon.
  const electionHorizon = new Date(now.getTime() + 365 * 86_400_000);

  // Same data shape as /calendar/page.tsx, just translated to iCal events.
  const [meetings, alerts, billActions, sessions, elections] = await Promise.all([
    sb.from("municipal_meetings")
      .select("id, state, locality, body_name, meeting_at, format, zoom_url, livestream_url, agenda_url, agenda_text, in_person_address, public_comment_signup_url, source_url")
      .eq("moderation_status", "approved")
      .gte("meeting_at", now.toISOString())
      .lte("meeting_at", horizon.toISOString())
      .order("meeting_at", { ascending: true }),
    sb.from("policy_alerts")
      .select("id, kind, severity, title, body, locality, source_url, occurs_at, expires_at")
      .eq("moderation_status", "approved")
      .not("occurs_at", "is", null)
      .gte("occurs_at", now.toISOString())
      .lte("occurs_at", horizon.toISOString())
      .in("severity", ["critical", "alert"])
      .order("occurs_at", { ascending: true }),
    sb.from("bills")
      .select("id, state, bill_number, title, last_action, last_action_at, kratom_relevance, status")
      .eq("active", true)
      .in("kratom_relevance", ["anti", "pro"])
      .not("last_action_at", "is", null)
      .gte("last_action_at", new Date(now.getTime() - 14 * 86_400_000).toISOString())
      .order("last_action_at", { ascending: false })
      .limit(80),
    sb.from("state_capital_info")
      .select("state, current_session_id, current_session_start, current_session_end, capital_city, legislature_url, hearing_schedule_url"),
    sb.from("election_dates")
      .select("id, scope, state, election_type, title, election_date, registration_deadline, source_url")
      .eq("moderation_status", "approved")
      .gte("election_date", now.toISOString().slice(0, 10))
      .lte("election_date", electionHorizon.toISOString().slice(0, 10))
      .order("election_date", { ascending: true }),
  ]);

  const events: Array<IcalEvent & { kind: string; state: string | null }> = [];

  for (const m of meetings.data ?? []) {
    const start = new Date(m.meeting_at);
    const locationBits = [
      m.in_person_address || null,
      m.zoom_url ? `Zoom: ${m.zoom_url}` : null,
      m.livestream_url ? `Livestream: ${m.livestream_url}` : null,
    ].filter(Boolean) as string[];
    const descBits = [
      m.agenda_text || null,
      m.zoom_url ? `Zoom: ${m.zoom_url}` : null,
      m.livestream_url ? `Livestream: ${m.livestream_url}` : null,
      m.public_comment_signup_url ? `Sign up to speak: ${m.public_comment_signup_url}` : null,
      m.agenda_url ? `Agenda: ${m.agenda_url}` : null,
      `Detail: ${SITE}/meetings/${m.id}`,
    ].filter(Boolean) as string[];
    events.push({
      kind: "municipal",
      state: m.state,
      uid: `municipal-${m.id}@ikratom.org`,
      start,
      // Local public meetings typically run 1-3 hours. Default to 2h.
      end: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      title: `${m.locality ?? m.state ?? ""} · ${m.body_name ?? "Public meeting"} — kratom on agenda`,
      description: descBits.join("\n\n"),
      location: locationBits[0] ?? "Virtual",
      url: `${SITE}/meetings/${m.id}`,
      categories: KIND_CATEGORIES.municipal,
    });
  }

  for (const a of alerts.data ?? []) {
    const start = new Date(a.occurs_at!);
    const end = a.expires_at ? new Date(a.expires_at) : new Date(start.getTime() + 60 * 60 * 1000);
    events.push({
      kind: "alert",
      state: /^[A-Z]{2}$/.test(a.locality ?? "") ? a.locality : null,
      uid: `alert-${a.id}@ikratom.org`,
      start,
      end,
      title: a.title,
      description: [a.body, a.source_url ? `Source: ${a.source_url}` : null, `Live feed: ${SITE}/pulse`]
        .filter(Boolean).join("\n\n"),
      location: null,
      url: `${SITE}/pulse`,
      categories: KIND_CATEGORIES.alert,
    });
  }

  for (const b of billActions.data ?? []) {
    if (!b.last_action_at) continue;
    const start = new Date(b.last_action_at);
    events.push({
      kind: "bill_action",
      state: b.state,
      uid: `bill-action-${b.id}-${start.getTime()}@ikratom.org`,
      start,
      end: new Date(start.getTime() + 30 * 60 * 1000),
      title: `${b.state} ${b.bill_number} · ${b.last_action ?? b.status ?? "action"}`,
      description: [b.title, `Track: ${SITE}/bills/${b.id}`].filter(Boolean).join("\n\n"),
      location: null,
      url: `${SITE}/bills/${b.id}`,
      categories: KIND_CATEGORIES.bill_action,
    });
  }

  for (const s of sessions.data ?? []) {
    if (s.current_session_start) {
      const start = new Date(s.current_session_start);
      if (start.getTime() > now.getTime() && start.getTime() < horizon.getTime()) {
        events.push({
          kind: "state_session",
          state: s.state,
          uid: `session-start-${s.state}-${s.current_session_id ?? "x"}@ikratom.org`,
          start,
          end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
          title: `${s.state} legislative session begins`,
          description: [`${s.capital_city ?? ""} · ${s.current_session_id ?? ""}`, s.legislature_url ?? null, `State briefing: ${SITE}/briefings/state/${s.state}`].filter(Boolean).join("\n\n"),
          location: s.capital_city ?? null,
          url: s.legislature_url ?? `${SITE}/briefings/state/${s.state}`,
          categories: KIND_CATEGORIES.state_session,
        });
      }
    }
    if (s.current_session_end) {
      const end = new Date(s.current_session_end);
      if (end.getTime() > now.getTime() && end.getTime() < horizon.getTime()) {
        events.push({
          kind: "state_session",
          state: s.state,
          uid: `session-end-${s.state}-${s.current_session_id ?? "x"}@ikratom.org`,
          start: end,
          end: new Date(end.getTime() + 24 * 60 * 60 * 1000),
          title: `${s.state} legislative session ends — last day to act`,
          description: [`${s.capital_city ?? ""} · ${s.current_session_id ?? ""}`, s.legislature_url ?? null, `State briefing: ${SITE}/briefings/state/${s.state}`].filter(Boolean).join("\n\n"),
          location: s.capital_city ?? null,
          url: s.legislature_url ?? `${SITE}/briefings/state/${s.state}`,
          categories: KIND_CATEGORIES.state_session,
        });
      }
    }
  }

  for (const el of elections.data ?? []) {
    const national = el.scope === "national";
    // noon UTC keeps the date stable across timezones; rendered all-day.
    const start = new Date(el.election_date + "T12:00:00Z");
    const descBits = [
      el.registration_deadline
        ? `Voter registration deadline: ${new Date(el.registration_deadline + "T12:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`
        : null,
      el.source_url ? `Source: ${el.source_url}` : null,
      `Calendar: ${SITE}/calendar`,
    ].filter(Boolean) as string[];
    events.push({
      kind: "election",
      state: national ? null : el.state,
      uid: `election-${el.id}@ikratom.org`,
      start,
      allDay: true,
      title: `🗳️ ${el.title}`,
      description: descBits.join("\n\n"),
      location: null,
      url: `${SITE}/calendar`,
      categories: KIND_CATEGORIES.election,
    });
  }

  // Apply filters. Elections: keep national rows (state === null) visible even
  // under a ?state= filter — they're relevant to everyone.
  let filtered = events;
  if (stateFilter) {
    filtered = filtered.filter((e) =>
      e.kind === "election" ? e.state === null || e.state === stateFilter : e.state === stateFilter,
    );
  }
  if (kindFilter) filtered = filtered.filter((e) => e.kind === kindFilter);

  // Build calendar metadata
  const filterSuffix = [
    stateFilter ? `(${stateFilter})` : null,
    kindFilter ? `(${kindFilter})` : null,
  ].filter(Boolean).join(" ");
  const calName = `iKratom — Kratom Policy Calendar${filterSuffix ? ` ${filterSuffix}` : ""}`;
  const calDesc = `Every upcoming public kratom-policy event we know about — elections + primaries, municipal meetings, BoP hearings, bill actions, legislative sessions. Refreshes every 6 hours. ${SITE}/calendar`;

  const body = buildIcalDocument({
    calendarName: calName,
    description: calDesc,
    url: `${SITE}/calendar${stateFilter || kindFilter ? `?${new URLSearchParams({ ...(stateFilter ? { state: stateFilter } : {}), ...(kindFilter ? { kind: kindFilter } : {}) })}` : ""}`,
    events: filtered,
    refreshHours: 6,
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Most clients also accept this filename hint
      "Content-Disposition": 'inline; filename="ikratom.ics"',
      // Edge cache for 10 min; client (calendar app) caches based on REFRESH-INTERVAL
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800",
    },
  });
}
