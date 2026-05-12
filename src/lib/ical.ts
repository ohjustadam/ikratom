/**
 * RFC 5545 iCalendar helpers — produce a `.ics` feed users can subscribe
 * to in Apple Calendar, Google Calendar, Outlook, Fantastical, etc.
 *
 * Why not a library: this is ~60 lines of pure string work, and
 * `node_modules` already weighs enough. The formatting rules below
 * are the entire spec we need:
 *   - line endings MUST be CRLF
 *   - lines >75 octets MUST be folded (CRLF + leading space)
 *   - TEXT values escape: backslash, semicolon, comma, newline
 *   - DTSTAMP/DTSTART in UTC: YYYYMMDDTHHMMSSZ
 *
 * Used by /calendar/feed.ics. Subscribe URLs include filter query
 * params so users can subscribe to e.g. "NY events only" or
 * "Municipal meetings only".
 */

export type IcalEvent = {
  /** Required: stable unique id (we use event-kind + db id). Appears as UID. */
  uid: string;
  /** Required: event start in UTC. */
  start: Date;
  /** Optional: event end in UTC. Defaults to start + 1 hour. */
  end?: Date | null;
  /** Required: short single-line title. */
  title: string;
  /** Optional: longer body. Newlines are escaped per RFC. */
  description?: string | null;
  /** Optional: physical address or "Virtual — see description". */
  location?: string | null;
  /** Optional: canonical detail URL on iKratom. */
  url?: string | null;
  /** Optional: comma-or-array categories. */
  categories?: string[];
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Format a Date as iCalendar UTC datetime: YYYYMMDDTHHMMSSZ. */
export function icalDate(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    "Z"
  );
}

/** Escape an iCalendar TEXT value per RFC 5545 §3.3.11. */
export function escapeIcalText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold a content line per RFC 5545 §3.1 (line breaks every 75 octets
 * with a leading space on the continuation). Most calendar clients
 * tolerate unfolded long lines, but Outlook is strict — fold to be safe.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (i === 0) {
      chunks.push(line.slice(0, 75));
      i = 75;
    } else {
      chunks.push(" " + line.slice(i, i + 74));
      i += 74;
    }
  }
  return chunks.join("\r\n");
}

function line(name: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return foldLine(`${name}:${value}`);
}

/**
 * Build a complete `.ics` document body from a list of events.
 */
export function buildIcalDocument(opts: {
  calendarName: string;
  description: string;
  url?: string;
  events: IcalEvent[];
  /** Suggested refresh interval. iOS/macOS honor X-PUBLISHED-TTL. */
  refreshHours?: number;
}): string {
  const refresh = opts.refreshHours ?? 6;
  const refreshDur = `PT${refresh}H`;
  const now = new Date();
  const dtstamp = icalDate(now);

  const head = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//iKratom//Kratom Policy Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    line("NAME", escapeIcalText(opts.calendarName)),
    line("X-WR-CALNAME", escapeIcalText(opts.calendarName)),
    line("DESCRIPTION", escapeIcalText(opts.description)),
    line("X-WR-CALDESC", escapeIcalText(opts.description)),
    line("URL", opts.url),
    line("SOURCE;VALUE=URI", opts.url),
    `REFRESH-INTERVAL;VALUE=DURATION:${refreshDur}`,
    `X-PUBLISHED-TTL:${refreshDur}`,
  ].filter(Boolean) as string[];

  const body: string[] = [];
  for (const e of opts.events) {
    const start = icalDate(e.start);
    const end = icalDate(e.end ?? new Date(e.start.getTime() + 60 * 60 * 1000));
    const eventLines = [
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      line("SUMMARY", escapeIcalText(e.title)),
      line("DESCRIPTION", e.description ? escapeIcalText(e.description) : null),
      line("LOCATION", e.location ? escapeIcalText(e.location) : null),
      line("URL", e.url),
      e.categories && e.categories.length
        ? line("CATEGORIES", e.categories.map(escapeIcalText).join(","))
        : null,
      "END:VEVENT",
    ].filter(Boolean) as string[];
    body.push(...eventLines);
  }

  const tail = ["END:VCALENDAR"];
  return [...head, ...body, ...tail].join("\r\n") + "\r\n";
}
