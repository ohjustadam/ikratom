import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { siteJsonLd, NOINDEX } from "../seo";

// docs/SEO_BRAND.md: Google rewrites "ikratom" to "kratom". The home page's
// WebSite + Organization markup is how we state the name; these guard it.
describe("siteJsonLd", () => {
  const [site, org] = siteJsonLd();

  it("names the site iKratom, with the spelling people type as an alternate", () => {
    expect(site["@type"]).toBe("WebSite");
    expect(site.name).toBe("iKratom");
    expect(site.alternateName).toContain("ikratom");
    expect(site.url).toBe("https://www.ikratom.org/");
  });

  it("gives the organization an absolute, crawlable logo and official profiles", () => {
    expect(org["@type"]).toBe("Organization");
    expect(org.logo.url).toMatch(/^https:\/\/www\.ikratom\.org\/.+\.png$/);
    expect(org.sameAs.length).toBeGreaterThan(0);
    for (const u of org.sameAs) expect(u).toMatch(/^https:\/\//);
  });

  it("points the search action at the real /search?q= route", () => {
    expect(site.potentialAction.target.urlTemplate).toBe("https://www.ikratom.org/search?q={search_term_string}");
  });
});

describe("NOINDEX", () => {
  it("keeps the page out of the index but lets links be followed", () => {
    expect(NOINDEX).toEqual({ index: false, follow: true });
  });
});

// The root layout's title template already appends " | iKratom". A page title
// that ends in "· iKratom" or "— iKratom" shows the brand twice in Google.
describe("page titles", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/^(page|layout)\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk(join(process.cwd(), "src", "app"));

  it("scans real pages (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("never hand-append the brand that the template adds", () => {
    const doubled = files.filter((f) =>
      /title:\s*[`"'][^`"'\n]*\s(?:·|—|\|)\s*iKratom[`"']/.test(readFileSync(f, "utf8")),
    );
    expect(doubled).toEqual([]);
  });
});
