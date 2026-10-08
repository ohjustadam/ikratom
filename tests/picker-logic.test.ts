import { describe, it, expect } from "vitest";
import {
  groupByRole,
  defaultCollapsed,
  togglePicked,
  setGroupPicked,
  buildTargetsParam,
  COLLAPSE_OVER,
} from "@/modules/campaigns/picker-logic";

/** A Massachusetts-shaped legislature: 40 senators, 158 representatives. */
function maLegislature() {
  const reps = [];
  for (let i = 1; i <= 40; i++) {
    reps.push({ id: `sen-${i}`, role: "state_senate", full_name: `Senator ${String(i).padStart(3, "0")}`, district: `S${String(i).padStart(3, "0")}` });
  }
  for (let i = 1; i <= 158; i++) {
    reps.push({ id: `rep-${i}`, role: "state_house", full_name: `Rep ${String(i).padStart(3, "0")}`, district: `H${String(i).padStart(3, "0")}` });
  }
  return reps;
}

describe("groupByRole", () => {
  it("splits a real legislature into its chambers without losing anyone", () => {
    const g = groupByRole(maLegislature());
    expect(g.get("state_senate")).toHaveLength(40);
    expect(g.get("state_house")).toHaveLength(158);
    expect([...g.values()].reduce((a, v) => a + v.length, 0)).toBe(198);
  });

  it("orders by district so the list is scannable", () => {
    const g = groupByRole([
      { id: "c", role: "state_house", full_name: "Zed", district: "H003" },
      { id: "a", role: "state_house", full_name: "Amy", district: "H001" },
      { id: "b", role: "state_house", full_name: "Bob", district: "H002" },
    ]);
    expect(g.get("state_house")!.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to name when districts are missing", () => {
    const g = groupByRole([
      { id: "z", role: "mayor", full_name: "Zeta", district: null },
      { id: "a", role: "mayor", full_name: "Alpha", district: null },
    ]);
    expect(g.get("mayor")!.map((r) => r.id)).toEqual(["a", "z"]);
  });
});

describe("defaultCollapsed", () => {
  it("collapses BOTH chambers of a full legislature", () => {
    // The concrete bug: rendering 158 rows open pushed every other chamber and
    // the send button out of the scroll viewport.
    //
    // This assertion originally claimed the 40-seat Senate stayed OPEN and
    // failed — 40 is over the threshold too. The threshold was right and the
    // expectation was wrong: for a 198-member legislature the useful default
    // is two closed headers, "State Sen. (40)" and "State Rep. (158)", which
    // the reader opens on demand. 40 rows in a max-h-72 scroller is still a
    // wall of names.
    const c = defaultCollapsed(maLegislature());
    expect(c.has("state_house")).toBe(true);
    expect(c.has("state_senate")).toBe(true);
  });

  it("leaves a mid-size chamber open when it fits", () => {
    // A 12-seat body (a council, a small delegation) is readable at a glance,
    // so collapsing it would add a click for nothing.
    const small = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`, role: "city_council", full_name: `Member ${i}`,
    }));
    expect(defaultCollapsed(small).size).toBe(0);
  });

  it("leaves a small delegation open — collapsing 3 rows helps nobody", () => {
    const c = defaultCollapsed([
      { id: "1", role: "us_senate", full_name: "A" },
      { id: "2", role: "us_senate", full_name: "B" },
    ]);
    expect(c.size).toBe(0);
  });

  it("collapses strictly ABOVE the threshold, not at it", () => {
    const atLimit = Array.from({ length: COLLAPSE_OVER }, (_, i) => ({ id: `x${i}`, role: "r", full_name: `n${i}` }));
    expect(defaultCollapsed(atLimit).size).toBe(0);
    expect(defaultCollapsed([...atLimit, { id: "extra", role: "r", full_name: "n" }]).has("r")).toBe(true);
  });
});

describe("togglePicked", () => {
  it("adds then removes, without mutating the original set", () => {
    const a = new Set<string>();
    const b = togglePicked(a, "x");
    expect(a.size).toBe(0); // immutability matters: React state
    expect(b.has("x")).toBe(true);
    expect(togglePicked(b, "x").has("x")).toBe(false);
  });
});

describe("setGroupPicked", () => {
  const all = maLegislature();
  const groups = groupByRole(all);

  it("selects a whole chamber in one action", () => {
    const picked = setGroupPicked(new Set(), groups.get("state_senate")!, true);
    expect(picked.size).toBe(40);
  });

  it("leaves OTHER chambers untouched — 'all senators, no reps'", () => {
    // This is the property that makes per-chamber select-all worth having.
    let picked = setGroupPicked(new Set(), groups.get("state_senate")!, true);
    picked = setGroupPicked(picked, groups.get("state_house")!, true);
    expect(picked.size).toBe(198);
    picked = setGroupPicked(picked, groups.get("state_house")!, false);
    expect(picked.size).toBe(40);
    expect([...picked].every((id) => id.startsWith("sen-"))).toBe(true);
  });

  it("clearing a group it does not hold is a no-op, not a corruption", () => {
    const picked = setGroupPicked(new Set(["sen-1"]), groups.get("state_house")!, false);
    expect(picked.size).toBe(1);
    expect(picked.has("sen-1")).toBe(true);
  });
});

describe("buildTargetsParam", () => {
  it("returns null when nothing is picked", () => {
    expect(buildTargetsParam(new Set(), 198)).toBeNull();
  });

  it("enumerates ids for a partial selection", () => {
    expect(buildTargetsParam(new Set(["a", "b"]), 198)).toBe("a,b");
  });

  it("uses the 'all' sentinel for a full selection instead of a 7 KB URL", () => {
    // 198 UUIDs is ~7.4 KB of query string — past what several servers and
    // proxies accept, and the reason this sentinel exists.
    const all = maLegislature();
    const picked = new Set(all.map((r) => r.id));
    expect(buildTargetsParam(picked, all.length)).toBe("all");
  });

  it("does NOT claim 'all' when the available count is unknown", () => {
    // A 0 total with a non-empty selection must not resolve to "all" — that
    // would silently widen the send beyond what the user ticked.
    expect(buildTargetsParam(new Set(["a"]), 0)).toBe("a");
  });
});
