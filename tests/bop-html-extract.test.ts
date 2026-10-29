import { describe, expect, it } from "vitest";
import { extractFindingsFromHtml } from "../scripts/lib/bop-adapters/_html_extract.mjs";

type Finding = { title: string; url?: string };
const extract = (html: string): Finding[] => extractFindingsFromHtml(html, "https://ago.mo.gov/news/");

describe("extractFindingsFromHtml: one finding per press release", () => {
  it("drops a heading that wraps the same link (MO AG, 2026-10-25)", () => {
    const html = `<h3><a href="/press/shaman">American Shaman Agrees to Suspend Sales of Kratom and 7-OH in Missouri</a></h3>`;
    const out = extract(html);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://ago.mo.gov/press/shaman");
  });

  it("drops a heading when the link text adds a date (GA AG)", () => {
    const html = `<h2>Carr Calls on Convenience Stores to Remove Dangerous Kratom Products Immediately</h2>
      <a href="/release/1">Carr Calls on Convenience Stores to Remove Dangerous Kratom Products Immediately October 23, 2026</a>`;
    expect(extract(html).filter((f) => !f.url)).toHaveLength(0);
  });

  it("drops a table row that is the link plus a date", () => {
    const html = `<table><tr><td><a href="/p/2">St. Louis-Area Distributor to Suspend Sales of Kratom Products</a></td><td>Oct 2, 2026</td></tr></table>`;
    expect(extract(html).filter((f) => !f.url)).toHaveLength(0);
  });

  it("keeps a row that says much more than its link", () => {
    const html = `<table><tr><td>Rule 2026-14: amend the controlled substances list to add kratom alkaloids and their salts</td>
      <td><a href="/r/14.pdf">Notice of Proposed Rule</a></td></tr></table>`;
    const out = extract(html);
    expect(out.some((f) => !f.url && /kratom/.test(f.title))).toBe(true);
  });

  it("keeps a heading with no matching link (UT DHHS)", () => {
    const html = `<h2>Utah health officials warn of fatal overdoses involving kratom products</h2><a href="/more">Read more</a>`;
    expect(extract(html).some((f) => !f.url)).toBe(true);
  });
});

describe("extractFindingsFromHtml: entities", () => {
  it("decodes numeric and typographic entities", () => {
    const html = `<h2>Utah warns of illegal &#8220;cat&#8217;s claw&#8221; &amp; kratom products &mdash; &#x2014; update</h2>`;
    expect(extract(html)[0].title).toBe("Utah warns of illegal “cat’s claw” & kratom products — — update");
  });
});
