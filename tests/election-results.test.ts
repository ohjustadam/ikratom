import { describe, it, expect } from "vitest";
import { parseWikiResults, parseInfoboxResult, parseFloridaResults, parseMinnesotaResults, rowKey, decideSeat } from "../scripts/lib/election-results.mjs";

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

describe("election results: Minnesota's split district column", () => {
  it("joins the number and the letter into one district", () => {
    const html = wrap(
      `<tr><th colspan="2">District</th><th>Incumbent</th><th>Party</th><th>Elected Representative</th><th>Party</th></tr>`,
      `<tr><td>1</td><td>A</td><td>Rep. John Burkel</td><td>Rep</td><td>John Burkey</td><td>Rep</td></tr>
       <tr><td>1</td><td>B</td><td>Steve Gander</td><td>Rep</td><td>Steve Gander</td><td>Rep</td></tr>`,
    );
    const m = parseWikiResults(html);
    expect(m.get("1a")?.[0]).toEqual({ incumbent: "John Burkel", winners: ["John Burkey"] });
    expect(m.get("1b")?.[0].winners).toEqual(["Steve Gander"]);
  });
});

describe("election results: pages with a vote box per district", () => {
  const voteBox = (caption: string, rows: string, close = "<tr><td colspan='6'>Republican hold</td></tr>") =>
    `<table class="wikitable"><caption>${caption}</caption><tr><th colspan="2">Party</th><th>Candidate</th><th>Votes</th><th>%</th><th>±%</th></tr>${rows}${close}</table>`;
  const won = "<tr><td></td><td>Republican</td><td><b><a>Doug Miller</a> (incumbent)</b></td><td><b>9,000</b></td><td>60</td><td>+1</td></tr>";
  const lost = "<tr><td></td><td>Democratic</td><td><a>Ann Example</a></td><td>6,000</td><td>40</td><td>-1</td></tr>";

  it("the bold row wins a closed box, even with a change column", () => {
    const m = parseWikiResults(`<h3>District 48</h3>${voteBox("Indiana House, District 48, 2026", won + lost)}`);
    expect(m.get("48")).toEqual([{ incumbent: "Doug Miller", incumbents: ["Doug Miller"], winners: ["Doug Miller"], box: true }]);
  });

  it("a box with no hold or gain line is still being counted", () => {
    expect(parseWikiResults(`<h3>District 48</h3>${voteBox("General", won + lost, "")}`).get("48")).toBeUndefined();
  });

  it("a primary winner is never read as elected", () => {
    const m = parseWikiResults(`<h3>District 48</h3><h4>Republican primary</h4>${voteBox("Republican primary", won)}`);
    expect(m.get("48")).toBeUndefined();
    const n = parseWikiResults(`<h3>District 48</h3>${voteBox("2026 Republican primary election", won)}`);
    expect(n.get("48")).toBeUndefined();
  });

  it("a table row beats a box for the same district", () => {
    const table = wrap(
      "<tr><th>District</th><th>Incumbent</th><th>Party</th><th>Elected Representative</th><th>Party</th></tr>",
      "<tr><td>48</td><td>Doug Miller</td><td>Rep</td><td>Table Winner</td><td>Rep</td></tr>",
    );
    expect(parseWikiResults(`${table}<h3>District 48</h3>${voteBox("General", won + lost)}`).get("48")?.[0].winners).toEqual(["Table Winner"]);
  });
});

