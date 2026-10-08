import { describe, it, expect } from "vitest";
import {
  kratomItems, parseEventTime, eventMeetingAt, buildMeetingRow, mergeTenants, scanIsBroken, CONF_STRONG, CONF_WEAK,
} from "../scripts/lib/legistar-events.mjs";
import { AUTOPUBLISH_FLOOR } from "../scripts/lib/meeting-discover.mjs";
import { VERIFIED_VIA } from "../scripts/lib/meeting-autoapprove.mjs";

/**
 * scan-legistar-tenants.mjs reads the Legistar webapi instead of scraping
 * Calendar.aspx (which renders client-side, so the old scan read nothing for
 * months). These pin the parts that decide what gets published.
 */
const item = (title: string, extra: Record<string, unknown> = {}) => ({ EventItemTitle: title, ...extra });

describe("kratomItems", () => {
  it("finds kratom in the title, the matter name, or the HTML agenda note", () => {
    const hits = kratomItems([
      item("Call To Order"),
      item("Ordinance amending Chapter 9 to prohibit the sale of kratom products"),
      item("Consent agenda", { EventItemMatterName: "Tianeptine and mitragynine retail restrictions" }),
      item("Public hearing", { EventItemAgendaNote: "<p>Regarding <b>Kratom</b> licensing</p>" }),
    ]);
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.strong)).toBe(true);
  });

  it("marks a bare '7-OH' match as weak", () => {
    const [h] = kratomItems([item("Item 7 OH Street resurfacing contract")]);
    expect(h.strong).toBe(false);
  });

  it("ignores procedural items", () => {
    expect(kratomItems([item("Approval of the Agenda"), item("Adjournment")])).toEqual([]);
  });
});

describe("meeting time", () => {
  it("parses Legistar's time text", () => {
    expect(parseEventTime("9:30 AM")).toEqual({ hh: 9, mm: 30 });
    expect(parseEventTime("12:00 PM")).toEqual({ hh: 12, mm: 0 });
    expect(parseEventTime("12:15 AM")).toEqual({ hh: 0, mm: 15 });
    expect(parseEventTime("6:00 p.m.")).toEqual({ hh: 18, mm: 0 });
    expect(parseEventTime("")).toBeNull();
    expect(parseEventTime("TBD")).toBeNull();
  });

  it("reads the wall clock in the tenant state's zone, DST-aware", () => {
    expect(eventMeetingAt({ EventDate: "2026-10-08T00:00:00", EventTime: "9:30 AM" }, "WA")?.iso).toBe("2026-10-08T16:30:00.000Z");
    expect(eventMeetingAt({ EventDate: "2026-12-08T00:00:00", EventTime: "9:30 AM" }, "WA")?.iso).toBe("2026-12-08T17:30:00.000Z");
    expect(eventMeetingAt({ EventDate: "2026-10-14T00:00:00", EventTime: "6:00 PM" }, "PA")?.iso).toBe("2026-10-14T22:00:00.000Z");
  });

  it("falls back to local noon (date stays right) when no time is published", () => {
    const w = eventMeetingAt({ EventDate: "2026-10-14T00:00:00", EventTime: null }, "CA");
    expect(w?.timeKnown).toBe(false);
    expect(w?.iso.slice(0, 10)).toBe("2026-10-14");
  });
});

describe("buildMeetingRow", () => {
  const tenant = { client: "seattle", state: "WA", locality: "Seattle, WA", body: null };
  const event = {
    EventId: 6906, EventBodyName: "Public Safety Committee", EventDate: "2026-10-20T00:00:00", EventTime: "2:00 PM",
    EventLocation: "Council Chamber, City Hall", EventAgendaFile: "https://seattle.legistar.com/View.ashx?M=A&ID=1",
    EventInSiteURL: "https://seattle.legistar.com/MeetingDetail.aspx?LEGID=6906",
  };

  it("files strong hits as an auto-publishable, allowlisted, official-source row", () => {
    const row = buildMeetingRow(tenant, event, [{ title: "Kratom retail ordinance", strong: true }])!;
    expect(row.discovered_via).toBe("legistar_scan");
    expect(Object.keys(VERIFIED_VIA)).toContain(row.discovered_via);
    expect(row.ai_confidence).toBe(CONF_STRONG);
    expect(row.ai_confidence).toBeGreaterThanOrEqual(AUTOPUBLISH_FLOOR);
    expect(row.source_url).toMatch(/legistar\.com/);
    expect(row.moderation_status).toBe("pending_review");
    expect(row.body_name).toBe("Public Safety Committee");
    expect(row.meeting_at).toBe("2026-10-20T21:00:00.000Z");
  });

  it("holds a 7-OH-only match below the publish floor", () => {
    const row = buildMeetingRow(tenant, event, [{ title: "Item 7 OH", strong: false }])!;
    expect(row.ai_confidence).toBe(CONF_WEAK);
    expect(row.ai_confidence).toBeLessThan(AUTOPUBLISH_FLOOR);
  });

  it("files nothing without hits or without a date", () => {
    expect(buildMeetingRow(tenant, event, [])).toBeNull();
    expect(buildMeetingRow(tenant, { ...event, EventDate: null }, [{ title: "kratom", strong: true }])).toBeNull();
  });
});

describe("scanIsBroken — a quiet week must not look like a dead scan", () => {
  it("quiet: tenants answered and agendas parsed, nothing matched", () => {
    expect(scanIsBroken({ answered: 28, events: 100, agendaOk: 100 })).toBe(false);
    expect(scanIsBroken({ answered: 3, events: 0, agendaOk: 0 })).toBe(false); // nothing scheduled yet
  });
  it("broken: nobody answered (auth wall, outage, endpoint gone)", () => {
    expect(scanIsBroken({ answered: 0, events: 0, agendaOk: 0 })).toBe(true);
  });
  it("broken: meetings listed but not one agenda parsed (eventitems shape change)", () => {
    expect(scanIsBroken({ answered: 28, events: 100, agendaOk: 0 })).toBe(true);
  });
});

describe("mergeTenants", () => {
  const clientFor = (t: { subdomain: string }) => ({ "council.nyc.gov": "nyc" } as Record<string, string>)[t.subdomain] ?? t.subdomain;
  it("prefers probed DB rows and adds static tenants it doesn't already cover", () => {
    const merged = mergeTenants(
      [{ webapi_client: "seattle", state: "WA", locality: "Seattle, WA" }, { webapi_client: null, state: "MS", locality: "Tupelo, MS" }],
      [
        { subdomain: "seattle", state: "WA", locality: "Seattle, WA" },
        { subdomain: "council.nyc.gov", state: "NY", locality: "New York, NY" },
        { subdomain: "cook-county", state: "IL", locality: "Seattle, WA" }, // locality already covered
      ],
      clientFor,
    );
    expect(merged.map((t) => t.client).sort()).toEqual(["nyc", "seattle"]);
  });
});
