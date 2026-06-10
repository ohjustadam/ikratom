/**
 * digest-window.test.ts — pins the digest cadence gate (PR-J wires the
 * long-dead digest enum). BOUNDARY semantics: a daily user is due once
 * their local 9am boundary passed AND they haven't been pushed since it;
 * weekly uses Monday 9am local. Quiet hours / rate-caps over 9am therefore
 * only DELAY a digest to the next allowed hour — never skip it.
 */
import { describe, it, expect } from "vitest";
import { digestDue } from "../src/lib/notifications/push-gate";

// 2026-06-08 was a Monday. 14:30 UTC = 09:30 in America/Chicago (CDT, UTC-5).
const MON_0930 = Date.parse("2026-06-08T14:30:00Z");
const MON_1230 = Date.parse("2026-06-08T17:30:00Z");
const TUE_0930 = Date.parse("2026-06-09T14:30:00Z");
const MON_0830 = Date.parse("2026-06-08T13:30:00Z");
const CHI = "America/Chicago";

describe("digestDue", () => {
  it("instant / off / missing prefs always pass", () => {
    expect(digestDue({ digest: "instant", timezone: CHI }, MON_1230)).toBe(true);
    expect(digestDue({ digest: "off", timezone: CHI }, MON_1230)).toBe(true);
    expect(digestDue(null, MON_1230)).toBe(true);
    expect(digestDue({}, MON_1230)).toBe(true);
  });

  it("daily: not due before the 9am boundary, due after until pushed", () => {
    const p = { digest: "daily", timezone: CHI, last_push_at: null };
    expect(digestDue(p, MON_0830)).toBe(false); // boundary not reached
    expect(digestDue(p, MON_0930)).toBe(true);
    expect(digestDue(p, MON_1230)).toBe(true); // STILL due later (quiet hours only delay)
  });

  it("daily: a push after the boundary clears it; a push before doesn't", () => {
    expect(digestDue({ digest: "daily", timezone: CHI, last_push_at: "2026-06-08T14:35:00Z" }, MON_1230)).toBe(false); // pushed 9:35 local
    expect(digestDue({ digest: "daily", timezone: CHI, last_push_at: "2026-06-08T13:55:00Z" }, MON_0930)).toBe(true); // 8:55 direct-send brief is pre-boundary
    expect(digestDue({ digest: "daily", timezone: CHI, last_push_at: "2026-06-07T15:00:00Z" }, MON_0930)).toBe(true); // yesterday
  });

  it("weekly: due any time after Monday 9am local until pushed, incl. Tuesday catch-up", () => {
    const p = { digest: "weekly", timezone: CHI, last_push_at: "2026-06-05T15:00:00Z" }; // last Friday
    expect(digestDue(p, MON_0830)).toBe(false);
    expect(digestDue(p, MON_0930)).toBe(true);
    expect(digestDue(p, TUE_0930)).toBe(true); // Monday missed (quiet hours) → catch up
    expect(digestDue({ digest: "weekly", timezone: CHI, last_push_at: "2026-06-08T15:00:00Z" }, TUE_0930)).toBe(false); // delivered Monday 10am
  });

  it("no timezone falls back to UTC; junk timezone fails open", () => {
    expect(digestDue({ digest: "daily", timezone: null, last_push_at: null }, Date.parse("2026-06-08T09:30:00Z"))).toBe(true);
    expect(digestDue({ digest: "daily", timezone: null, last_push_at: null }, Date.parse("2026-06-08T08:30:00Z"))).toBe(false);
    expect(digestDue({ digest: "daily", timezone: "Not/AZone", last_push_at: null }, MON_0830)).toBe(true);
  });
});