describe("election results: Florida's results file", () => {
  const head = "ElectionDate\tPartyCode\tPartyName\tRaceCode\tRaceName\tCountyCode\tCountyName\tJuris1num\tJuris2num\tPrecincts\tPrecinctsReporting\tCanNameLast\tCanNameFirst\tCanNameMiddle\tCanVotes";
  const row = (race: string, name: string, county: string, last: string, first: string, votes: number, reporting = 10) =>
    `2026-11-03\tREP\tRepublican\t${race}\t${name}\t${county}\t${county}\t\t\t10\t${reporting}\t${last}\t${first}\t\t${votes}`;
  const file = (...rows: string[]) => [head, ...rows].join("\n");

  it("adds up the counties and names the leader", () => {
    const m = parseFloridaResults(file(
      row("STR", "State Representative, District 62", "HIL", "Lee", "Ann", 500),
      row("STR", "State Representative, District 62", "HIL", "Cruz", "Bo", 600),
      row("STR", "State Representative, District 62", "PIN", "Lee", "Ann", 900),
      row("STR", "State Representative, District 62", "PIN", "Cruz", "Bo", 100),
    ));
    expect(m.get("state_house-62")?.[0].winners).toEqual(["Ann Lee"]);
  });

  it("the statewide Senate race has no district", () => {
    const m = parseFloridaResults(file(
      row("USS", "United States Senator", "HIL", "Moody", "Ashley", 900),
      row("USS", "United States Senator", "HIL", "Other", "Sam", 100),
    ));
    expect(m.get("us_senate-")?.[0].winners).toEqual(["Ashley Moody"]);
  });

  it("names nobody until every county has finished", () => {
    const m = parseFloridaResults(file(
      row("STS", "State Senator, District 8", "VOL", "Lee", "Ann", 900),
      row("STS", "State Senator, District 8", "VOL", "Cruz", "Bo", 100, 9),
    ));
    expect(m.get("state_senate-8")?.[0].winners).toEqual([]);
  });

  it("leaves a recount-margin race alone", () => {
    const m = parseFloridaResults(file(
      row("USR", "United States Representative, District 13", "PIN", "Lee", "Ann", 10010),
      row("USR", "United States Representative, District 13", "PIN", "Cruz", "Bo", 9990),
    ));
    expect(m.get("us_house-13")?.[0].winners).toEqual([]);
  });

  it("ignores offices we don't track", () => {
    expect(parseFloridaResults(file(row("CFO", "Chief Financial Officer", "HIL", "Lee", "Ann", 5))).size).toBe(0);
  });
});

describe("election results: more district shapes", () => {
  const head = (d: string) => `<tr>${d}<th>Incumbent</th><th>Party</th><th>Elected Representative</th><th>Outcome</th></tr>`;

  it("reads Idaho's seat column", () => {
    const html = wrap(head("<th>District</th><th>Seat</th>"), "<tr><td>2</td><td>A</td><td>Heather Scott</td><td>Rep</td><td>Heather Scott</td><td>Hold</td></tr>");
    expect(parseWikiResults(html).get("2a")?.[0].winners).toEqual(["Heather Scott"]);
  });

  it("reads New Hampshire's county and number columns", () => {
    const html = wrap(head('<th colspan="2">District</th>'), "<tr><td>Rockingham</td><td>29</td><td>Ann Example</td><td>Rep</td><td>Ann Example</td><td>Hold</td></tr>");
    expect(parseWikiResults(html).has("rockingham 29")).toBe(true);
  });

  it("a district cell spanning both columns stays one district", () => {
    const html = wrap(head('<th colspan="2">District</th>'), '<tr><td colspan="2">12</td><td>Ann Example</td><td>Rep</td><td>Ann Example</td><td>Hold</td></tr>');
    expect(parseWikiResults(html).has("12")).toBe(true);
  });

  it("our 'Third Suffolk' is the page's '3rd Suffolk'", () => {
    expect(rowKey("Third Suffolk", "district")).toBe("3rd suffolk");
    expect(rowKey("3rd Suffolk", "district")).toBe("3rd suffolk");
  });

  it("drops the tick a page leaves in front of a name", () => {
    const html = wrap(head("<th>District</th>"), "<tr><td>92</td><td>Forrest Bennett</td><td>Dem</td><td>Y Sam Grimaldo</td><td>Hold</td></tr>");
    expect(parseWikiResults(html).get("92")?.[0].winners).toEqual(["Sam Grimaldo"]);
  });

  const closed = `<table class="wikitable"><tr><th colspan="2">Party</th><th>Candidate</th><th>Votes</th><th>%</th></tr>
    <tr><td></td><td>Dem</td><td><b><a>Ann Example</a></b></td><td>9</td><td>90</td></tr><tr><td colspan="5">Democratic hold</td></tr></table>`;

  it("reads a vote box under a named district", () => {
    expect(parseWikiResults(`<h2>Results</h2><h3>Addison</h3><h4>Results</h4>${closed}`).get("addison")?.[0].winners).toEqual(["Ann Example"]);
  });

  it("headings inside a district don't become districts", () => {
    const html = `<h2>Results</h2><h3>District 20</h3><h4>Republican primary</h4><h5>Eliminated in primary</h5><h4>General election</h4>${closed}`;
    const m = parseWikiResults(html);
    expect(m.get("20")?.[0].winners).toEqual(["Ann Example"]);
    expect(m.size).toBe(1);
    const named = `<h2>Results</h2><h3>Windsor</h3><h4>Results</h4>${closed}<h4>Progressive primary</h4>${closed}<h5>Withdrawn</h5>${closed}`;
    expect([...parseWikiResults(named).keys()]).toEqual(["windsor"]);
  });

  it("a special election's box is not this election's result", () => {
    expect(parseWikiResults(`<h2>Special elections</h2><h3>District 5</h3>${closed}`).has("5")).toBe(false);
    expect(parseWikiResults(`<h3>2026 special election: 1st Middlesex</h3>${closed}`).size).toBe(0);
  });
});

