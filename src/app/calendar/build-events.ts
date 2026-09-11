import { EVENT_TYPE_LABELS } from "@/modules/events/labels";
import type { CalendarEvent, CalendarSnapshot } from "./types";

/**
 * Fold the nine public calendar sources into one flat event list.
 *
 * Pure + viewer-parameterised on purpose: `viewerState` only geofences the
 * ELECTION rows (national-scope elections show to everyone; state elections
 * only when they match). Everything else is identical for every viewer, which
 * is what lets the snapshot live in a cached static page while this runs
 * client-side per reader.
 *
 * `nowMs` is passed rather than read from the clock so the caller controls it:
 * the prerender and the first client render must agree, or React reports a
 * hydration mismatch (see CalendarView).
 */
export function buildEvents(
  snap: CalendarSnapshot,
  viewerState: string | null,
  nowMs: number,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const horizonMs = nowMs + 90 * 86_400_000; // next 90 days

  for (const m of snap.meetings) {
    events.push({
      kind: "municipal",
      date: new Date(m.meeting_at),
      title: `${m.locality ?? "(locality)"} · ${m.body_name ?? "Public meeting"}`,
      body: m.agenda_text,
      state: m.state,
      locality: m.locality,
      zoom_url: m.zoom_url,
      livestream_url: m.livestream_url,
      agenda_url: m.agenda_url,
      public_comment_url: m.public_comment_signup_url,
      in_person_address: m.in_person_address,
      source_url: m.source_url,
      detail_href: `/meetings/${m.id}`,
    });
  }

  for (const a of snap.alerts) {
    if (!a.occurs_at) continue;
    events.push({
      kind: "alert",
      date: new Date(a.occurs_at),
      title: a.title,
      body: a.body?.split("\n")[0] ?? null,
      state: /^[A-Z]{2}$/.test(a.locality ?? "") ? a.locality : null,
      locality: a.locality,
      source_url: a.source_url,
      detail_href: `/alerts/${a.id}`, // the specific alert, not generic /pulse
      bill_href: a.bill_id ? `/bills/${a.bill_id}` : null, // cross-link to the bill the alert is about
      severity: a.severity,
    });
  }

  // Recent bill actions surface for advocates who want to track current legislative motion
  for (const b of snap.billActions) {
    if (!b.last_action_at) continue;
    events.push({
      kind: "bill_action",
      date: new Date(b.last_action_at),
      title: `${b.state} ${b.bill_number} · ${b.last_action ?? b.status ?? "action"}`,
      body: b.title ? b.title.slice(0, 200) : null,
      state: b.state,
      detail_href: `/bills/${b.id}`,
    });
  }

  // State sessions — show start and end dates if upcoming
  for (const s of snap.sessions) {
    if (s.current_session_start) {
      const start = new Date(s.current_session_start);
      if (start.getTime() > nowMs && start.getTime() < horizonMs) {
        events.push({
          kind: "state_session",
          date: start,
          title: `${s.state} legislative session begins`,
          body: `${s.capital_city ?? "?"} · ${s.current_session_id ?? "?"}`,
          state: s.state,
          source_url: s.legislature_url,
          detail_href: `/states/${s.state}`,
        });
      }
    }
    if (s.current_session_end) {
      const end = new Date(s.current_session_end);
      if (end.getTime() > nowMs && end.getTime() < horizonMs) {
        events.push({
          kind: "state_session",
          date: end,
          title: `${s.state} legislative session ends — last day to act`,
          body: `${s.capital_city ?? "?"} · ${s.current_session_id ?? "?"}`,
          state: s.state,
          source_url: s.legislature_url,
          detail_href: `/states/${s.state}`,
        });
      }
    }
  }

  // Legislator town halls + hearings (hand-verified). Folded in from the old
  // /events page, which now redirects here — this is the one community calendar.
  for (const t of snap.townhalls) {
    const typeLabel = EVENT_TYPE_LABELS[t.event_type] ?? t.event_type;
    events.push({
      kind: "townhall",
      date: new Date(t.starts_at),
      title: t.title,
      body: [typeLabel, t.description?.split("\n")[0]].filter(Boolean).join(" · "),
      state: t.state,
      locality: t.locality,
      in_person_address: t.venue,
      source_url: t.source_url,
      detail_href: t.legislator_id ? `/legislators/${t.legislator_id}` : null,
    });
  }

  // Elections — geofenced. national-scope rows show to everyone; state rows
  // only when they match the viewer's state. Rendered as all-day events.
  for (const el of snap.elections) {
    const national = el.scope === "national";
    if (!national && (!viewerState || el.state !== viewerState)) continue;
    // Parse the DATE at noon UTC so it lands on the same calendar day in every
    // US timezone (midnight UTC would shift the date west of the Atlantic).
    const regNote = el.registration_deadline
      ? `Register to vote by ${new Date(el.registration_deadline + "T12:00:00Z").toLocaleDateString(undefined, { month: "long", day: "numeric" })}.`
      : null;
    events.push({
      kind: "election",
      date: new Date(el.election_date + "T12:00:00Z"),
      allDay: true,
      scope: el.scope,
      title: el.title,
      body: regNote,
      state: national ? null : el.state,
      source_url: el.source_url,
    });
  }

  // "Takes effect" dates for tracked bills — when a passed/signed law actually
  // hits. All-day, links to the bill. Answers "when does this affect me?".
  for (const b of snap.billsEffective) {
    if (!b.effective_date) continue;
    events.push({
      kind: "bill_effective",
      date: new Date(b.effective_date + "T12:00:00Z"),
      allDay: true,
      title: `${b.state} ${b.bill_number} takes effect`,
      body: b.title ? b.title.slice(0, 200) : null,
      state: b.state,
      detail_href: `/bills/${b.id}`,
    });
  }

  // Sunset/expiration dates — when a law auto-repeals. All-day, links to bill.
  for (const b of snap.billsSunset) {
    if (!b.sunset_date) continue;
    events.push({
      kind: "bill_sunset",
      date: new Date(b.sunset_date + "T12:00:00Z"),
      allDay: true,
      title: `${b.state} ${b.bill_number} expires`,
      body: b.title ? b.title.slice(0, 200) : null,
      state: b.state,
      detail_href: `/bills/${b.id}`,
    });
  }

  // Local vote outcomes — past city/county kratom votes with a pass/fail badge.
  for (const v of snap.localVotes) {
    events.push({
      kind: "local_vote",
      date: new Date(v.vote_date + "T12:00:00Z"),
      allDay: true,
      title: `${v.locality}${v.state ? ", " + v.state : ""} — local vote ${v.outcome}`,
      body: v.measure,
      state: v.state,
      locality: v.locality,
      source_url: v.source_url,
      detail_href: v.policy_alert_id ? `/alerts/${v.policy_alert_id}` : null,
    });
  }

  return events;
}
