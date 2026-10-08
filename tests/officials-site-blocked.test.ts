import { describe, it, expect, vi, beforeEach } from "vitest";

// Every network edge of findAndExtractOfficials is mocked: no Legistar tenant,
// a fixed SearXNG hit list, an incorporated city, and a page fetcher whose
// behaviour each test sets per URL.
const { fetchBehaviour, aiRouter } = vi.hoisted(() => ({
  fetchBehaviour: new Map<string, string>(),
  aiRouter: vi.fn(async () => ({
    provider: "groq",
    parsed: { page_jurisdiction: "City of Elk Grove, California", officials: [] },
  })),
}));
vi.mock("../scripts/lib/legistar-resolver.mjs", () => ({ resolveCachedTenant: vi.fn(async () => null) }));
vi.mock("../scripts/lib/legistar-officials.mjs", () => ({ fetchLegistarOfficials: vi.fn() }));
vi.mock("../scripts/lib/place-classify.mjs", () => ({ classifyUsPlace: vi.fn(async () => ({ kind: "incorporated" })) }));
vi.mock("../scripts/lib/searxng.mjs", () => ({
  searxngConfigured: () => true,
  searxngSearch: vi.fn(async () => [
    { url: "https://elkgrove.gov/city-government/city-council" },
    { url: "https://www.elkgrovecity.org/city-council" },
  ]),
}));
vi.mock("../scripts/lib/page-text.mjs", () => ({
  fetchPageText: vi.fn(async (url: string, opts?: { diag?: { blocked?: string } }) => {
    const b = fetchBehaviour.get(url) ?? "missing";
    if (b === "blocked") {
      if (opts?.diag) opts.diag.blocked = "challenge";
      return null;
    }
    return b === "missing" ? null : b;
  }),
}));
vi.mock("../scripts/lib/ai-router.mjs", () => ({ aiRouter }));

import { findAndExtractOfficials } from "../scripts/lib/officials-extract.mjs";

const TOP = "https://elkgrove.gov/city-government/city-council";
const run = () =>
  findAndExtractOfficials({ sb: null, city: "Elk Grove", state: "CA", locality: "Elk Grove, CA", level: "municipal" });

/** Elk Grove, CA, 2026-10-07: the official site sits behind a Cloudflare
 *  challenge. That must surface as `site-blocked` (a human has to step in),
 *  not the generic `no-extract` that reads as "try again later". */
describe("findAndExtractOfficials — blocked official site", () => {
  beforeEach(() => {
    fetchBehaviour.clear();
    aiRouter.mockClear();
  });

  it("reports site-blocked with the host when the top page refuses us", async () => {
    fetchBehaviour.set(TOP, "blocked");
    expect(await run()).toMatchObject({ queued: true, reason: "site-blocked", detail: "elkgrove.gov" });
    expect(aiRouter).not.toHaveBeenCalled();
  });

  it("stays no-extract when the page was readable but had no roster", async () => {
    fetchBehaviour.set(TOP, "Welcome to Elk Grove, California. Parks and recreation. ".repeat(20));
    expect(await run()).toMatchObject({ queued: true, reason: "no-extract", detail: "elkgrove.gov" });
    expect(aiRouter).toHaveBeenCalledTimes(1);
  });

  it("a block on a lower-ranked page alone is not site-blocked", async () => {
    fetchBehaviour.set("https://www.elkgrovecity.org/city-council", "blocked");
    expect(await run()).toMatchObject({ queued: true, reason: "no-extract" });
  });
});
