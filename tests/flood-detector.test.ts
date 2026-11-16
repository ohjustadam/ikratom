import { describe, it, expect } from "vitest";
import {
  STEP_MS, densify, detect, thresholds, planScan, pathFamily, rollupPaths, challengedShare, shortUA,
} from "../scripts/lib/flood-detector.mjs";

// Deterministic "normal week" shaped like the real 11-04..11-11 data:
// 5-min buckets mostly 5-60s, an occasional 150-360s slow page.
function normalWeek(endMs: number, days = 7) {
  const rows: { t: string; sec: number }[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let t = endMs - days * 864e5; t < endMs; t += STEP_MS) {
    const r = rnd();
    rows.push({ t: new Date(t).toISOString(), sec: r > 0.995 ? 150 + rnd() * 210 : 5 + rnd() * 55 });
  }
  return rows;
}
const FLOOD_START = Date.parse("2026-11-11T13:30:00Z");

describe("flood detector", () => {
  it("fires on the 11-11 13:30Z flood (5,105 origin-seconds in 10 min)", () => {
    const scanFrom = Date.parse("2026-11-11T13:00:00Z");
    const rows = normalWeek(scanFrom);
    // Earlier daily bursts of the same crawler sit in the baseline.
    for (const [t, sec] of [["2026-11-05T13:05:00Z", 3909], ["2026-11-06T13:25:00Z", 2435], ["2026-11-09T12:50:00Z", 2425]] as const) {
      const i = rows.findIndex((r) => r.t === new Date(t).toISOString());
      if (i >= 0) rows[i].sec = sec;
    }
    rows.push({ t: "2026-11-11T13:30:00Z", sec: 5086 }, { t: "2026-11-11T13:35:00Z", sec: 19 });
    const grid = densify(rows, scanFrom - 7 * 864e5, Date.parse("2026-11-11T14:00:00Z"));
    const r = detect(grid, scanFrom);
    expect(r.bursts.length).toBe(1);
    expect(r.bursts[0].start).toBe(FLOOD_START);
    expect(r.bursts[0].peak).toBe(5086);
    // The quiet buckets after the spike do not stretch the window.
    expect(r.bursts[0].end - r.bursts[0].start).toBe(STEP_MS);
    // The baseline floods did not lift the bar out of reach.
    expect(r.thresholds.bucket).toBeLessThanOrEqual(900);
  });

  it("also fires on the brief's 15,400 figure", () => {
    const scanFrom = FLOOD_START - 3600e3;
    const rows = [...normalWeek(scanFrom), { t: new Date(FLOOD_START).toISOString(), sec: 15400 }];
    expect(detect(densify(rows, scanFrom - 7 * 864e5, FLOOD_START + 3600e3), scanFrom).bursts.length).toBe(1);
  });

  it("stays quiet on a normal day (worst real non-flood bucket 363s, hour 774s)", () => {
    const end = Date.parse("2026-11-10T23:55:00Z");
    const rows = normalWeek(end, 8);
    const i = rows.findIndex((r) => r.t === "2026-11-10T07:20:00.000Z");
    rows[i].sec = 363;
    const scanFrom = Date.parse("2026-11-10T00:00:00Z");
    const r = detect(densify(rows, scanFrom - 7 * 864e5, end), scanFrom);
    expect(r.bursts).toEqual([]);
    expect(r.maxBucket).toBeGreaterThanOrEqual(363);
  });

  it("catches a slow burn no single bucket shows (hour rule)", () => {
    const scanFrom = Date.parse("2026-11-11T00:00:00Z");
    const rows = normalWeek(scanFrom);
    for (let k = 0; k < 12; k++) rows.push({ t: new Date(scanFrom + k * STEP_MS).toISOString(), sec: 250 });
    const r = detect(densify(rows, scanFrom - 7 * 864e5, scanFrom + 3600e3), scanFrom);
    expect(r.bursts.length).toBe(1);
    expect(r.bursts[0].peak).toBeLessThan(r.thresholds.bucket);
  });

  it("a week of floods cannot raise the bar past the ceiling", () => {
    const grid = Array.from({ length: 2016 }, (_, i) => ({ t: i * STEP_MS, sec: 4000 }));
    const th = thresholds(grid);
    expect(th.bucket).toBe(900);
    expect(th.hour).toBe(2400);
  });

  it("an empty baseline falls back to the floors", () => {
    expect(thresholds([])).toMatchObject({ bucket: 600, hour: 1500 });
  });
});

describe("scan window", () => {
  const now = Date.parse("2026-11-11T14:23:00Z");
  it("covers everything since the last scan so a dropped run leaves no gap", () => {
    const w = planScan("2026-11-11T10:15:00Z", now);
    expect(new Date(w.from).toISOString()).toBe("2026-11-11T10:15:00.000Z");
    expect(new Date(w.to).toISOString()).toBe("2026-11-11T14:15:00.000Z");
  });
  it("looks back at least an hour, at most a day", () => {
    expect(planScan(null, now).to - planScan(null, now).from).toBe(3600e3);
    const w = planScan("2026-11-01T00:00:00Z", now);
    expect(w.to - w.from).toBe(24 * 3600e3);
  });
});

describe("alert detail", () => {
  it("groups crawl paths into families ranked by origin time", () => {
    expect(pathFamily("/legislators/ok-123/briefing")).toBe("/legislators/*/briefing");
    expect(pathFamily("/cdn-cgi/challenge-platform/h/b/x")).toBe("/cdn-cgi/* (Cloudflare)");
    const top = rollupPaths([
      { path: "/bills/ok-1", n: 3, sec: 30 }, { path: "/bills/ok-2", n: 2, sec: 20 }, { path: "/api/me", n: 50, sec: 5 },
    ]);
    expect(top[0]).toMatchObject({ family: "/bills/*", n: 5, sec: 50, distinct: 2 });
  });
  it("shortens user agents to browser/version + OS", () => {
    expect(shortUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0")).toBe("Firefox/121 Windows");
    expect(shortUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")).toBe("Chrome/120 Mac");
    expect(shortUA("")).toBe("(none)");
  });
  it("computes the share the Cloudflare rules challenged (11-11: 1,215 of 6,446)", () => {
    const s = challengedShare([{ action: "unknown", n: 5231 }, { action: "managed_challenge", n: 1215 }]);
    expect(s).toBeCloseTo(0.1885, 3);
  });
});
