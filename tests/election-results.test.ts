import { describe, it, expect } from "vitest";
import { parseWikiResults, parseInfoboxResult, rowKey } from "../scripts/lib/election-results.mjs";

/**
 * Winner extraction from Wikipedia election tables (officials turnover, part c).
 * Fixtures copy the three shapes seen on the 2024 pages. The pre-election
 * cases matter most: a page that says "running for reelection" must yield no
 * winner, or a profile would announce a result before the vote.
 */
const wrap = (head: string, rows: string) => `<table class="wikitable">${head}${rows}</table>`;

describe("election results: winners", () => {
  it("reads an 'Elected senator' column (Illinois/Texas shape)", () => {
    const html = wrap(
      `<tr><th>State Senate District</th><th>Incumbent</th><th colspan="2">Party</th><th>Elected Senator</th><th colspan="2">Outcome</th></tr>`,
      `<tr><td>1</td><td>Javier Loera Cervantes</td><td></td><td>Dem</td><td>Javier Loera Cervantes</td><td></td><td>Dem Hold</td></tr>
       <tr><td>27</td><td>Morgan LaMantia</td><td></td><td>Dem</td><td>Adam Hinojosa</td><td></td><td>Rep Gain</td></tr>`,
    );
    const m = parseWikiResults(html);
    expect(m.get("1")).toEqual([{ incumbent: "Javier Loera Cervantes", winners: ["Javier Loera Cervantes"] }]);
    expect(m.get("27")?.[0].winners).toEqual(["Adam Hinojosa"]);
  });

  it("reads the green tick on the U.S. House page and keys by state + district", () => {
    const html = wrap(
      `<tr><th>Location</th><th>Member</th><th>Party</th><th>First elected</th><th>Status</th><th>Candidates</th></tr>`,
      `<tr><th>Alabama&nbsp;2</th><td>None (new district)</td><td></td><td></td><td>New member elected. Democratic gain.</td><td>▌ Y Shomari Figures (Democratic) 54.6% ▌ Caroleene Dobson (Republican) 45.4%</td></tr>
       <tr><th>Alaska at-large</th><td>Mary Peltola</td><td>Democratic</td><td>2022</td><td>Incumbent lost re-election.</td><td>▌ Y Nick Begich III (Republican) 48.4% ▌ Mary Peltola (Democratic) 46.4%</td></tr>`,
    );
    const m = parseWikiResults(html, "state-district");
    expect(m.get("AL-2")?.[0].winners).toEqual(["Shomari Figures"]);
    expect(m.get("AK-0")?.[0]).toEqual({ incumbent: "Mary Peltola", winners: ["Nick Begich III"] });
  });

  it("reads 'Incumbent reelected' and vote shares (Oklahoma shape)", () => {
    const html = wrap(
      `<tr><th>District</th><th colspan="4">Incumbent</th><th rowspan="2">Candidates</th></tr>
       <tr><th>Location</th><th>Member</th><th>Party</th><th>First elected</th><th>Status</th></tr>`,
      `<tr><td>1</td><td>Eddy Dempsey</td><td>Republican</td><td>2020</td><td>Incumbent reelected</td><td>▌ Eddy Dempsey - 86.3% ▌ Victoria Lawhorn - 13.7%</td></tr>
       <tr><td>39</td><td>Ryan Martinez</td><td>Republican</td><td>2016</td><td>Incumbent retired. New member elected.</td><td>▌ Erick Harris - 55.0% ▌ Someone Else - 45.0%</td></tr>`,
    );
    const m = parseWikiResults(html);
    expect(m.get("1")?.[0].winners).toEqual(["Eddy Dempsey"]);
    expect(m.get("39")?.[0].winners).toEqual(["Erick Harris"]);
  });

  it("before the election, no row names a winner", () => {
    const html = wrap(
      `<tr><th>District</th><th colspan="4">Incumbent</th><th rowspan="2">Candidates</th></tr>
       <tr><th>Location</th><th>Member</th><th>Party</th><th>First elected</th><th>Status</th></tr>`,
      `<tr><td>2</td><td>Ally Seifried</td><td>Rep</td><td>2022</td><td>Incumbent running for reelection</td><td>▌ Randy Cowling ▌ Ally Seifried</td></tr>
       <tr><td>24</td><td>Darrell Weaver</td><td>Rep</td><td>2018</td><td>Incumbent retiring</td><td>▌ A Candidate ▌ B Candidate</td></tr>`,
    );
    expect([...parseWikiResults(html).values()].flat().every((r) => r.winners.length === 0)).toBe(true);
  });

  it("a stale 'reelected' beside an incumbent eliminated in the primary is no winner", () => {
    const html = wrap(
      `<tr><th>District</th><th>Member</th><th>Status</th><th>Candidates</th></tr>`,
      `<tr><td>20</td><td>Chuck Hall</td><td>Incumbent reelected</td><td>▌ Chuck Hall Eliminated in primary ▌ Mark LeMarr</td></tr>`,
    );
    expect(parseWikiResults(html).get("20")?.[0].winners).toEqual([]);
  });

  it("a two-member district's rowspan labels both rows", () => {
    const html = wrap(
      `<tr><th>District</th><th>Incumbent</th><th>Elected representative</th></tr>`,
      `<tr><td rowspan="2">Belknap 1</td><td>Tom Ploszaj</td><td>Tom Ploszaj</td></tr><tr><td>Lisa Smart</td><td>Matthew Lunney</td></tr>`,
    );
    expect(parseWikiResults(html).get("belknap 1")?.map((r) => r.winners[0])).toEqual(["Tom Ploszaj", "Matthew Lunney"]);
  });

  it("a header broken with <br> still names the column (Alaska / Hawaii 2026 shape)", () => {
    const html = wrap(
      `<tr><th>District</th><th>Incumbent</th><th>Party</th><th>Elected<br>representative</th></tr>`,
      `<tr><td>2</td><td>Sue Lee Loy</td><td>Dem</td><td>Sue Lee Loy</td></tr>`,
    );
    expect(parseWikiResults(html).get("2")?.[0].winners).toEqual(["Sue Lee Loy"]);
  });

  it("keys", () => {
    expect(rowKey("Ohio (Class 3)", "state")).toBe("OH");
    expect(rowKey("New York 12", "state-district")).toBe("NY-12");
    expect(rowKey("Totals", "district")).toBeNull();
    expect(rowKey("10th Bristol", "district")).toBe("10th bristol"); // Massachusetts, as our rows store it
  });
});

