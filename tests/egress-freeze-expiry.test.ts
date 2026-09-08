/**
 * egress-freeze-expiry.test.ts — the emergency measures must announce their
 * own expiry.
 *
 * Two temporary things went in on 2026-09-08 to survive the Supabase egress
 * cycle: stretched ISR windows on the public pages, and a crawl restriction in
 * robots.txt. Both are meant to end on 2026-09-16 when the cycle resets.
 *
 * The crawl restriction reverses itself (the date is in the code). The ISR
 * windows CANNOT — Next.js requires `export const revalidate` to be a static
 * literal, so no date logic is possible there. That leaves the failure mode
 * this repo has hit before: a "temporary" measure nobody removes. The
 * /legislators/ and /bills/ disallow still carried a "REMOVE AFTER THE
 * 2026-09-19 RESET" note weeks after that constraint stopped binding.
 *
 * So this test goes RED once the date passes. It is deliberately disruptive:
 * a red build is a forcing function, and the fix is a three-line edit. Better
 * a loud reminder than a site that quietly serves week-old data forever.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FREEZE_ENDS = Date.UTC(2026, 8, 16); // 2026-09-16T00:00Z
const FROZEN_SECONDS = 604800;

/** Page file -> the window it should return to once the freeze is over. */
const FROZEN_PAGES: Array<[string, number]> = [
  ["src/app/news/page.tsx", 1800],
  ["src/app/campaigns/page.tsx", 900],
  ["src/app/states/[code]/page.tsx", 900],
];

function revalidateOf(relPath: string): number | null {
  const src = readFileSync(join(process.cwd(), relPath), "utf8");
  const m = src.match(/^export const revalidate = (\d+);/m);
  return m ? Number(m[1]) : null;
}

describe("egress freeze (2026-09-08 → 2026-09-16)", () => {
  const frozen = Date.now() < FREEZE_ENDS;

  it.each(FROZEN_PAGES)("%s carries a revalidate window at all", (path) => {
    // Whatever the value, losing the export entirely would silently make the
    // route dynamic again — the exact regression this whole effort undid.
    expect(revalidateOf(path)).toBeTypeOf("number");
  });

  if (frozen) {
    it.each(FROZEN_PAGES)("%s is still frozen (cycle has not reset yet)", (path) => {
      expect(revalidateOf(path)).toBe(FROZEN_SECONDS);
    });
  } else {
    it.each(FROZEN_PAGES)(
      "%s must be RESTORED — the egress cycle reset on 2026-09-16",
      (path, normal) => {
        expect(
          revalidateOf(path),
          `${path} is still on the emergency 7-day window. The Supabase egress ` +
          `cycle has reset, so restore it to ${normal} and delete the FROZEN ` +
          `comment block. See private/V2_KICKOFF.md.`,
        ).toBe(normal);
      },
    );
  }
});
