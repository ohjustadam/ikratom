import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as mjs from "../scripts/lib/official-names.mjs";
import * as ts from "../src/lib/official-names";

/**
 * The app and the scripts each keep a copy of the name matcher. Every insert
 * path into `legislators` must agree on who is "already on file", or the app
 * re-adds what the scripts deduped (2026-10-13). Same cases, both copies.
 */
const PAIRS: Array<[string, string]> = [
  ["Scott A. Wehrli", "Scott Wehrli"], ["Nate Wilson", "Nathan Wilson"], ["Frank Scott, Jr.", "Frank Scott Jr."],
  ["Rob Savidge", "Robert Savidge"], ["Josh Lilley", "Joshua Lilley"], ["Barbra Oaks", "Barbara Oaks"],
  ["Silverstein, Debra L.", "Debra Silverstein"], ["Esther Kiaʻāina", "Esther Kiaaina"], ["Brian O'Neill", "Brian ONeill"],
  ['Cornelius "CC" Calhoun', "Cornelius Calhoun"], ["José Núñez", "Jose Nunez"],
  // and different people
  ["Jamie Harris II", "Jason Harris"], ["Deborah Garrett", "Darrell Garrett"], ["Jim Duran", "Jamie Duran"],
  ["Michael J. Garcia", "Lee Garcia"], ["Smith", "John Smith"], ["", ""],
];

describe("official-names: app and scripts agree", () => {
  it.each(PAIRS)("%s / %s", (a, b) => {
    expect(ts.sameOfficial(a, b)).toBe(mjs.sameOfficial(a, b));
    expect(ts.nameParts(a)).toEqual(mjs.nameParts(a));
    expect(ts.readingOrderName(a)).toBe(mjs.readingOrderName(a));
  });

  it("the nickname tables are identical", () => {
    const table = (src: string) => src.slice(src.indexOf("NICK"), src.indexOf("};", src.indexOf("NICK")))
      .match(/\b[a-z]+: "[a-z]+"/g)?.sort();
    const a = table(readFileSync(new URL("../scripts/lib/official-names.mjs", import.meta.url), "utf8"));
    const b = table(readFileSync(new URL("../src/lib/official-names.ts", import.meta.url), "utf8"));
    expect(a?.length).toBeGreaterThan(40);
    expect(b).toEqual(a);
  });

  it("hasSameOfficial finds a variant in a roster", () => {
    expect(ts.hasSameOfficial([{ full_name: "Scott A. Wehrli" }], "Scott Wehrli")).toBe(true);
    expect(ts.hasSameOfficial([{ full_name: "Lee Garcia" }], "Michael Garcia")).toBe(false);
    expect(ts.hasSameOfficial(null, "Anyone Here")).toBe(false);
  });
});

describe("in-app insert paths use the tolerant match", () => {
  it.each(["src/lib/local-reps-auto-fulfill.ts", "src/modules/admin/local-rep-inline-actions.ts"])("%s", (p) => {
    const src = readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    expect(src).toMatch(/hasSameOfficial\(existing, /);
    expect(src).not.toMatch(/full_name\.toLowerCase\(\)/);
  });
});
