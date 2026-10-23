/**
 * story-dedupe — one story from many outlets must notify once. Headlines are
 * the real ones Louisiana members were pushed (Sep–Oct 2026).
 */
import { describe, it, expect } from "vitest";
import { headlineWords, sameStory, dedupeStories } from "../scripts/lib/story-dedupe.mjs";
import { mentionedStates } from "../scripts/lib/us-states.mjs";

const w = (t: string) => headlineWords(t);

describe("sameStory", () => {
  it("collapses the same event from different outlets", () => {
    expect(sameStory(
      w("Louisiana adds kratom substances to state’s schedule I list"),
      w("Louisiana adds kratom substances to state's schedule I list"),
    )).toBe(true);
    expect(sameStory(
      w("Two Ole Miss students found dead; kratom discovered at both scenes. Here's what we know"),
      w("Ole Miss deaths: 2 Ole Miss students dead after weekend hosting LSU football; packaged kratom found"),
    )).toBe(true);
  });

  it("keeps different stories apart", () => {
    expect(sameStory(
      w("Synthetic opioids being sold as kratom following Ole Miss student deaths, experts say"),
      w("Louisiana adds kratom substances to state’s schedule I list"),
    )).toBe(false);
  });

  it("never matches on a headline too short to judge", () => {
    expect(sameStory(w("Kratom news"), w("Kratom news today"))).toBe(false);
  });
});

describe("dedupeStories", () => {
  it("keeps the first of each story and drops exact link repeats", () => {
    const kept = dedupeStories([
      { title: "Louisiana adds kratom substances to state’s schedule I list", link: "a" },
      { title: "Louisiana adds kratom substances to state's schedule I list", link: "b" },
      { title: "Something else entirely about hearings", link: "a" },
      { title: "Oklahoma committee hears kratom testimony from veterans", link: "c" },
    ]);
    expect(kept.map((k: { link: string }) => k.link)).toEqual(["a", "c"]);
  });
});

describe("other-state guard input", () => {
  it("sees a Utah headline as not about Louisiana", () => {
    const named = mentionedStates("Officials issue warning after 4 Utah deaths linked to ‘cat’s claw,’ kratom products");
    expect(named.has("UT")).toBe(true);
    expect(named.has("LA")).toBe(false);
  });
});
