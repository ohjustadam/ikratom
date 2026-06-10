/**
 * ban-verify.test.ts — pins the de-Gemini'd local-ban verification engine.
 *
 * 1. The GATE (decideBanOutcome) keeps the 0190 semantics, hardened:
 *    >=2 DISTINCT-HOST evidence sources incl. >=1 non-aggregator to confirm;
 *    repeals need authoritative OR dated OR doubled non-aggregator evidence
 *    (and then beat aggregator ban claims — the Monroe pattern).
 * 2. checkClaimedJurisdiction is the Salem-class defense: name + county/city
 *    TYPE + STATE must all agree before a page counts as evidence.
 * 3. NO GEMINI: the ban pipeline must never import gemini-keys /
 *    grounding-budget / call generativelanguage — same pin as officials.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decideBanOutcome, tierOf, rankBanCandidates, checkClaimedJurisdiction, statesNamedIn } from "../scripts/lib/ban-verify.mjs";

const ev = (over: Record<string, unknown> = {}) => ({
  url: "https://example.gov/minutes",
  tier: "authoritative",
  status: "banned",
  enacted_date: null,
  repeal_date: null,
  ordinance_citation: null,
  what: "board adopted kratom ban",
  ...over,
});

describe("tierOf (hostname-only — paths can't mint authority)", () => {
  it("classifies aggregators, authoritative hosts, and the rest", () => {
    expect(tierOf("https://kratomlords.com/ms")).toBe("aggregator");
    expect(tierOf("https://www.monroecountyms.gov/minutes")).toBe("authoritative");
    expect(tierOf("https://library.municode.com/ms/monroe")).toBe("authoritative");
    expect(tierOf("https://randomblog.com/kratom")).toBe("semi");
    expect(tierOf(null as unknown as string)).toBe("aggregator");
  });
  it("a /municode PATH on a random domain is NOT authoritative", () => {
    expect(tierOf("https://evil.com/municode")).toBe("semi");
  });
  it("unlisted kratom-branded hosts are aggregators; the AKA is not", () => {
    expect(tierOf("https://bestkratomdeals.com/bans")).toBe("aggregator");
    expect(tierOf("https://www.americankratom.org/advocacy")).toBe("authoritative");
  });
});

describe("decideBanOutcome — the hardened 0190 gate", () => {
  it("confirms with 2 distinct-host sources incl >=1 non-aggregator", () => {
    const d = decideBanOutcome([ev(), ev({ url: "https://kratomlords.com/x", tier: "aggregator" })]);
    expect(d.outcome).toBe("confirmed");
    expect(d.sources).toHaveLength(2);
  });

  it("holds a single source — even an authoritative one", () => {
    expect(decideBanOutcome([ev()]).outcome).toBe("held");
  });

  it("dedupes by host: two pages on ONE domain are ONE source", () => {
    const d = decideBanOutcome([
      ev({ url: "https://www.cityof.us/page-a" }),
      ev({ url: "https://cityof.us/page-b" }),
    ]);
    expect(d.outcome).toBe("held");
    expect(d.sources).toHaveLength(1);
  });

  it("holds aggregator-only evidence no matter how many copies agree", () => {
    const aggs = [1, 2, 3].map((i) => ev({ url: `https://kratomscience${i}.com/${i}`, tier: "aggregator" }));
    expect(decideBanOutcome(aggs).outcome).toBe("held");
  });

  it("semi-tier counts as the required non-aggregator source (legacy semantics)", () => {
    const d = decideBanOutcome([
      ev({ url: "https://localpaper.com/story", tier: "semi" }),
      ev({ url: "https://kratomlords.com/x", tier: "aggregator" }),
    ]);
    expect(d.outcome).toBe("confirmed");
  });

  it("a dated authoritative repeal BEATS aggregator ban claims (the Monroe pattern)", () => {
    const d = decideBanOutcome([
      ev({ url: "https://kratomlords.com/x", tier: "aggregator" }),
      ev({ url: "https://kratomscience.com/y", tier: "aggregator" }),
      ev({ status: "repealed", repeal_date: "2020-06-01", what: "supervisors rescinded 3-2" }),
    ]);
    expect(d.outcome).toBe("repealed");
    expect(d.repeal_date).toBe("2020-06-01");
  });

  it("ONE undated semi-tier repeal is NOT enough to unpublish a ban", () => {
    const d = decideBanOutcome([ev({ status: "repealed", url: "https://randomblog.com/x", tier: "semi", repeal_date: null })]);
    expect(d.outcome).toBe("held");
  });

  it("a DATED semi-tier repeal qualifies", () => {
    const d = decideBanOutcome([ev({ status: "repealed", url: "https://localpaper.com/x", tier: "semi", repeal_date: "2021-03-02" })]);
    expect(d.outcome).toBe("repealed");
  });

  it("TWO undated non-aggregator repeals on distinct hosts qualify", () => {
    const d = decideBanOutcome([
      ev({ status: "repealed", url: "https://paperone.com/x", tier: "semi", repeal_date: null }),
      ev({ status: "repealed", url: "https://papertwo.com/y", tier: "semi", repeal_date: null }),
    ]);
    expect(d.outcome).toBe("repealed");
  });

  it("an aggregator-only repeal does NOT repeal (and can't confirm either)", () => {
    const d = decideBanOutcome([ev({ status: "repealed", tier: "aggregator", url: "https://kratomgeek.com/x" })]);
    expect(d.outcome).toBe("held");
  });

  it("empty evidence holds", () => {
    expect(decideBanOutcome([]).outcome).toBe("held");
  });

  it("carries enacted_date + citation from non-aggregator sources on confirm", () => {
    const d = decideBanOutcome([
      ev({ enacted_date: "2019-08-05", ordinance_citation: "Ordinance 2019-04" }),
      ev({ url: "https://kratomlords.com/x", tier: "aggregator" }),
    ]);
    expect(d.enacted_date).toBe("2019-08-05");
    expect(d.ordinance_citation).toBe("Ordinance 2019-04");
  });
});

describe("checkClaimedJurisdiction — the Salem-class defense", () => {
  const ms = (claimed: string, locality = "Union County, MS") => checkClaimedJurisdiction({ claimed, locality, state: "MS" });

  it("accepts the right locality + state", () => {
    expect(ms("Union County, Mississippi")).toBe(true);
  });
  it("REJECTS the same-named locality in another state (full name)", () => {
    expect(ms("Union County, North Carolina")).toBe(false);
  });
  it("REJECTS a trailing foreign 2-letter code, accepts ours", () => {
    expect(ms("union county nc")).toBe(false);
    expect(ms("union county ms")).toBe(true);
  });
  it("accepts when a FOREIGN state name is embedded in the locality's own name", () => {
    expect(checkClaimedJurisdiction({ claimed: "Washington County, Mississippi", locality: "Washington County", state: "MS" })).toBe(true);
  });
  it("never reads 'west virginia' as 'virginia' (longest-first)", () => {
    expect(checkClaimedJurisdiction({ claimed: "Charleston, West Virginia", locality: "Charleston", state: "VA" })).toBe(false);
    expect(checkClaimedJurisdiction({ claimed: "Charleston, West Virginia", locality: "Charleston", state: "WV" })).toBe(true);
  });
  it("county evidence can NOT verify the same-named CITY (type agreement)", () => {
    expect(checkClaimedJurisdiction({ claimed: "Union County, Mississippi", locality: "Union", state: "MS" })).toBe(false);
  });
  it("city evidence can NOT verify the same-named COUNTY", () => {
    expect(checkClaimedJurisdiction({ claimed: "Union, Mississippi", locality: "Union County", state: "MS" })).toBe(false);
  });
  it("a formal 'City of X, X County, ST' style still verifies the city", () => {
    expect(checkClaimedJurisdiction({ claimed: "City of Union, Union County, Mississippi", locality: "Union", state: "MS" })).toBe(true);
  });
  it("whole-word matching: Leesburg is not Lee County", () => {
    expect(checkClaimedJurisdiction({ claimed: "Leesburg, Mississippi", locality: "Lee County", state: "MS" })).toBe(false);
  });
  it("a no-state claim passes on name+type (gazetteer page gate is the backstop)", () => {
    expect(ms("Monroe County board of supervisors", "Monroe County, MS")).toBe(true);
  });
  it("empty claim rejects", () => {
    expect(ms("")).toBe(false);
  });
});

describe("statesNamedIn", () => {
  it("finds full state names, longest first", () => {
    expect([...statesNamedIn("union county north carolina")]).toEqual(["NC"]);
    expect(statesNamedIn("charleston west virginia").has("WV")).toBe(true);
    expect(statesNamedIn("charleston west virginia").has("VA")).toBe(false);
    expect(statesNamedIn("washington county mississippi").has("MS")).toBe(true);
  });
});

describe("rankBanCandidates", () => {
  it("ranks authoritative above aggregators and caps at 8", () => {
    const results = [
      { url: "https://kratomlords.com/ms-bans", title: "kratom bans list", content: "monroe county kratom" },
      { url: "https://www.monroecountyms.gov/board", title: "Board of Supervisors", content: "kratom ordinance monroe" },
      ...Array.from({ length: 10 }, (_, i) => ({ url: `https://blog${i}.com/x`, title: "x", content: "" })),
    ];
    const ranked = rankBanCandidates(results, "Monroe County");
    expect(ranked[0]).toBe("https://www.monroecountyms.gov/board");
    expect(ranked.length).toBeLessThanOrEqual(8);
    expect(ranked.indexOf("https://kratomlords.com/ms-bans")).toBeGreaterThan(0);
  });
});

describe("no-Gemini pin (the whole point of PR-A)", () => {
  const GEMINI_INFRA = /from\s+["'][^"']*(gemini-keys|grounding-budget)|generativelanguage\.googleapis/;
  for (const rel of ["scripts/verify-local-bans.mjs", "scripts/lib/ban-verify.mjs", "scripts/sweep-locality-intel.mjs", "scripts/lib/locality-intel.mjs"]) {
    it(`${rel} has no Gemini infrastructure`, () => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(GEMINI_INFRA.test(src)).toBe(false);
    });
  }
});
