import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { briefingAudioScript, stripElementByClass, speakify, spokenDate } from "../briefing-audio";
import { frontmatterString } from "../frontmatter";

/**
 * Guards the "Listen" (TTS) script for briefings.
 *
 * Briefings embed raw HTML — scoped <style>, inline <svg> figures, layout
 * <div>s, citation tables. AudioReader speaks its `text` prop verbatim, so if
 * markup ever leaks the reader starts reciting CSS declarations and SVG
 * coordinates. That failure is silent: nothing throws, the audio is just
 * garbage. These run against every briefing so a new one can't regress it.
 */

const DIR = path.join(process.cwd(), "src", "content", "briefings");
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".md")) : [];

function scriptFor(file: string): string {
  const { data, content } = matter(fs.readFileSync(path.join(DIR, file), "utf8"));
  return briefingAudioScript({
    title: frontmatterString(data.title) ?? file,
    subtitle: frontmatterString(data.subtitle),
    published: frontmatterString(data.published),
    content,
  });
}

describe("stripElementByClass", () => {
  it("removes the element and its whole subtree", () => {
    const out = stripElementByClass('<p>keep</p><div class="cover">drop<span>me</span></div><p>also keep</p>', "cover");
    expect(out).toBe("<p>keep</p><p>also keep</p>");
  });

  it("counts nesting so an inner close tag doesn't end the match early", () => {
    const html = '<div class="cover">a<div>inner</div>b</div><p>survives</p>';
    expect(stripElementByClass(html, "cover")).toBe("<p>survives</p>");
  });

  it("removes every instance, not just the first", () => {
    const html = '<div class="k7-board">1</div><p>mid</p><div class="k7-board">2</div>';
    expect(stripElementByClass(html, "k7-board")).toBe("<p>mid</p>");
  });

  it("leaves a different class alone", () => {
    const html = '<div class="keeper">stay</div>';
    expect(stripElementByClass(html, "cover")).toBe(html);
  });
});

describe("speakify", () => {
  it("expands legal and chemical shorthand", () => {
    expect(speakify("21 CFR 1308.11")).toContain("C F R");
    expect(speakify("21 U.S.C. 811(h)")).toContain("U S C");
    expect(speakify("§ 1308.11(d)")).toContain("Section");
    expect(speakify("7-OH")).toBe("seven O H");
    expect(speakify("MGM-15")).toBe("M G M 15");
    expect(speakify("GC-MS")).toContain("mass spec");
  });

  it("unpacks subscripted formulae into spoken digits", () => {
    expect(speakify("C₂₃H₃₀N₂O₅").replace(/\s+/g, " ").trim()).toBe("C 23 H 30 N 2 O 5");
  });

  it("turns symbols into words", () => {
    expect(speakify("a & b")).toBe("a and b");
    expect(speakify("MP · thing")).toContain(", ");
    expect(speakify("≈ 5")).toContain("approximately");
  });
});

describe("spokenDate", () => {
  it("renders ISO dates as spoken dates", () => {
    expect(spokenDate("2026-08-24")).toBe("August 24, 2026");
    expect(spokenDate("2026-01-01")).toBe("January 1, 2026");
  });

  it("does not shift the day across timezones", () => {
    // A bare `new Date("2026-08-24")` is UTC midnight, which is Aug 23 in the US.
    expect(spokenDate("2026-08-24")).not.toContain("23");
  });

  it("passes non-ISO input through untouched", () => {
    expect(spokenDate("Summer 2026")).toBe("Summer 2026");
  });
});

describe("briefing audio scripts", () => {
  it("finds at least one briefing to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s produces speakable text with no markup leakage", (file) => {
    const text = scriptFor(file);

    expect(text.length).toBeGreaterThan(200);

    // No CSS leaked from a scoped <style> block.
    expect(text).not.toMatch(/\{[^}]*:[^}]*\}/);
    expect(text).not.toContain("@media");
    expect(text).not.toMatch(/#[0-9a-f]{6}\b/i);
    expect(text).not.toMatch(/\b(font-size|border-radius|grid-template-columns)\b/);

    // No SVG internals leaked.
    expect(text).not.toContain("viewBox");
    expect(text).not.toMatch(/\b(stroke-width|text-anchor|stroke-dasharray)\b/);

    // No raw tags, class hooks, or unresolved entities survived.
    expect(text).not.toMatch(/<\/?[a-z][a-z0-9]*[\s>]/i);
    expect(text).not.toMatch(/\bk7-[a-z]+\b/);
    expect(text).not.toMatch(/&(amp|lt|gt|quot|#\d+);/);

    // Opens with a spoken intro, not raw chrome.
    expect(text).toMatch(/An iKratom policy briefing/);
    // The cover slab's fragmentary labels must not be narrated.
    expect(text).not.toMatch(/^\s*Prepared by\s*$/m);
  });

  it("the 7-OH packet still speaks its load-bearing facts", () => {
    const file = "7-oh-scheduling-2026.md";
    if (!files.includes(file)) return;
    const text = scriptFor(file);

    expect(text).toContain("August 26, 2026");
    expect(text).toContain("August 26, 2028");
    expect(text).toContain("mitragynine pseudoindoxyl");
    expect(text).toMatch(/not scheduled/i);
    // Figures are dropped from audio, so the prose must carry their numbers.
    expect(text).toMatch(/1\.00 mg/);
    expect(text).toMatch(/2\.5 to 8\.8 grams/);
    // Long-form: worth a transport, not a one-shot blurb.
    expect(text.split(/\s+/).length).toBeGreaterThan(1500);
  });
});
