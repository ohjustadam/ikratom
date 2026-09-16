/**
 * egress-freeze-expiry.test.ts — emergency caching measures must not outlive
 * the emergency, and this guard must not be able to miss one.
 *
 * HISTORY, because the second version exists for a reason. During the
 * 2026-09-08 Supabase egress emergency, fifteen public pages had their ISR
 * windows stretched to 7 days to hold runtime renders near zero. Next requires
 * `export const revalidate` to be a static literal, so unlike the robots.txt
 * crawl restriction — which carried its expiry date in code and lifted itself
 * on 09-16 with no deploy — these could not self-clear. This test was written
 * to force the restore.
 *
 * It worked: it went red on 09-16 and named files to fix. But it only tracked
 * FOUR of the fifteen, from a hand-maintained list. Eleven pages would have sat
 * on a 7-day cache indefinitely with nothing complaining. A guard that has to
 * be remembered is the same class of problem as the thing it guards against.
 *
 * So it no longer keeps a list. It SCANS for the freeze marker, and any page
 * frozen in a future emergency is covered automatically whether or not anyone
 * thinks to come back here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The value an emergency freeze sets. Scanning for it is what makes this self-maintaining. */
const FROZEN_SECONDS = 604800;
const APP_DIR = join(process.cwd(), "src", "app");

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pageFiles(full, out);
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

type Page = { rel: string; abs: string; revalidate: number | null; normal: number | null };

const pages: Page[] = pageFiles(APP_DIR).map((abs) => {
  const src = readFileSync(abs, "utf8");
  const rev = src.match(/^export const revalidate = (\d+);/m);
  // Every frozen page records its own target in the comment on that line, so a
  // restore never depends on anyone remembering the original number.
  const normal = src.match(/normal is (\d+)/);
  return {
    abs,
    rel: abs.slice(process.cwd().length + 1).replace(/\\/g, "/"),
    revalidate: rev ? Number(rev[1]) : null,
    normal: normal ? Number(normal[1]) : null,
  };
});

describe("egress freeze must not outlive the emergency", () => {
  it("finds pages to check at all — guards against a silently broken scan", () => {
    // Without this, a scan that matched nothing would make every assertion
    // below pass vacuously and turn this file into decoration.
    expect(pages.length).toBeGreaterThan(20);
    expect(pages.filter((p) => p.revalidate !== null).length).toBeGreaterThan(5);
  });

  it("has no page left on the 7-day emergency window", () => {
    const frozen = pages.filter((p) => p.revalidate === FROZEN_SECONDS);
    const detail = frozen
      .map((p) => `  ${p.rel} — restore to ${p.normal ?? "its pre-freeze value"}`)
      .join("\n");
    expect(
      frozen.map((p) => p.rel),
      frozen.length
        ? `\n\n${frozen.length} page(s) still on the emergency 7-day cache window.\n`
          + `An emergency freeze is meant to last days, not forever. Restore these\n`
          + `and delete the FROZEN comment block:\n\n${detail}\n\nSee private/V2_KICKOFF.md.\n`
        : "",
    ).toEqual([]);
  });

  it("leaves no orphaned FROZEN comment behind", () => {
    // A restored value with the scary comment still attached misleads the next
    // reader into thinking the emergency is still running.
    const stale = pages
      .filter((p) => p.revalidate !== null && p.revalidate !== FROZEN_SECONDS)
      .filter((p) => readFileSync(p.abs, "utf8").includes("FROZEN WINDOW"))
      .map((p) => p.rel);
    expect(stale, `restored but still carrying a FROZEN WINDOW comment: ${stale.join(", ")}`)
      .toEqual([]);
  });

  it("keeps every cached page's window sane", () => {
    // The window IS the per-page cost ceiling. Anything past a day is either an
    // emergency measure or a mistake, and both deserve a second look.
    const tooLong = pages
      .filter((p) => p.revalidate !== null && p.revalidate > 86_400)
      .map((p) => `${p.rel}=${p.revalidate}`);
    expect(tooLong, `revalidate > 24h on: ${tooLong.join(", ")}`).toEqual([]);
  });
});
