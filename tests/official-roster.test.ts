import { describe, expect, it } from "vitest";
import { pageTokens, indexTokens, nameOnPage, vouch, seatEvidence, emailFor, pastSession } from "../scripts/lib/official-roster.mjs";

const page = (html: string) => indexTokens(pageTokens(html));

describe("nameOnPage", () => {
  const roster = page(`
    <table><tr><td>Rep. Marshall Rawson (R)</td><td>District 10</td></tr>
    <tr><td>Bradley, John</td><td>3</td></tr>
    <tr><td>Ruth De La Cruz</td><td>7</td></tr>
    <tr><td>Dean VanSchoiack</td></tr>
    <tr><td>T.J. Roberts</td></tr>
    <tr><td>David Jacoby</td></tr>
    <tr><td>Jane Smith</td></tr><tr><td>John Doe</td></tr></table>`);

  it("reads the usual formats", () => {
    expect(nameOnPage("Marshall Rawson", roster)).toBe(true);
    expect(nameOnPage("John Bradley", roster)).toBe(true);
    expect(nameOnPage("Ruth De La Cruz", roster)).toBe(true);
    expect(nameOnPage("Dean Van Schoiack", roster)).toBe(true);
    expect(nameOnPage("T.J. Roberts", roster)).toBe(true);
  });

  it("a short form counts, another first name does not", () => {
    expect(nameOnPage("Dave Jacoby", roster)).toBe(true);
    expect(nameOnPage("Mary Rawson", roster)).toBe(false);
    expect(nameOnPage("Ann Bradley", roster)).toBe(false);
  });

  it("never reads a name across two entries", () => {
    // "Jane Smith | John Doe": John Smith is not here.
    expect(nameOnPage("John Smith", roster)).toBe(false);
  });

  it("loose matching (proving someone is gone) needs only the first letter", () => {
    expect(nameOnPage("Mitch Rawson", roster)).toBe(false);
    expect(nameOnPage("Mitch Rawson", roster, { loose: true })).toBe(true);
  });

  it("reads a JSON member list", () => {
    const json = page(JSON.stringify({ Data: [{ PersonFullName: "Nnamdi O. Chukwuocha", DistrictNumber: 1 }, { PersonFullName: "Kim Williams" }] }));
    expect(nameOnPage("Nnamdi Chukwuocha", json)).toBe(true);
    expect(nameOnPage("Kim Williams", json)).toBe(true);
  });
});

describe("vouch and seatEvidence", () => {
  const names = ["Ann Able", "Bob Baker", "Cal Carter", "Dee Dunn", "Eve Evans", "Fay Fox"];
  const list = (xs: string[]) => page(xs.map((n) => `<li>${n}</li>`).join(""));

  it("a page vouches only when it lists nearly every member who stays", () => {
    expect(vouch(names, list(names)).vouches).toBe(true);
    expect(vouch(names, list(names.slice(0, 4))).vouches).toBe(false);
    expect(vouch(names.slice(0, 3), list(names)).vouches).toBe(false); // too few to judge
  });

  it("a seat changes hands only when the winner is listed and the outgoing member is not", () => {
    const seat = { winner_name: "Gus Grant", incumbent_name: "Hal Hunt" };
    expect(seatEvidence(seat, list([...names, "Gus Grant"]))).toBe("in");
    expect(seatEvidence(seat, list([...names, "Gus Grant", "Hal Hunt"]))).toBe("both");
    expect(seatEvidence(seat, list([...names, "Hal Hunt"]))).toBe("absent");
    // The outgoing member listed under a short form still holds the seat.
    expect(seatEvidence({ winner_name: "Gus Grant", incumbent_name: "Henry Hunt" }, list(["Gus Grant", "Hank Hunt"]))).toBe("both");
  });
});

describe("emailFor", () => {
  const html = `<a href="mailto:rep.brian.stewart@capitol.tn.gov">Email</a> <a href="mailto:rep.bryan.stewart@capitol.tn.gov">x</a>
    <a href="mailto:rep.jessica.means@capitol.tn.gov">x</a> <a href="mailto:jessica.means@gmail.com">x</a>`;
  it("takes the one official address that is the person's", () => {
    expect(emailFor("Jessica Means", html, "https://wapp.capitol.tn.gov/apps/x")).toBe("rep.jessica.means@capitol.tn.gov");
    expect(emailFor("Brian Stewart", html, "https://wapp.capitol.tn.gov/apps/x")).toBe("rep.brian.stewart@capitol.tn.gov");
  });
  it("never one already on someone else's record", () => {
    expect(emailFor("Jessica Means", html, "https://wapp.capitol.tn.gov/apps/x", new Set(["rep.jessica.means@capitol.tn.gov"]))).toBe(null);
  });
});

describe("pastSession", () => {
  it("flags a member list for an old session", () => {
    expect(pastSession("https://www.arkleg.state.ar.us/Legislators/List?ddBienniumSession=2023%2F2023R", 2026)).toBe(true);
    expect(pastSession("https://www.legis.iowa.gov/legislators/house", 2026)).toBe(false);
    expect(pastSession("https://example.gov/members?session=2025", 2026)).toBe(false);
  });
});
