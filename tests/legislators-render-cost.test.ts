/**
 * /legislators server time (2026-11-10 credit-burn cut).
 *
 * - /legislators/[id] and its /briefing run ONE snapshot chain per request.
 *   generateMetadata and the page both read the snapshot; without React
 *   cache() each ran its own cold miss (R2 read, Supabase load, R2 write).
 * - The /legislators directory reads its public half from a per-state cache
 *   built with the anonymous client, and only caches real state codes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));
const cachedFns: Array<{ keyParts: string[]; calls: number }> = [];
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown, keyParts: string[]) => {
    const rec = { keyParts, calls: 0 };
    cachedFns.push(rec);
    return (...a: unknown[]) => { rec.calls++; return fn(...a); };
  },
}));

type Row = { legislator_id: string | null; vote_value: number | null; bill_votes: unknown };
let voteRows: Row[] = [];
const calls: string[] = [];
function fakeClient() {
  const q = (table: string) => {
    let from = 0, to = 0;
    const b = {
      select: () => b, eq: () => b, in: () => b, limit: () => b,
      order: (col: string) => { calls.push(`${table}.order(${col})`); return b; },
      range: (f: number, t: number) => { from = f; to = t; calls.push(`${table}.range(${f})`); return b; },
      then: (res: (v: unknown) => void) => {
        if (table === "bill_vote_members") return res({ data: voteRows.slice(from, to + 1), error: null });
        if (table === "states") return res({ data: [{ abbr: "OK", name: "Oklahoma" }], error: null });
        return res({ data: [{ id: "L1", state: "OK", level: "state" }], error: null });
      },
    };
    return b;
  };
  return { from: q, rpc: async () => ({ data: [{ locality: "Tulsa", level: "municipal", n: 9 }], error: null }) };
}
vi.mock("@/lib/supabase/anon", () => ({ createAnonClient: () => fakeClient() }));

const src = (p: string) => readFileSync(path.join(process.cwd(), "src/app", p), "utf8");

describe("one snapshot chain per request", () => {
  // Scan, don't list: every page whose generateMetadata reads an unstable_cache
  // getter that the page also reads. unstable_cache does not share an
  // in-flight miss, so without React cache() a cold render runs it twice.
  const pages = (readdirSync(path.join(process.cwd(), "src/app"), { recursive: true }) as string[])
    .filter((p) => /(^|[\\/])page\.tsx$/.test(p))
    .map((p) => p.replace(/\\/g, "/"));
  const shared = pages.flatMap((file) => {
    const s = src(file).replace(/\r\n/g, "\n");
    const start = s.indexOf("export async function generateMetadata");
    if (start < 0) return [];
    // Only generateMetadata's own body, up to its closing brace at column 0:
    // helpers declared between it and the page are not metadata reads.
    const meta = s.slice(start, s.indexOf("\n}\n", start));
    return [...s.matchAll(/const (\w+) = (cache\()?unstable_cache\(/g)]
      .filter((m) => meta.includes(`${m[1]}(`))
      .map((m) => ({ file, getter: m[1], wrapped: Boolean(m[2]), reactImport: /import \{ cache \} from "react";/.test(s) }));
  });

  it("finds the pages it guards", () => {
    const files = shared.map((x) => x.file);
    expect(files).toEqual(expect.arrayContaining([
      "legislators/[id]/page.tsx", "legislators/[id]/briefing/page.tsx", "news/[id]/page.tsx",
      "alerts/[id]/page.tsx", "meetings/[id]/page.tsx", "intel/operations/[slug]/page.tsx",
      "bills/[id]/page.tsx",
    ]));
  });

  it("wraps every metadata-shared getter in React cache()", () => {
    expect(shared.filter((x) => !x.wrapped || !x.reactImport)).toEqual([]);
  });
});

describe("legislator directory", () => {
  beforeEach(() => { voteRows = []; calls.length = 0; });

  it("tallies restrict votes, paging in a stable order past 1000 rows", async () => {
    const { voteAggregate } = await import("../src/lib/legislator-directory");
    const anti = { bills: { kratom_relevance: "anti" } };
    const pro = { bills: [{ kratom_relevance: "pro" }] };
    voteRows = [
      ...Array.from({ length: 1000 }, () => ({ legislator_id: "A", vote_value: 1, bill_votes: anti })), // yea on anti = restrict
      { legislator_id: "A", vote_value: 2, bill_votes: anti }, // nay on anti
      { legislator_id: "B", vote_value: 2, bill_votes: [pro] }, // nay on pro = restrict
      { legislator_id: null, vote_value: 1, bill_votes: anti },
      { legislator_id: "C", vote_value: 1, bill_votes: null },
    ];
    const { createAnonClient } = await import("@/lib/supabase/anon");
    const agg = await voteAggregate(createAnonClient() as never, ["A", "B", "C"]);
    expect(agg).toEqual({ A: { restrict: 1000, total: 1001 }, B: { restrict: 1, total: 1 } });
    expect(calls).toEqual([
      "bill_vote_members.order(id)", "bill_vote_members.range(0)",
      "bill_vote_members.order(id)", "bill_vote_members.range(1000)",
    ]);
  });

  it("caches a real state code and loads junk without a cache entry", async () => {
    const dir = await import("../src/lib/legislator-directory");
    const rec = cachedFns.find((c) => c.keyParts[0] === "legislator-directory-v1")!;
    const before = rec.calls;
    const ok = await dir.getStateDirectory("OK");
    expect(ok.states[0].abbr).toBe("OK");
    expect(ok.localPlaces[0].locality).toBe("Tulsa");
    expect(rec.calls).toBe(before + 1);
    await dir.getStateDirectory("NOT-A-STATE");
    expect(rec.calls).toBe(before + 1);
  });

  it("is read with the anonymous client, never the viewer's cookies", () => {
    const lib = readFileSync(path.join(process.cwd(), "src/lib/legislator-directory.ts"), "utf8");
    expect(lib).toContain("createAnonClient()");
    expect(lib).not.toMatch(/supabase\/server|cookies\(|service-role/);
    const page = src("legislators/page.tsx");
    expect(page).toContain("getStateDirectory(");
    expect(page).toContain("getPlaceOfficials(");
  });
});