describe("election results: deciding a seat", () => {
  const seat = (incumbent_name: string, extra = {}) => ({ incumbent_name, seat: "", ...extra });

  it("the page's own incumbent winning is a re-election under another name", () => {
    expect(decideSeat(seat("Eric Crawford"), [{ incumbent: "Rick Crawford", winners: ["Rick Crawford"] }]))
      .toEqual({ decision: "incumbent_reelected", winner: "Rick Crawford" });
  });

  it("a district listed twice reads as one result", () => {
    const rows = [{ incumbent: "Marc LaHood", winners: [] }, { incumbent: "Marc LaHood", winners: ["Zack Dunn"] }];
    expect(decideSeat(seat("Marc LaHood"), rows)).toEqual({ decision: "successor_elected", winner: "Zack Dunn" });
  });

  it("two rows naming two winners decide nothing", () => {
    const rows = [{ incumbent: "Ann Lee", winners: ["Bo Cruz"] }, { incumbent: "Ann Lee", winners: ["Sam Hill"] }];
    expect(decideSeat(seat("Ann Lee"), rows).decision).toBeNull();
  });

  it("an earlier special's row can't stand in for the general", () => {
    const rows = [{ incumbent: "Zohran Mamdani", winners: ["Diana Moreno"] }, { incumbent: "Diana Moreno", winners: [] }];
    expect(decideSeat(seat("Diana Moreno"), rows).decision).toBeNull();
  });

  it("a typo in the winner goes to review, not a departure", () => {
    expect(decideSeat(seat("John Burkel"), [{ incumbent: "John Burkel", winners: ["John Burkey"] }]).decision).toBe("ambiguous");
  });

  it("a relative who shares the surname goes to review", () => {
    expect(decideSeat(seat("Jesús García"), [{ incumbent: "Jesús García", winners: ["Patty García"] }]).decision).toBe("ambiguous");
  });

  it("our incumbent winning under another listed incumbent is a re-election", () => {
    expect(decideSeat(seat("Jerry Tillett"), [{ incumbent: "Bobby Hanig", winners: ["Jerry Tillett"] }]).decision).toBe("incumbent_reelected");
  });

  it("someone else listed as incumbent means our roster may be behind", () => {
    const out = decideSeat(seat("Dave Yost"), [{ incumbent: "Andy Wilson", winners: ["John Kulewicz"] }]);
    expect(out.decision).toBe("ambiguous");
    expect(out.reason).toContain("Andy Wilson");
  });

  it("no winner yet decides nothing", () => {
    expect(decideSeat(seat("Ann Lee"), [{ incumbent: "Ann Lee", winners: [] }]).decision).toBeNull();
    expect(decideSeat(seat("Ann Lee"), []).decision).toBeNull();
  });

  it("a multi-member district waits for every row", () => {
    const s = seat("Ann Lee", { seat: "uuid" });
    expect(decideSeat(s, [{ incumbent: "Ann Lee", winners: ["Ann Lee"] }, { incumbent: "Bo Cruz", winners: [] }]).decision).toBeNull();
    expect(decideSeat(s, [{ incumbent: "Ann Lee", winners: ["Ann Lee"] }, { incumbent: "Bo Cruz", winners: ["Sam Hill"] }]).decision).toBe("incumbent_reelected");
    expect(decideSeat(seat("Bo Cruz", { seat: "uuid" }), [{ incumbent: "Ann Lee", winners: ["Ann Lee"] }, { incumbent: "Bo Cruz", winners: ["Sam Hill"] }]))
      .toEqual({ decision: "successor_elected", winner: "Sam Hill" });
  });
});

