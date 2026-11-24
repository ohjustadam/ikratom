/**
 * digest-cadence.test.ts — quiet members get the email digest weekly (PJ,
 * 2026-11-24). A hand-picked Daily is the exception, a new member is never
 * quiet, and a member who comes back is daily again with no setting change.
 */
import { describe, it, expect } from "vitest";
import { isQuiet, digestCadence, weeklySince, QUIET_DAYS, CADENCE_LINKS_LIVE } from "../scripts/lib/digest-cadence.mjs";
import { cadenceNote, renderDigest } from "../scripts/lib/email-render.mjs";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 864e5).toISOString();

describe("isQuiet", () => {
  it("quiet only past QUIET_DAYS without a visit or sign-in", () => {
    expect(isQuiet({ lastSeenAt: daysAgo(QUIET_DAYS + 1), createdAt: daysAgo(200) }, NOW)).toBe(true);
    expect(isQuiet({ lastSeenAt: daysAgo(QUIET_DAYS - 1), createdAt: daysAgo(200) }, NOW)).toBe(false);
  });
  it("the newest of visit and sign-in counts", () => {
    expect(isQuiet({ lastSeenAt: daysAgo(90), lastSignInAt: daysAgo(2), createdAt: daysAgo(200) }, NOW)).toBe(false);
    expect(isQuiet({ lastSeenAt: null, lastSignInAt: daysAgo(45), createdAt: daysAgo(200) }, NOW)).toBe(true);
  });
  it("a new member with no visit yet is not quiet in their first month", () => {
    expect(isQuiet({ lastSeenAt: null, lastSignInAt: null, createdAt: daysAgo(5) }, NOW)).toBe(false);
    expect(isQuiet({ lastSeenAt: null, lastSignInAt: null, createdAt: daysAgo(60) }, NOW)).toBe(true);
  });
  it("nothing to go on keeps today's behaviour", () => {
    expect(isQuiet({}, NOW)).toBe(false);
  });
});

describe("digestCadence", () => {
  const quiet = { lastSeenAt: daysAgo(60), createdAt: daysAgo(200) };
  it("default (instant) members who went quiet drop to weekly", () => {
    expect(digestCadence({ ...quiet, digest: "instant" }, NOW)).toBe("quiet");
    expect(digestCadence({ ...quiet }, NOW)).toBe("quiet");
  });
  it("a hand-picked Daily is kept, however quiet", () => {
    expect(digestCadence({ ...quiet, digest: "daily" }, NOW)).toBe("daily");
  });
  it("weekly stays weekly; an active member stays daily", () => {
    expect(digestCadence({ ...quiet, digest: "weekly" }, NOW)).toBe("weekly");
    expect(digestCadence({ digest: "instant", lastSeenAt: daysAgo(1), createdAt: daysAgo(200) }, NOW)).toBe("daily");
  });
});

describe("weeklySince", () => {
  it("never reaches back past the member's own last digest", () => {
    expect(weeklySince(daysAgo(7), daysAgo(1))).toBe(daysAgo(1));
    expect(weeklySince(daysAgo(7), daysAgo(10))).toBe(daysAgo(7));
    expect(weeklySince(daysAgo(7), undefined)).toBe(daysAgo(7));
  });
  it("compares instants, not strings (Postgres and JS ISO formats differ)", () => {
    const pg = "2026-11-23T12:00:00+00:00";
    expect(weeklySince("2026-11-17T12:00:00.000Z", pg)).toBe(pg);
  });
});

describe("cadence note in the digest", () => {
  const appUrl = "https://www.ikratom.org";
  it("quiet members are told why, and how to get daily back, with or without the one-click page", () => {
    expect(cadenceNote({ cadence: "quiet", appUrl })!.html).toMatch(/haven't been on iKratom for a month[\s\S]*your settings/);
    expect(cadenceNote({ cadence: "quiet", switchUrl: "https://x/c", appUrl })!.html).toContain("https://x/c");
  });
  it("daily and weekly members see a switch only once the page is live", () => {
    expect(cadenceNote({ cadence: "daily", appUrl })).toBeNull();
    expect(cadenceNote({ cadence: "weekly", appUrl })).toBeNull();
    expect(cadenceNote({ cadence: "daily", switchUrl: "https://x/c", appUrl })!.text).toMatch(/once a week/);
  });
  it("the footer says weekly when it is weekly", () => {
    const sections = [{ title: "News", items: [{ title: "Bill moves", link: "/bills/x" }] }];
    const weekly = renderDigest({ username: "t", appUrl, unsubscribeUrl: "https://x/u", sections, cadence: "quiet" } as never).text as string;
    expect(weekly).toMatch(/weekly summary/);
    const daily = renderDigest({ username: "t", appUrl, unsubscribeUrl: "https://x/u", sections } as never).text as string;
    expect(daily).toMatch(/daily summary/);
  });
  it("the one-click links stay off until the 12-05 build ships /api/email/cadence", () => {
    expect(CADENCE_LINKS_LIVE).toBe(false);
  });
});
