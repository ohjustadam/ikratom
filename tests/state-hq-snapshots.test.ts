import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { chunk, tallyKratomVotes, VOTE_ID_CHUNK } from "../src/lib/vote-tally";

/**
 * State HQ (2026-10-13): the officials directory read up to ~250 KB uncached on
 * every render, and its vote query put a whole state's ids (419 for New
 * Hampshire) into one URL. These pin the fix and its wiring.
 */
describe("chunk", () => {
  it("keeps every id, in order, at most VOTE_ID_CHUNK per request", () => {
    const ids = Array.from({ length: 419 }, (_, i) => `id-${i}`); // New Hampshire
    const parts = chunk(ids, VOTE_ID_CHUNK);
    expect(parts).toHaveLength(5);
    expect(parts.every((p) => p.length <= VOTE_ID_CHUNK)).toBe(true);
    expect(parts.flat()).toEqual(ids);
  });
  it("handles empty and exact multiples", () => {
    expect(chunk([], 100)).toEqual([]);
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
    expect(() => chunk([1], 0)).toThrow();
  });
  it("stays under a URL size PostgREST accepts", () => {
    expect(VOTE_ID_CHUNK * 37).toBeLessThan(8000); // 36-char uuid + comma
  });
});

describe("tallyKratomVotes", () => {
  const row = (legislator_id: string | null, vote_value: number, rel: string | null, asArray = false) => ({
    legislator_id,
    vote_value,
    bill_votes: asArray ? [{ bills: [{ kratom_relevance: rel }] }] : { bills: { kratom_relevance: rel } },
  });
  it("counts restricting votes: yes on anti, no on pro", () => {
    const t = tallyKratomVotes([row("a", 1, "anti"), row("a", 2, "pro", true), row("a", 1, "pro"), row("a", 2, "anti")]);
    expect(t.a).toEqual({ total: 4, restrict: 2 });
  });
  it("skips rows without a legislator or a bill", () => {
    const t = tallyKratomVotes([row(null, 1, "anti"), { legislator_id: "b", vote_value: 1, bill_votes: null }]);
    expect(t).toEqual({});
  });
});

describe("wiring", () => {
  const page = readFileSync(new URL("../src/app/states/[code]/page.tsx", import.meta.url), "utf8");
  const officials = readFileSync(new URL("../src/app/states/[code]/StateOfficials.tsx", import.meta.url), "utf8");
  const data = readFileSync(new URL("../src/app/states/[code]/state-officials-data.ts", import.meta.url), "utf8");

  it("the hub reads both parts through publicSnapshot", () => {
    expect(page).toMatch(/publicSnapshot\("state-hub", "v1", codeUpper, 900,/);
    expect(page).toMatch(/publicSnapshot\("state-hub-legislative", "v1", codeUpper, 6 \* 3600,/);
  });

  it("each loader throws on its core query (so a failing Supabase serves the last good copy)", () => {
    expect(page).toMatch(/if \(bills\.error\) throw/);
    expect(page).toMatch(/if \(stateLegs\.error\) throw/);
    expect(data).toMatch(/if \(error\) throw/);
  });

  it("the officials component no longer queries Supabase itself", () => {
    expect(officials).not.toMatch(/\.from\(|\.rpc\(|createAnonClient/);
    expect(officials).toMatch(/getStateOfficials\(state\)\.catch\(/);
  });

  it("votes are fetched in chunks and cached", () => {
    expect(data).toMatch(/chunk\(officials\.map\(\(o\) => o\.id\), VOTE_ID_CHUNK\)/);
    expect(data).toMatch(/publicSnapshot\("state-officials", "v1", state, 6 \* 3600,/);
  });
});
