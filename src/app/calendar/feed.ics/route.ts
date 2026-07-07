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
  townhall: ["Kratom", "Town hall"],
  bill_effective: ["Kratom", "Bill takes effect"],
  bill_sunset: ["Kratom", "Bill expires"],
  local_vote: ["Kratom", "Local vote"],
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
  // Eastern calendar day for date-only columns (NOT UTC) — else today's
  // election / effective / sunset row drops out of the feed after ~8pm ET when
  // the UTC date rolls (memory civic-dates-anchor-eastern; mirrors calendar/page.tsx).
  const etYmd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  // Same data shape as /calendar/page.tsx, just translated to iCal events.
  const [meetings, alerts, billActions, sessions, elections, townhalls, billsEffective, billsSunset, localVotes] = await Promise.all([
    sb.from("municipal_meetings")
      .select("id, state, locality, body_name, meeting_at, format, zoom_url, livestream_url, agenda_url, agenda_text, in_person_address, public_comment_signup_url, source_url")
      .eq("moderation_status", "approved")
      .gte("meeting_at", now.toISOString())
      .lte("meeting_at", horizon.toISOString())
      .order("meeting_at", { ascending: true }),
    sb.from("policy_alerts")
      .select("id, kind, severity, title, body, locality, source_url, occurs_at, expires_at, bill_id")
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
      .gte("election_date", etYmd(now))
      .lte("election_date", etYmd(electionHorizon))
      .order("election_date", { ascending: true }),
    sb.from("legislator_events")
      .select("id, state, locality, title, description, event_type, starts_at, venue, source_url, legislator_id")
      .eq("active", true)
      .gte("starts_at", now.toISOString())
      .lte("starts_at", horizon.toISOString())
      .order("starts_at", { ascending: true }),
    sb.from("bills")
      .select("id, state, bill_number, title, effective_date, kratom_relevance")
      .in("kratom_relevance", ["anti", "pro"])
      .not("effective_date", "is", null)
      .gte("effective_date", etYmd(now))
      .lte("effective_date", etYmd(electionHorizon))
      .order("effective_date", { ascending: true }),
    sb.from("bills")
      .select("id, state, bill_number, title, sunset_date, kratom_relevance")
      .in("kratom_relevance", ["anti", "pro"])
      .not("sunset_date", "is", null)
      .gte("sunset_date", etYmd(now))
      .lte("sunset_date", etYmd(electionHorizon))
      .order("sunset_date", { ascending: true }),
    sb.from("local_vote_outcomes")
      .select("id, state, locality, vote_date, outcome, measure, source_url")
      .gte("vote_date", new Date(now.getTime() - 180 * 86_400_000).toISOString().slice(0, 10))
      .order("vote_date", { ascending: false })
      .limit(200),
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
      description: [a.body, a.source_url ? `Source: ${a.source_url}` : null,
        a.bill_id ? `Bill: ${SITE}/bills/${a.bill_id}` : null, `Open alert: ${SITE}/alerts/${a.id}`]
        .filter(Boolean).join("\n\n"),
      location: null,
      url: `${SITE}/alerts/${a.id}`,
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
          url: `${SITE}/states/${s.state}`,
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
          url: `${SITE}/states/${s.state}`,
          categories: KIND_CATEGORIES.state_session,
        });
      }
    }
  }

  for (const t of townhalls.data ?? []) {
    const start = new Date(t.starts_at);
    events.push({
      kind: "townhall",
      state: t.state,
      uid: `townhall-${t.id}@ikratom.org`,
      start,
      end: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      title: t.title,
      description: [t.description, t.source_url ? `Details: ${t.source_url}` : null,
        t.legislator_id ? `Legislator: ${SITE}/legislators/${t.legislator_id}` : null, `Calendar: ${SITE}/calendar`].filter(Boolean).join("\n\n"),
      location: t.venue ?? null,
      url: t.legislator_id ? `${SITE}/legislators/${t.legislator_id}` : (t.source_url ?? `${SITE}/calendar`),
      categories: KIND_CATEGORIES.townhall,
    });
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

  for (const b of billsEffective.data ?? []) {
    if (!b.effective_date) continue;
    events.push({
      kind: "bill_effective",
      state: b.state,
      uid: `bill-effective-${b.id}@ikratom.org`,
      start: new Date(b.effective_date + "T12:00:00Z"),
      allDay: true,
      title: `⚖️ ${b.state} ${b.bill_number} takes effect`,
      description: [b.title, `Track: ${SITE}/bills/${b.id}`].filter(Boolean).join("\n\n"),
      location: null,
      url: `${SITE}/bills/${b.id}`,
      categories: KIND_CATEGORIES.bill_effective,
    });
  }

  for (const b of billsSunset.data ?? []) {
    if (!b.sunset_date) continue;
    events.push({
      kind: "bill_sunset",
      state: b.state,
      uid: `bill-sunset-${b.id}@ikratom.org`,
      start: new Date(b.sunset_date + "T12:00:00Z"),
      allDay: true,
      title: `⏳ ${b.state} ${b.bill_number} expires`,
      description: [b.title, `Track: ${SITE}/bills/${b.id}`].filter(Boolean).join("\n\n"),
      location: null,
      url: `${SITE}/bills/${b.id}`,
      categories: KIND_CATEGORIES.bill_sunset,
    });
  }

  for (const v of localVotes.data ?? []) {
    events.push({
      kind: "local_vote",
      state: v.state,
      uid: `local-vote-${v.id}@ikratom.org`,
      start: new Date(v.vote_date + "T12:00:00Z"),
      allDay: true,
      title: `🗳️ ${v.locality}${v.state ? ", " + v.state : ""} — local vote ${v.outcome}`,
      description: [v.measure, v.source_url].filter(Boolean).join("\n\n"),
      location: v.locality ?? null,
      url: v.source_url || `${SITE}/calendar`,
      categories: KIND_CATEGORIES.local_vote,
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
  const calDesc = `Every upcoming public kratom-policy event we know about — elections + primaries, town halls + hearings, municipal meetings, bill actions, legislative sessions. Refreshes every 6 hours. ${SITE}/calendar`;

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
