/**
 * meeting-autoapprove.test.ts — a machine may only publish a meeting whose
 * confidence a MACHINE did not make up.
 *
 * auto-approve-meetings.mjs puts rows on the public /calendar and fires push
 * reminders with no human click. On 2026-09-17 two live "meetings" were a law's
 * effective date and a ban's expiry, auto-approved at a model's own 0.95. See
 * scripts/lib/meeting-autoapprove.mjs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  VERIFIED_VIA,
  HUMAN_REVIEW_VIA,
  VERIFIED_VIA_LIST,
  isAutoApprovable,
} from "../scripts/lib/meeting-autoapprove.mjs";

const NOW = new Date("2026-09-17T12:00:00Z");
const POLICY = { minConf: 0.85, requireSource: true, now: NOW };
const row = (over: Record<string, unknown> = {}) => ({
  discovered_via: "legistar_fetch",
  ai_confidence: 0.95,
  source_url: "https://cityofx.legistar.com/MeetingDetail.aspx?ID=1",
  meeting_at: "2026-10-06T23:00:00Z",
  ...over,
});

describe("isAutoApprovable — provenance before confidence", () => {
  it("publishes a confident, sourced, future row from a code-scored writer", () => {
    expect(isAutoApprovable(row(), POLICY).ok).toBe(true);
    expect(isAutoApprovable(row({ discovered_via: "searxng_verified", ai_confidence: 0.9 }), POLICY).ok).toBe(true);
  });

  it("REGRESSION 2026-09-17: a model-scored news row at 0.95 is held, however confident", () => {
    // The live Naperville row: "Ban on retail sale of kratom products effective".
    const r = isAutoApprovable(row({ discovered_via: "news_article", ai_confidence: 0.95 }), POLICY);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unverified provenance/);
  });

  it("holds every human-review writer even at confidence 1.0", () => {
    for (const via of Object.keys(HUMAN_REVIEW_VIA)) {
      expect(isAutoApprovable(row({ discovered_via: via, ai_confidence: 1 }), POLICY).ok, via).toBe(false);
    }
  });

  it("fails closed on unknown, missing, or look-alike provenance", () => {
    for (const via of [null, undefined, "", "unknown_new_writer", "SEARXNG_VERIFIED", "searxng_verified ", "__proto__", "toString"]) {
      expect(isAutoApprovable(row({ discovered_via: via }), POLICY).ok, String(via)).toBe(false);
    }
  });

  it("still applies the confidence, source and future-date gates to verified writers", () => {
    expect(isAutoApprovable(row({ ai_confidence: 0.84 }), POLICY).ok).toBe(false);
    expect(isAutoApprovable(row({ ai_confidence: null }), POLICY).ok).toBe(false);
    expect(isAutoApprovable(row({ ai_confidence: "0.9" as unknown as number, discovered_via: "legistar_fetch" }), POLICY).ok).toBe(true);
    expect(isAutoApprovable(row({ source_url: "" }), POLICY).ok).toBe(false);
    expect(isAutoApprovable(row({ source_url: "" }), { ...POLICY, requireSource: false }).ok).toBe(true);
    expect(isAutoApprovable(row({ meeting_at: "2026-09-01T00:00:00Z" }), POLICY).ok).toBe(false);
    expect(isAutoApprovable(row({ meeting_at: "not a date" }), POLICY).ok).toBe(false);
  });

  it("keeps the two maps disjoint and the list in step with the map", () => {
    for (const via of Object.keys(VERIFIED_VIA)) expect(Object.hasOwn(HUMAN_REVIEW_VIA, via), via).toBe(false);
    expect([...VERIFIED_VIA_LIST].sort()).toEqual(Object.keys(VERIFIED_VIA).sort());
  });
});

describe("every writer is classified — a new one cannot slip through unreviewed", () => {
  function scriptFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) scriptFiles(p, out);
      else if (name.endsWith(".mjs")) out.push(p);
    }
    return out;
  }
  // A writer sets the column with a literal. Scanning, not listing, is the point:
  // a hand-kept list is how three earlier guards in this repo went blind.
  const WRITE_RX = /discovered_via:\s*["'`]([a-z0-9_]+)["'`]/g;
  const found = new Map<string, string>();
  for (const f of scriptFiles("scripts")) {
    for (const m of readFileSync(f, "utf8").matchAll(WRITE_RX)) found.set(m[1], f);
  }

  it("finds the writers at all (guards against a scan that silently matches nothing)", () => {
    expect(found.size).toBeGreaterThanOrEqual(8);
    expect(found.has("news_article")).toBe(true);
    expect(found.has("legistar_fetch")).toBe(true);
  });

  it("classifies every discovered_via value written anywhere in scripts/", () => {
    const unclassified = [...found]
      .filter(([via]) => !Object.hasOwn(VERIFIED_VIA, via) && !Object.hasOwn(HUMAN_REVIEW_VIA, via))
      .map(([via, file]) => `${via} (${file})`);
    expect(
      unclassified,
      `\nUnclassified meeting writer(s). Decide whether a MODEL authors their ai_confidence:\n`
        + `  code-scored  -> add to VERIFIED_VIA\n  model-scored -> add to HUMAN_REVIEW_VIA\n`
        + `in scripts/lib/meeting-autoapprove.mjs.\n  ${unclassified.join("\n  ")}\n`,
    ).toEqual([]);
  });

  it("never lists a model-calling writer as verified", () => {
    // A VERIFIED writer's own source must not call a model directly. The
    // meeting-discover path is exempt by design: its model answers multiple
    // choice and code assigns confidence (pinned in meeting-discover.test.ts).
    const MODEL_CALL = /aiRouter\(|generativelanguage\.googleapis|groundedGenerate\(/;
    const EXEMPT = new Set(["searxng_verified", "gemini_lead_verified"]);
    const offenders = [...found]
      .filter(([via]) => Object.hasOwn(VERIFIED_VIA, via) && !EXEMPT.has(via))
      .filter(([, file]) => MODEL_CALL.test(readFileSync(file, "utf8")))
      .map(([via, file]) => `${via} (${file})`);
    expect(offenders).toEqual([]);
  });
});

describe("auto-approve-meetings.mjs actually uses the gate", () => {
  const src = readFileSync("scripts/auto-approve-meetings.mjs", "utf8");
  it("filters the candidate query by verified provenance", () => {
    expect(src).toMatch(/\.in\(\s*["']discovered_via["']\s*,\s*VERIFIED_VIA_LIST\s*\)/);
  });
  it("runs every candidate through isAutoApprovable before approving", () => {
    expect(src).toMatch(/isAutoApprovable\(m,/);
    expect(src).not.toMatch(/!requireSource \|\| \(m\.source_url/); // the old confidence-only filter
  });
});
