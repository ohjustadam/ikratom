import { describe, it, expect } from "vitest";
import { headlineStates, newsStateFromBody, newsStateFromTitle } from "../scripts/lib/news-state.mjs";

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
  it("reads AP abbreviations, demonyms and 'Place, ST'", () => {
    expect(newsStateFromTitle("Pending Pa. bills would regulate kratom sales", "MD")).toBe("PA");
    expect(newsStateFromTitle("Kratom vs. 7-OH: What experts want S.C. lawmakers to know", "NC")).toBe("SC");
    expect(newsStateFromTitle("Local group says many Kansans dealing with kratom withdrawals", "HI")).toBe("KS");
    expect(newsStateFromTitle("Castle Rock, CO Bans Retail Kratom Sales in November", "CO")).toBe("CO");
    expect(newsStateFromTitle("U.Va. experts warn against emerging substances kratom, cychlorphine", "VA")).toBe("VA");
    expect(newsStateFromTitle("Kratom products remain unregulated in Pa. It's led to deadly consequences", "PA")).toBe("PA");
  });
  it("does not read titles, newspapers or verbs as states", () => {
    expect(headlineStates("Del. Byron files kratom bill")).toEqual(new Set());
    expect(headlineStates("The Tennessean: kratom shops face new rules")).toEqual(new Set());
    expect(headlineStates("Council Withdraws Support for Dispensary, OK’s Manufacturing Site")).toEqual(new Set());
    expect(headlineStates("Barge traffic on the Mississippi River")).toEqual(new Set());
  });
  it("leaves federal (null scope) stories alone", () => {
    expect(newsStateFromTitle("Utah warns on kratom", null)).toBeNull();
  });
});

// Bodies abridged from real stories misfiled before 2026-10-29.
const oxford = [
  "Two University of Mississippi students died on Monday, sparking an investigation.",
  "The Oxford Police Department shared a news release from Lafayette County Metro Narcotics.",
  "Shawnboda Mead, vice-chancellor at the University of Mississippi, confirmed both were students.",
  "News of the deaths came after Mississippi's victory on Saturday over Louisiana State University.",
  "Deputies in Lafayette County, Mississippi, are assisting the investigation.",
];

describe("newsStateFromBody", () => {
  const title = "Oxford police investigate 2 university student deaths, warn against using kratom";
  it("moves a story whose body is plainly about another state", () => {
    expect(newsStateFromBody({ title, paragraphs: oxford, source: "WLBT", scope: "LA" })).toBe("MS");
  });
  it("lets an outlet named for a state move a stub that never names the query state", () => {
    expect(newsStateFromBody({ title, paragraphs: ["Police warn against kratom after two deaths."], source: "Mississippi Today", scope: "LA" })).toBe("MS");
    expect(newsStateFromBody({ title, paragraphs: [oxford[0], oxford[2], oxford[3]], source: "Mississippi Today", scope: "LA" })).toBe("MS");
  });
  it("needs a body, and ignores national papers named for a city", () => {
    expect(newsStateFromBody({ title: "SF man dies after taking kratom-like product", paragraphs: [], source: "Mississippi Today", scope: "CA" })).toBe("CA");
    expect(newsStateFromBody({ title: "SF man dies after taking kratom-like product", paragraphs: ["A man died."], source: "New York Post", scope: "CA" })).toBe("CA");
  });
  it("keeps the query state on weak or noisy evidence", () => {
    // Nicknames don't count: "Ole Miss" is in every story about the deaths.
    const castle = ["Castle Rock council voted Tuesday.", "It cited the Ole Miss deaths.", "Ole Miss students died.", "An Ole Miss probe continues."];
    expect(newsStateFromBody({ title: "Town bans retail kratom sales", paragraphs: castle, source: "Hoodline", scope: "CO" })).toBe("CO");
    // Station promos name a state twice in two paragraphs: not enough.
    const promos = ["Signs went up outside the new shop.", "KSLA is LIVE at the State Fair of Louisiana with Louisiana 4H.", "KSLA was LIVE at the State Fair of Louisiana."];
    expect(newsStateFromBody({ title: "Neighbors object to vape and kratom shop", paragraphs: promos, source: "WOWT", scope: "NE" })).toBe("NE");
    // A story that names its own state about as often as another stays.
    const both = ["Louisiana banned kratom.", "Mississippi may follow.", "Mississippi lawmakers met.", "Louisiana officials testified."];
    expect(newsStateFromBody({ title: "Neighbors weigh kratom rules", paragraphs: both, source: "WWL", scope: "LA" })).toBe("LA");
  });
  it("defers to a headline that names a state", () => {
    expect(newsStateFromBody({ title: "Louisiana adds kratom substances to Schedule I", paragraphs: oxford, source: "Mississippi Today", scope: "LA" })).toBe("LA");
    expect(newsStateFromBody({ title: "Why did TN ban kratom?", paragraphs: oxford, source: "WLBT", scope: "LA" })).toBe("TN");
    expect(newsStateFromBody({ title, paragraphs: oxford, source: "WLBT", scope: null })).toBeNull();
  });
});
