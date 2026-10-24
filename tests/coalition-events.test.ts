import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  eventDateChip, formatEventWhen, googleCalendarUrl, groupEventIcs, safeTimeZone, type GroupEvent,
} from "@/modules/coalitions/events";
import { sendGroupEventReminders } from "@/modules/coalitions/event-reminders";

/**
 * Group events + call-in days (migration 0283, owner pick B15a 2026-10-24).
 * Pins the privacy edges (members-only events, own-row RSVPs, counts only),
 * the formatting every surface shares, and the reminder cron's once-only claim.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/0283_coalition_events.sql");
const actions = read("src/modules/coalitions/event-actions.ts");
const ics = read("src/app/coalitions/[slug]/events/[eventId]/event.ics/route.ts");
const cron = read("src/app/api/cron/fire-waves/route.ts");

const ev: GroupEvent = {
  id: "11111111-1111-1111-1111-111111111111",
  coalition_id: "22222222-2222-2222-2222-222222222222",
  kind: "call_in",
  title: "Call-in day, HB 4512",
  details: "Call the committee; script in the action.",
  starts_at: "2026-11-04T23:00:00.000Z", // 6:00 PM EST
  ends_at: "2026-11-05T00:00:00.000Z",
  timezone: "America/Detroit",
  location: "From home",
  link_url: "https://example.org/zoom",
  campaign_id: null,
  cancelled_at: null,
};

describe("database rules", () => {
  it("both tables have RLS, explicit grants, and nothing for anon", () => {
    expect(sql).toMatch(/alter table public\.coalition_events enable row level security/);
    expect(sql).toMatch(/alter table public\.coalition_event_rsvps enable row level security/);
    expect(sql).toMatch(/grant select, insert, update on public\.coalition_events to authenticated/);
    expect(sql).toMatch(/revoke all on public\.coalition_events from anon/);
    expect(sql).toMatch(/revoke all on public\.coalition_event_rsvps from anon/);
    expect(sql).not.toMatch(/grant [^;]* to anon/);
  });

  it("only members read events; only organizers post them, as themselves", () => {
    expect(sql).toMatch(/"coalition_events: members read"[\s\S]*?using \(public\.is_coalition_member\(coalition_id\)/);
    expect(sql).toMatch(/with check \(created_by = auth\.uid\(\) and public\.is_coalition_admin\(coalition_id\)\)/);
    expect(sql).not.toMatch(/on public\.coalition_events\s+for delete/);
  });

  it("an RSVP is visible to its owner only and needs a live event in the member's group", () => {
    expect(sql).toMatch(/"coalition_event_rsvps: own read"[\s\S]*?using \(user_id = auth\.uid\(\)\)/);
    expect(sql).toMatch(/e\.cancelled_at is null and public\.is_coalition_member\(e\.coalition_id\)/);
  });

  it("counts are members-only and never return who", () => {
    expect(sql).toMatch(/returns table \(event_id uuid, going integer, maybe integer\)/);
    expect(sql).toMatch(/revoke execute on function public\.coalition_event_counts\(uuid\) from public, anon/);
  });
});

describe("server actions", () => {
  it("rate-limit every write and check the organizer role before posting", () => {
    expect(actions).toMatch(/checkRateLimit\(`coalition:event:/);
    expect(actions).toMatch(/checkRateLimit\(`coalition:rsvp:/);
    const create = actions.slice(actions.indexOf("export async function createGroupEvent"));
    expect(create.indexOf("ctx.isOrganizer")).toBeLessThan(create.indexOf('from("coalition_events").insert'));
  });

  it("only allows https links and keeps notices to title + time", () => {
    expect(actions).toMatch(/\^https:\\\/\\\/\\S\+\$/);
    expect(actions).not.toMatch(/full_name|email/);
  });
});

describe("formatting", () => {
  it("shows the organizer's local time, the same for every viewer", () => {
    expect(formatEventWhen(ev.starts_at, ev.timezone)).toBe("Wed, Nov 4 · 6:00 PM EST");
    expect(eventDateChip(ev.starts_at, ev.timezone)).toEqual({ month: "NOV", day: "4" });
  });

  it("falls back to Eastern for a missing or bogus zone", () => {
    expect(safeTimeZone("Not/AZone")).toBe("America/New_York");
    expect(safeTimeZone(null)).toBe("America/New_York");
    expect(safeTimeZone("America/Chicago")).toBe("America/Chicago");
  });

  it("builds a Google Calendar link with UTC stamps", () => {
    const url = new URL(googleCalendarUrl(ev, "rein-in-chaos-coalition"));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("dates")).toBe("20261104T230000Z/20261105T000000Z");
    expect(url.searchParams.get("ctz")).toBe("America/Detroit");
  });

  it("builds a valid one-event .ics", () => {
    const doc = groupEventIcs(ev, { slug: "rein-in-chaos-coalition", name: "Rein In Chaos" });
    expect(doc).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(doc).toContain(`UID:coalition-event-${ev.id}@ikratom.org`);
    expect(doc).toContain("DTSTART:20261104T230000Z");
    expect(doc).toContain("SUMMARY:Call-in day\\, HB 4512");
  });

  it("the .ics route is private (members only, never cached)", () => {
    expect(ics).toMatch(/"Cache-Control": "private, no-store"/);
    expect(ics).toMatch(/createClient\(\)/);
    expect(ics).not.toMatch(/service-role/);
  });
});

// Minimal chainable fake: resolves each query by table + operation.
function fakeSupabase(state: {
  events: Array<Record<string, unknown>>;
  rsvps: Array<{ event_id: string; user_id: string; status: string }>;
  notifications: Array<Record<string, unknown>>;
}) {
  return {
    from(table: string) {
      let op = "select";
      let patch: Record<string, unknown> = {};
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      const rows = () => (table === "coalition_events" ? state.events : table === "coalition_event_rsvps" ? state.rsvps : []) as Array<Record<string, unknown>>;
      const run = () => {
        const hit = rows().filter((r) => filters.every((f) => f(r)));
        if (op === "update") { for (const r of hit) Object.assign(r, patch); }
        return { data: hit.map((r) => ({ ...r, coalitions: { slug: "g", name: "Group" } })), error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        update: (p: Record<string, unknown>) => { op = "update"; patch = p; return q; },
        insert: (rs: Array<Record<string, unknown>>) => { state.notifications.push(...rs); return Promise.resolve({ error: null }); },
        is: (k: string, v: null) => { filters.push((r) => (r[k] ?? null) === v); return q; },
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
        in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return q; },
        gt: (k: string, v: string) => { filters.push((r) => String(r[k]) > v); return q; },
        lte: (k: string, v: string) => { filters.push((r) => String(r[k]) <= v); return q; },
        order: () => q,
        limit: () => q,
        then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

describe("reminders", () => {
  const now = new Date("2026-11-04T10:00:00.000Z");
  const base = { cancelled_at: null, reminder_day_sent_at: null, reminder_soon_sent_at: null, timezone: "America/Detroit" };

  it("sends the day-before reminder once, only to going/maybe, then the starting-soon one", async () => {
    const state = {
      events: [{ ...base, id: "e1", title: "Call-in day", starts_at: "2026-11-04T23:00:00.000Z" }],
      rsvps: [
        { event_id: "e1", user_id: "u1", status: "going" },
        { event_id: "e1", user_id: "u2", status: "maybe" },
        { event_id: "e1", user_id: "u3", status: "no" },
      ],
      notifications: [] as Array<Record<string, unknown>>,
    };
    const sb = fakeSupabase(state);

    expect(await sendGroupEventReminders(sb, now)).toEqual({ events: 1, notified: 2 });
    expect(state.notifications.map((n) => n.user_id).sort()).toEqual(["u1", "u2"]);
    expect(state.notifications[0].title).toBe("Reminder: Call-in day");

    // A second run in the same window sends nothing.
    expect(await sendGroupEventReminders(sb, now)).toEqual({ events: 0, notified: 0 });

    // Within two hours of the start: the "starting soon" reminder.
    expect(await sendGroupEventReminders(sb, new Date("2026-11-04T21:30:00.000Z"))).toEqual({ events: 1, notified: 2 });
    expect(state.notifications.at(-1)?.title).toBe("Starting soon: Call-in day");
    expect(await sendGroupEventReminders(sb, new Date("2026-11-04T22:00:00.000Z"))).toEqual({ events: 0, notified: 0 });
  });

  it("skips cancelled events", async () => {
    const state = {
      events: [{ ...base, id: "e2", title: "Off", starts_at: "2026-11-04T12:00:00.000Z", cancelled_at: "2026-11-03T00:00:00.000Z" }],
      rsvps: [{ event_id: "e2", user_id: "u1", status: "going" }],
      notifications: [] as Array<Record<string, unknown>>,
    };
    expect(await sendGroupEventReminders(fakeSupabase(state), now)).toEqual({ events: 0, notified: 0 });
  });

  it("runs inside the hourly cron before the push fan-out, and can't break it", () => {
    expect(cron.indexOf("sendGroupEventReminders(supabase)")).toBeGreaterThan(-1);
    expect(cron.indexOf("sendGroupEventReminders(supabase)")).toBeLessThan(cron.indexOf("fanoutPushNotifications(supabase)"));
    expect(cron).toMatch(/sendGroupEventReminders\(supabase\)\.catch\(/);
  });
});