describe("election results: Minnesota's files", () => {
  const row = (office: string, d: string, name: string, votes: number, reporting = 174) =>
    `MN;;;0188;${office} District ${d};${d};0301;${name};;;R;${reporting};174;${votes};50;0`;

  it("reads both chambers", () => {
    const m = parseMinnesotaResults([
      row("State Representative", "1A", "John Burkel", 13223), row("State Representative", "1A", "Leanna Sandahl", 5205),
      row("State Senator", "1", "Mark Johnson", 24014), row("State Senator", "1", "Bjorn Solberg", 11278),
    ].join("\r\n"));
    expect(m.get("state_house-1a")?.[0].winners).toEqual(["John Burkel"]);
    expect(m.get("state_senate-1")?.[0].winners).toEqual(["Mark Johnson"]);
  });

  it("waits for every precinct and skips write-ins", () => {
    const m = parseMinnesotaResults([
      row("State Senator", "2", "Ann Lee", 900, 170), row("State Senator", "2", "Bo Cruz", 100, 170), row("State Senator", "3", "WRITE-IN", 2), row("State Senator", "3", "Sam Hill", 90), row("State Senator", "3", "Al Fox", 10),
    ].join("\n"));
    expect(m.get("state_senate-2")?.[0].winners).toEqual([]);
    expect(m.get("state_senate-3")?.[0].winners).toEqual(["Sam Hill"]);
  });
});

describe("election results: an incumbent moved by redistricting", () => {
  it("winning another district is a re-election, not a departure", () => {
    const rows = [{ incumbent: "Kevin Kiley", winners: ["Richard Pan"] }];
    expect(decideSeat({ incumbent_name: "Ami Bera", seat: "" }, rows, ["Ami Bera", "Doris Matsui"]))
      .toEqual({ decision: "incumbent_reelected", winner: "Ami Bera" });
  });

  it("a seat with no row of its own still reads", () => {
    expect(decideSeat({ incumbent_name: "Blake Moore", seat: "" }, [], ["Blake Moore"]).decision).toBe("incumbent_reelected");
  });

  it("a neighbour with the same initial and surname is someone else", () => {
    const rows = [{ incumbent: "Jasmine Clark", winners: ["Rahim Asani"] }];
    expect(decideSeat({ incumbent_name: "Jasmine Clark", seat: "" }, rows, ["Josh Clark"]).decision).toBe("successor_elected");
  });

  it("a namesake's win elsewhere doesn't save a losing incumbent", () => {
    const rows = [{ incumbent: "Tim Kennedy", winners: ["Ann Lee"] }];
    expect(decideSeat({ incumbent_name: "Tim Kennedy", seat: "" }, rows, ["Mike Kennedy"]).decision).toBe("successor_elected");
  });
});
