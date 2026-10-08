import { describe, it, expect, vi, afterEach } from "vitest";

// Never launch Chromium in a unit test — the render fallback returns whatever
// each test queues up.
const renderQueue: Array<{ text: string } | null> = [];
vi.mock("../scripts/lib/headless-render.mjs", () => ({
  renderPage: vi.fn(async () => renderQueue.shift() ?? null),
}));

import { describeLastAttempt, handAddHref } from "../src/lib/local-rep-attempt";
import { fetchPageText } from "../scripts/lib/page-text.mjs";

/**
 * Elk Grove, CA (2026-10-07): the batch hit a city site behind a Cloudflare
 * challenge, logged `no-extract`, and the admin page said "check back shortly"
 * forever. These pin (1) that a bot-check refusal is detected as such, and
 * (2) that every reason code the batch writes renders as a plain sentence.
 */
describe("describeLastAttempt", () => {
  it("says a blocked site needs a human, naming the host", () => {
    const n = describeLastAttempt("site-blocked", "elkgrove.gov");
    expect(n?.needsHuman).toBe(true);
    expect(n?.text).toMatch(/elkgrove\.gov blocks automated readers/);
    expect(n?.text).toMatch(/add the officials by hand/i);
  });

  it("covers every code the batch writes", () => {
    for (const code of ["site-blocked", "no-extract", "no-gov-candidate", "searxng-empty", "no-officials", "partial-roster"]) {
      const n = describeLastAttempt(code, null);
      expect(n, code).not.toBeNull();
      expect(n!.text, code).not.toContain(`(${code})`); // not the unknown-code fallback
    }
  });

  it("treats a search outage as transient", () => {
    expect(describeLastAttempt("searxng-empty", null)?.needsHuman).toBe(false);
  });

  it("returns null when the batch hasn't tried yet", () => {
    expect(describeLastAttempt(null)).toBeNull();
  });

  it("builds a prefilled hand-add link", () => {
    expect(handAddHref("CA", "Elk Grove, CA", "municipal")).toBe(
      "/admin/locals/new?state=CA&locality=Elk+Grove%2C+CA&role=city_council",
    );
    expect(handAddHref("LA", "St. Bernard Parish, LA", "county")).toContain("role=county_commissioner");
  });
});

describe("fetchPageText diag.blocked", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    renderQueue.length = 0;
  });
  const stubFetch = (res: () => Response) => vi.stubGlobal("fetch", vi.fn(async () => res()));
  const challenge = () => new Response("<title>Just a moment...</title>", { status: 403, headers: { "cf-mitigated": "challenge" } });

  it("flags a Cloudflare managed challenge", async () => {
    stubFetch(challenge);
    const diag: { blocked?: string } = {};
    expect(await fetchPageText("https://elkgrove.gov/x", { render: false, diag })).toBeNull();
    expect(diag.blocked).toBe("challenge");
  });

  it("flags a plain 403 / 429 as a block", async () => {
    stubFetch(() => new Response("nope", { status: 429 }));
    const diag: { blocked?: string } = {};
    await fetchPageText("https://example.gov/x", { render: false, diag });
    expect(diag.blocked).toBe("http-429");
  });

  it("does not call a 404 a block", async () => {
    stubFetch(() => new Response("missing", { status: 404 }));
    const diag: { blocked?: string } = {};
    await fetchPageText("https://example.gov/x", { render: false, diag });
    expect(diag.blocked).toBeUndefined();
  });

  it("keeps the block when headless render only gets the interstitial too", async () => {
    stubFetch(challenge);
    renderQueue.push({ text: "Just a moment... Enable JavaScript and cookies to continue" });
    const diag: { blocked?: string } = {};
    expect(await fetchPageText("https://elkgrove.gov/x", { diag })).toBeNull();
    expect(diag.blocked).toBe("challenge");
  });

  it("clears the flag when headless render gets real content", async () => {
    stubFetch(challenge);
    renderQueue.push({ text: "City Council. Mayor Bobbie Singh-Allen. ".repeat(40) });
    const diag: { blocked?: string } = {};
    expect(await fetchPageText("https://elkgrove.gov/x", { diag })).toMatch(/Singh-Allen/);
    expect(diag.blocked).toBeUndefined();
  });

  it("works without a diag object (existing callers unchanged)", async () => {
    stubFetch(challenge);
    expect(await fetchPageText("https://elkgrove.gov/x", { render: false })).toBeNull();
  });
});
