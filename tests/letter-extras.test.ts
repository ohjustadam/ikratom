import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LETTER_FOOTER, appendClipLine, clipLine, withLetterFooter } from "../src/modules/campaigns/letter-extras";
import { adaptForHiddenHome, adaptForNonResident, buildVars, renderTemplate, unfilledPlaceholders } from "../src/modules/campaigns/templates";
import { buildMailtoUrl } from "../src/modules/compose/send-links";
import type { Legislator } from "../src/lib/legislators";

/**
 * Paul's reports, 2026-10-24: the clip recorder never reached a letter, and the
 * owner wants every letter to say, quietly, which service it came from. These
 * pin the two lines iKratom adds and that every send path adds them.
 */

const leg = { id: "x", state: "NC", role: "state_house", full_name: "Mark Pless", title: null } as unknown as Legislator;
const paul = { full_name: "Paul E.", username: "paul", street: "1 Main", city: "Gulfport", state: "MS", zip: "39501" };
const CLIP = "https://abc.supabase.co/storage/v1/object/public/campaign-attachments/u1/c1.m4a";
const letter =
  "Dear {{recipient_title}} {{recipient_last_name}},\n\nPlease protect natural kratom.\n\nSincerely,\n{{full_name}}\n{{city}}, {{state}}";

/** Exactly what drainBatch, waves and the legacy send do per official. */
const sendRender = (tpl: string) => withLetterFooter(renderTemplate(tpl, buildVars(paul, leg, [leg])));

describe("the footer", () => {
  it("closes the letter after the sender's name", () => {
    const out = sendRender(letter);
    expect(out.endsWith(`Paul E.\nGulfport, MS\n\n${LETTER_FOOTER}`)).toBe(true);
    expect(LETTER_FOOTER).toBe("Sent via iKratom.org");
  });

  it("is plain: no link, no tracking, no placeholder", () => {
    expect(LETTER_FOOTER).not.toMatch(/https?:|\?|utm|\{\{/i);
    expect(unfilledPlaceholders(sendRender(letter))).toEqual([]);
  });

  it("is added once, however often a letter is rendered", () => {
    const once = withLetterFooter("Hi\n\nPaul");
    expect(withLetterFooter(once)).toBe(once);
    expect(withLetterFooter(`${once}\n\n  `)).toBe(once);
    expect(once.match(/Sent via iKratom\.org/g)).toHaveLength(1);
  });

  it("survives banned-state safe mode, which rewrites the template, not the rendered letter", () => {
    const out = withLetterFooter(renderTemplate(adaptForHiddenHome(letter), buildVars(paul, leg, [leg])));
    expect(out).not.toContain("Gulfport");
    expect(out.endsWith(LETTER_FOOTER)).toBe(true);
  });

  it("rides in the mailto body", () => {
    const url = buildMailtoUrl("rep@ncleg.gov", "Kratom", withLetterFooter("Hello"));
    expect(decodeURIComponent(url.split("body=")[1])).toBe(`Hello\n\n${LETTER_FOOTER}`);
  });
});

describe("the clip line", () => {
  it("is one plain line with the real length", () => {
    expect(clipLine({ kind: "audio", url: CLIP, durationSeconds: 30 })).toBe(`Listen to my 30-second message: ${CLIP}`);
    expect(clipLine({ kind: "video", url: CLIP, durationSeconds: 12.4 })).toBe(`Watch my 12-second video message: ${CLIP}`);
    expect(clipLine({ kind: "audio", url: CLIP, durationSeconds: 99 })).toContain("30-second");
  });

  it("re-recording replaces the earlier clip instead of stacking two", () => {
    const one = appendClipLine(letter, { kind: "audio", url: CLIP, durationSeconds: 20 });
    const two = appendClipLine(one, { kind: "video", url: `${CLIP}?v=2`, durationSeconds: 25 });
    expect(two.match(/second (video )?message:/g)).toHaveLength(1);
    expect(two).toContain("Watch my 25-second video message");
  });

  it("reaches the rendered letter, before the footer, with nothing left unfilled", () => {
    const body = appendClipLine(letter, { kind: "audio", url: CLIP, durationSeconds: 30 });
    const out = sendRender(body);
    expect(out).toContain(`Gulfport, MS\n\nListen to my 30-second message: ${CLIP}\n\n${LETTER_FOOTER}`);
    expect(unfilledPlaceholders(out)).toEqual([]);
  });

  it("is left alone by the non-resident and safe-mode rewrites", () => {
    const body = appendClipLine(letter, { kind: "audio", url: CLIP, durationSeconds: 30 });
    expect(adaptForNonResident(body)).toContain(`Listen to my 30-second message: ${CLIP}`);
    expect(adaptForHiddenHome(body)).toContain(`Listen to my 30-second message: ${CLIP}`);
  });
});

describe("every send path closes with the footer", () => {
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  it.each([
    ["modules/campaigns/drain-batch.ts", /withLetterFooter\(renderTemplate\(batch\.body_template/],
    ["modules/waves/fire.ts", /withLetterFooter\(renderTemplate\(effBody/],
    ["modules/campaigns/actions.ts", /withLetterFooter\(renderTemplate\(bodyTemplate/],
    ["modules/campaigns/components/CampaignAction.tsx", /outBody = withLetterFooter\(renderTemplate\(body, groupFill\)\)/],
    ["modules/compose/ComposeModal.tsx", /letter = withLetterFooter\(body\)/],
    ["modules/compose/GroupComposeModal.tsx", /letter = withLetterFooter\(body\)/],
  ])("%s", (file, re) => {
    expect(src(file)).toMatch(re);
  });

  it("the footer is checked after rendering, so the unfilled guard still sees the whole letter", () => {
    const drain = src("modules/campaigns/drain-batch.ts");
    expect(drain.indexOf("withLetterFooter(renderTemplate")).toBeLessThan(drain.indexOf("unfilledPlaceholders(`${subject}\\n${body}`)"));
  });
});
