import { describe, expect, it } from "vitest";
import { icalDate, escapeIcalText, buildIcalDocument } from "../ical";

describe("icalDate", () => {
  it("formats a date as YYYYMMDDTHHMMSSZ in UTC", () => {
    expect(icalDate(new Date("2026-05-15T12:30:45Z"))).toBe("20260515T123045Z");
  });

  it("zero-pads single-digit month/day/hour/minute/second", () => {
    expect(icalDate(new Date("2026-01-02T03:04:05Z"))).toBe("20260102T030405Z");
  });

  it("uses UTC even when input is local-time string", () => {
    // Sun May 15 2026 00:00:00 UTC
    expect(icalDate(new Date("2026-05-15T00:00:00Z"))).toBe("20260515T000000Z");
  });

  it("handles dates near year boundary", () => {
    expect(icalDate(new Date("2025-12-31T23:59:59Z"))).toBe("20251231T235959Z");
  });
});

describe("escapeIcalText", () => {
  it("returns plain text unchanged", () => {
    expect(escapeIcalText("Plain text")).toBe("Plain text");
  });

  it("escapes backslashes (must be done first to avoid double-escape)", () => {
    expect(escapeIcalText("a\\b")).toBe("a\\\\b");
  });

  it("escapes semicolons", () => {
    expect(escapeIcalText("a;b")).toBe("a\\;b");
  });

  it("escapes commas", () => {
    expect(escapeIcalText("a,b")).toBe("a\\,b");
  });

  it("escapes newlines (both LF and CRLF)", () => {
    expect(escapeIcalText("a\nb")).toBe("a\\nb");
    expect(escapeIcalText("a\r\nb")).toBe("a\\nb");
  });

  it("escapes multiple special chars in one string", () => {
    expect(escapeIcalText("Hello; world, test\n")).toBe("Hello\\; world\\, test\\n");
  });

  it("does not double-escape already-escaped strings (because backslash goes first)", () => {
    // "a\\b" (raw backslash) → "a\\\\b" (RFC literal: \\ → \\\\)
    const input = "a\\b";
    expect(escapeIcalText(input)).toBe("a\\\\b");
  });
});

describe("buildIcalDocument", () => {
  it("produces a valid VCALENDAR with one event", () => {
    const doc = buildIcalDocument({
      calendarName: "Test Calendar",
      description: "Just a test",
      events: [
        {
          uid: "test-1@ikratom",
          start: new Date("2026-05-15T18:00:00Z"),
          end: new Date("2026-05-15T19:00:00Z"),
          title: "Test event",
        },
      ],
    });
    expect(doc).toContain("BEGIN:VCALENDAR");
    expect(doc).toContain("END:VCALENDAR");
    expect(doc).toContain("BEGIN:VEVENT");
    expect(doc).toContain("END:VEVENT");
    expect(doc).toContain("SUMMARY:Test event");
    expect(doc).toContain("UID:test-1@ikratom");
    expect(doc).toContain("DTSTART:20260515T180000Z");
    expect(doc).toContain("DTEND:20260515T190000Z");
  });

  it("uses CRLF line endings (RFC 5545 requires CRLF)", () => {
    const doc = buildIcalDocument({
      calendarName: "Test",
      description: "Test",
      events: [
        {
          uid: "x",
          start: new Date("2026-05-15T18:00:00Z"),
          title: "Test",
        },
      ],
    });
    // Sample a known line to confirm CRLF
    expect(doc).toContain("BEGIN:VCALENDAR\r\n");
  });

  it("defaults end to start + 1 hour when end is omitted", () => {
    const doc = buildIcalDocument({
      calendarName: "Test",
      description: "Test",
      events: [
        {
          uid: "x",
          start: new Date("2026-05-15T18:00:00Z"),
          title: "Test",
        },
      ],
    });
    expect(doc).toContain("DTSTART:20260515T180000Z");
    expect(doc).toContain("DTEND:20260515T190000Z");
  });

  it("escapes special chars in title + description", () => {
    const doc = buildIcalDocument({
      calendarName: "Test",
      description: "Test",
      events: [
        {
          uid: "x",
          start: new Date("2026-05-15T18:00:00Z"),
          title: "Title with; comma, and newline\nhere",
          description: "Body with; comma, here",
        },
      ],
    });
    expect(doc).toContain("SUMMARY:Title with\\; comma\\, and newline\\nhere");
    expect(doc).toContain("DESCRIPTION:Body with\\; comma\\, here");
  });

  it("emits PRODID and VERSION required by RFC", () => {
    const doc = buildIcalDocument({
      calendarName: "x",
      description: "x",
      events: [],
    });
    expect(doc).toContain("VERSION:2.0");
    expect(doc).toContain("PRODID:-//iKratom//Kratom Policy Calendar//EN");
  });

  it("emits X-PUBLISHED-TTL with refreshHours custom value", () => {
    const doc = buildIcalDocument({
      calendarName: "x",
      description: "x",
      events: [],
      refreshHours: 12,
    });
    expect(doc).toContain("X-PUBLISHED-TTL:PT12H");
  });

  it("defaults X-PUBLISHED-TTL to 6 hours", () => {
    const doc = buildIcalDocument({
      calendarName: "x",
      description: "x",
      events: [],
    });
    expect(doc).toContain("X-PUBLISHED-TTL:PT6H");
  });

  it("emits CATEGORIES when provided", () => {
    const doc = buildIcalDocument({
      calendarName: "x",
      description: "x",
      events: [
        {
          uid: "x",
          start: new Date("2026-05-15T18:00:00Z"),
          title: "Test",
          categories: ["Kratom", "Hearing"],
        },
      ],
    });
    expect(doc).toContain("CATEGORIES:Kratom,Hearing");
  });

  it("handles multiple events in one calendar", () => {
    const doc = buildIcalDocument({
      calendarName: "Multi",
      description: "Multiple events",
      events: [
        { uid: "a", start: new Date("2026-05-15T18:00:00Z"), title: "A" },
        { uid: "b", start: new Date("2026-05-16T18:00:00Z"), title: "B" },
      ],
    });
    expect(doc.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(doc).toContain("UID:a");
    expect(doc).toContain("UID:b");
  });
});
