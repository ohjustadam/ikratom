import { buildIcalDocument } from "@/lib/ical";

/**
 * Group events (migration 0283): the shared shape, labels, and the pure
 * helpers for showing a time and adding an event to a calendar. No I/O here,
 * so the page, the .ics route and the reminder cron all format the same way.
 */

export const EVENT_KINDS = ["call_in", "meeting", "hearing", "rally", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  call_in: "📞 Call-in day",
  meeting: "👥 Meeting",
  hearing: "🏛 Hearing watch",
  rally: "📣 In person",
  other: "📅 Event",
};

export type GroupEvent = {
  id: string;
  coalition_id: string;
  kind: EventKind;
  title: string;
  details: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  location: string | null;
  link_url: string | null;
  campaign_id: string | null;
  cancelled_at: string | null;
};

export const EVENT_COLUMNS =
  "id, coalition_id, kind, title, details, starts_at, ends_at, timezone, location, link_url, campaign_id, cancelled_at";

const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";
const DEFAULT_MINUTES = 60;

/** A zone the runtime knows, or the platform default (civic dates anchor to Eastern). */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz || tz.length > 64) return "America/New_York";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "America/New_York";
  }
}

/** "Tue, Nov 4 · 6:00 PM EST", in the organizer's zone so it reads the same for everyone. */
export function formatEventWhen(startsAt: string, timezone: string): string {
  const d = new Date(startsAt);
  const tz = safeTimeZone(timezone);
  const day = d.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return `${day} · ${time}`;
}

/** Day-of-month + short month for the date chip on an event card. */
export function eventDateChip(startsAt: string, timezone: string): { month: string; day: string } {
  const d = new Date(startsAt);
  const tz = safeTimeZone(timezone);
  return {
    month: d.toLocaleDateString("en-US", { timeZone: tz, month: "short" }).toUpperCase(),
    day: d.toLocaleDateString("en-US", { timeZone: tz, day: "numeric" }),
  };
}

export function eventEnd(ev: Pick<GroupEvent, "starts_at" | "ends_at">): Date {
  return ev.ends_at ? new Date(ev.ends_at) : new Date(new Date(ev.starts_at).getTime() + DEFAULT_MINUTES * 60_000);
}

export function eventPath(slug: string, eventId: string): string {
  return `/coalitions/${slug}/events/${eventId}`;
}

function gcalStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** One tap into Google Calendar (Android has no .ics handler by default). */
export function googleCalendarUrl(ev: GroupEvent, slug: string): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${gcalStamp(new Date(ev.starts_at))}/${gcalStamp(eventEnd(ev))}`,
    details: [ev.details, ev.link_url, `${SITE}${eventPath(slug, ev.id)}`].filter(Boolean).join("\n\n"),
    ctz: safeTimeZone(ev.timezone),
  });
  if (ev.location) params.set("location", ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** A one-event .ics for "Add to calendar" (Apple, Outlook, any desktop client). */
export function groupEventIcs(ev: GroupEvent, group: { slug: string; name: string }): string {
  const url = `${SITE}${eventPath(group.slug, ev.id)}`;
  return buildIcalDocument({
    calendarName: `${group.name}: ${ev.title}`,
    description: `${group.name} event on iKratom`,
    url,
    refreshHours: 6,
    events: [{
      uid: `coalition-event-${ev.id}@ikratom.org`,
      start: new Date(ev.starts_at),
      end: eventEnd(ev),
      title: ev.title,
      description: [ev.details, ev.link_url ? `Join: ${ev.link_url}` : null, `Details: ${url}`].filter(Boolean).join("\n\n"),
      location: ev.location ?? (ev.link_url ? "Online" : null),
      url,
      categories: ["Kratom", EVENT_KIND_LABEL[ev.kind].replace(/^\S+\s/, "")],
    }],
  });
}