describe("election results: single-race infobox (statewide offices)", () => {
  const box = (rows: string) => `<table class="infobox"><tr><td>${rows}</td></tr></table>`;

  it("reads 'Elected Governor' and the incumbent before the election", () => {
    const html = box(`<b><a href="/wiki/Governor_of_Arizona">Governor</a> before election</b><p><a href="/wiki/Doug_Ducey">Doug Ducey</a><br><a href="/wiki/R">Republican</a></p>
      <b>Elected <a href="/wiki/Governor_of_Arizona">Governor</a></b><p><a href="/wiki/Katie_Hobbs">Katie Hobbs</a><br><a href="/wiki/D">Democratic</a></p>`);
    expect(parseInfoboxResult(html)).toEqual({ incumbent: "Doug Ducey", winners: ["Katie Hobbs"] });
  });

  it("before results, the box names only the incumbent", () => {
    const html = box(`<b>Incumbent <a href="/wiki/Governor_of_Oklahoma">Governor</a></b><p><a href="/wiki/Kevin_Stitt">Kevin Stitt</a><br><a href="/wiki/R">Republican</a></p>`);
    expect(parseInfoboxResult(html)).toEqual({ incumbent: "Kevin Stitt", winners: [] });
  });

  it("an unlinked winner is not guessed from the party link", () => {
    const html = box(`<b>Governor before election</b><p><a href="/wiki/A">Ann Example</a></p><b>Elected Governor</b><p>New Person<br><a href="/wiki/R">Republican</a></p>`);
    expect(parseInfoboxResult(html)?.winners).toEqual([]);
  });
});
