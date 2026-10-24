import { describe, it, expect } from "vitest";
import { headlineStates, newsStateFromTitle } from "../scripts/lib/news-state.mjs";

// Real headlines filed under LA by the per-state query before 2026-10-23.
describe("newsStateFromTitle", () => {
  it("moves a story that names only another state", () => {
    expect(newsStateFromTitle("Why did TN ban kratom? What to know about 'gas station heroin'", "LA")).toBe("TN");
    expect(newsStateFromTitle("Officials issue warning after 4 Utah deaths linked to 'cat's claw,' kratom products", "LA")).toBe("UT");
    expect(newsStateFromTitle("Prosecutors probing deaths of 2 Ole Miss students charge shop clerk", "LA")).toBe("MS");
  });
  it("lets a spelled-out state outrank a nickname", () => {
    expect(newsStateFromTitle("Why did TN ban kratom? What to know in wake of Ole Miss students deaths", "LA")).toBe("TN");
    expect(newsStateFromTitle("Ole Miss deaths: 2 students dead after weekend hosting LSU football", "NY")).toBe("MS");
  });
  it("keeps a story that names its own state, even alongside others", () => {
    expect(newsStateFromTitle("Louisiana adds kratom substances to state's schedule I list", "LA")).toBe("LA");
    expect(newsStateFromTitle("Did Louisiana make kratom illegal? What to know after Ole Miss deaths", "LA")).toBe("LA");
  });
  it("keeps the query state when the headline names no state or several", () => {
    expect(newsStateFromTitle("Kratom-like substances are popping up in a typically benign supplement", "LA")).toBe("LA");
    expect(newsStateFromTitle("Texas and Tennessee move on kratom", "LA")).toBe("LA");
    expect(newsStateFromTitle("LDH adds kratom substances to illegal drugs list", "LA")).toBe("LA");
  });
  it("never reads ambiguous words or city names as a state", () => {
    expect(headlineStates("Kratom shop opens IN downtown; OK says mayor")).toEqual(new Set());
    expect(newsStateFromTitle("Kansas City council weighs kratom ban", "MO")).toBe("MO");
    expect(newsStateFromTitle("LA County bans kratom sales", "CA")).toBe("CA");
    expect(newsStateFromTitle("Washington lawmakers hear kratom testimony", "OR")).toBe("OR");
  });
  it("leaves federal (null scope) stories alone", () => {
    expect(newsStateFromTitle("Utah warns on kratom", null)).toBeNull();
  });
});
