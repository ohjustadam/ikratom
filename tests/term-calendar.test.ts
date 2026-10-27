import { describe, it, expect } from "vitest";
import {
  electionDay,
  applyRule,
  observedStarts,
  deriveTermStart,
  deriveStateTermStarts,
  parseNcslRaces,
  normalizeDistrict,
  parseWikiSeatTables,
  sameSurname,
} from "../scripts/lib/term-calendar.mjs";

/**
 * The officials-turnover engine's pure core. Every expected date below is the
 * one openstates/people recorded, or the one the state's own rule names, so a
 * regression here is a wrong "leaving office on" date on a real legislator.
 */
describe("term-calendar: election day", () => {
  it("is the Tuesday after the first Monday in November", () => {
    expect(electionDay(2026)).toBe("2026-11-03");
    expect(electionDay(2024)).toBe("2024-11-05");
    expect(electionDay(2022)).toBe("2022-11-08");
    expect(electionDay(2020)).toBe("2020-11-03");
    // Nov 1 is a Tuesday: the election is the 8th, never the 1st.
    expect(electionDay(2022)).not.toBe("2022-11-01");
    expect(electionDay(2033)).toBe("2033-11-08");
  });
});

describe("term-calendar: rules", () => {
  it("names the right day for each rule shape", () => {
    expect(applyRule("election+15d", 2026)).toBe("2026-11-18"); // Oklahoma
    expect(applyRule("election+0d", 2026)).toBe("2026-11-03"); // Florida: upon election
    expect(applyRule("fixed:12-01", 2026)).toBe("2026-12-01");
    expect(applyRule("fixed:01-01", 2026)).toBe("2027-01-01");
    expect(applyRule("nth:1:2:1", 2026)).toBe("2027-01-11"); // 2nd Monday of January
    expect(applyRule("nth:12:1:1", 2026)).toBe("2026-12-07"); // 1st Monday of December
    expect(applyRule("firstmon+2:1", 2026)).toBe("2027-01-06"); // Wednesday after the first Monday
    expect(applyRule("firstmon+2:1", 2024)).toBe("2025-01-08");
    expect(() => applyRule("bogus", 2026)).toThrow();
  });
});

describe("term-calendar: observed starts", () => {
  it("takes the modal freshman start date per cycle and ignores a lone appointee", () => {
    const starts = [
      ...Array(8).fill("2022-11-23"),
      "2023-06-18", // appointee, same window? no: outside Feb 28
      ...Array(12).fill("2024-11-20"),
      "2025-01-15", // one mid-window appointee cannot outvote 12
      "2019-03-01",
    ];
    const obs = observedStarts(starts, [2022, 2024]);
    expect(obs).toEqual([
      { cycle: 2022, date: "2022-11-23", n: 8, of: 8 },
      { cycle: 2024, date: "2024-11-20", n: 12, of: 13 },
    ]);
  });

  it("drops a cycle with too few freshmen to judge", () => {
    expect(observedStarts(["2025-01-14", "2025-01-14"], [2024])).toEqual([]);
    expect(observedStarts(["2025-01-14", "2025-01-14"], [2024], 1)).toHaveLength(1);
  });
});

describe("term-calendar: deriving the handover day", () => {
  const ob = (cycle: number, date: string) => ({ cycle, date, n: 10, of: 10 });

  it("Oklahoma: 15 days after the election, from 2022 and 2024", () => {
    const r = deriveTermStart([ob(2022, "2022-11-23"), ob(2024, "2024-11-20")], 2026);
    expect(r.date).toBe("2026-11-18");
  });

  it("California: two cycles are ambiguous, the third settles it", () => {
    const two = deriveTermStart([ob(2022, "2022-12-05"), ob(2024, "2024-12-02")], 2026);
    expect(two.date).toBeNull();
    expect("reason" in two && two.reason).toMatch(/disagree/);
    const three = deriveTermStart([ob(2020, "2020-12-07"), ob(2022, "2022-12-05"), ob(2024, "2024-12-02")], 2026);
    expect(three.date).toBe("2026-12-07");
  });

  it("Colorado: a state that changed its day gets no date, never a guess", () => {
    const r = deriveTermStart([ob(2022, "2023-01-09"), ob(2024, "2025-01-08")], 2026);
    expect(r.date).toBeNull();
  });

  it("refuses to derive from one cycle", () => {
    expect(deriveTermStart([ob(2024, "2025-01-14")], 2026).date).toBeNull();
  });

  it("a small chamber borrows its sibling's rule only when its own starts agree", () => {
    const lower = [...Array(28).fill("2023-01-10"), ...Array(31).fill("2025-01-14")];
    const agreeing = deriveStateTermStarts({ lower, upper: ["2025-01-14", "2025-01-14"] }, [2022, 2024], 2026);
    expect(agreeing.lower.date).toBe("2027-01-12"); // Texas: 2nd Tuesday of January
    expect(agreeing.upper.date).toBe("2027-01-12");
    const conflicting = deriveStateTermStarts({ lower, upper: ["2025-01-20", "2025-01-20"] }, [2022, 2024], 2026);
    expect(conflicting.upper.date).toBeNull();
  });
});

describe("term-calendar: NCSL chamber table", () => {
  it("reads seats up per chamber and skips the totals row", () => {
    const html = `<table>
      <tr><th>State</th><th>Senate Term</th><th>Total Senate Seats</th><th>Senate Seats up in 2026</th><th>House Term</th><th>Total House Seats</th><th>House Seats up in 2026</th></tr>
      <tr><td>Oklahoma</td><td>4 year</td><td>48</td><td>24</td><td>2 year</td><td>101</td><td>101</td></tr>
      <tr><td>Nebraska</td><td>4 year</td><td>49</td><td>24</td><td>N/A</td><td>Unicameral</td><td>N/A</td></tr>
      <tr><td>Totals</td><td>n/a</td><td>1,973</td><td>1,179</td><td>n/a</td><td>5,413</td><td>4,960</td></tr>
    </table>`;
    const m = parseNcslRaces(html);
    expect(m.get("Oklahoma")).toEqual({ upper: { termYears: 4, total: 48, up: 24 }, lower: { termYears: 2, total: 101, up: 101 } });
    expect(m.get("Nebraska")?.lower).toBeNull();
    expect(m.has("Totals")).toBe(false);
  });
});

describe("term-calendar: Wikipedia district tables", () => {
  it("normalizes district labels to ours", () => {
    expect(normalizeDistrict("District 17")).toBe("17");
    expect(normalizeDistrict("17th")).toBe("17");
    expect(normalizeDistrict("5[a]")).toBe("5");
    expect(normalizeDistrict("017")).toBe("17");
    expect(normalizeDistrict("A")).toBe("A");
    expect(normalizeDistrict("Hillsborough 12")).toBeNull();
    expect(normalizeDistrict("Republican")).toBeNull();
  });

  it("takes the summary and special tables, never predictions", () => {
    const html = `
      <div class="mw-heading mw-heading2"><h2>Predictions</h2></div>
      <table class="wikitable"><tr><th>District</th><th>Incumbent</th><th>Rating</th></tr>
        <tr><td>9</td><td>Somebody Else</td><td>Safe</td></tr></table>
      <div class="mw-heading mw-heading2"><h2>Special elections</h2></div>
      <table class="wikitable"><tr><th>District</th><th>Incumbent</th></tr>
        <tr><td>17</td><td>Shane Jett</td></tr></table>
      <div class="mw-heading mw-heading2"><h2>Summary of elections</h2></div>
      <table class="wikitable">
        <tr><th>District</th><th colspan="4">Incumbent</th></tr>
        <tr><th>Location</th><th>Member</th><th>Party</th><th>First elected</th></tr>
        <tr><td>2</td><td>Ally Seifried</td><td>Rep</td><td>2022</td></tr>
        <tr><td>4</td><td>Tom Woods</td><td>Rep</td><td>2022</td></tr>
        <tr><td>6[a]</td><td>David Bullard</td><td>Rep</td><td>2018</td></tr>
      </table>`;
    const { regular, special } = parseWikiSeatTables(html);
    expect([...regular.keys()]).toEqual(["2", "4", "6"]);
    expect(regular.get("6")?.name).toBe("David Bullard");
    expect([...special.keys()]).toEqual(["17"]);
    expect(regular.has("9")).toBe(false);
  });

  it("matches surnames across accents and suffixes", () => {
    expect(sameSurname("José Menéndez", "Jose Menendez")).toBe(true);
    expect(sameSurname("Bryan Hughes Jr.", "Bryan Hughes")).toBe(true);
    expect(sameSurname("Tom Woods", "Tom Wood")).toBe(false);
    expect(sameSurname("Michael Brooks-Jimenez", "Michael Brooks")).toBe(true);
    expect(sameSurname("Suzy Glowiak", "Suzy Glowiak Hilton")).toBe(true);
    expect(sameSurname("Karla May†", "Karla May")).toBe(true);
    // The real collision: his successor carries his surname as a middle name.
    expect(sameSurname("Lindsey Graham", "Darline Graham Nordone")).toBe(false);
    expect(sameSurname("Scott Thomas", "Thomas Scott")).toBe(false);
    expect(sameSurname("", "")).toBe(false);
  });
});

describe("term-calendar: same person", () => {
  it("needs the first initial as well as the surname", async () => {
    const { samePerson } = await import("../scripts/lib/term-calendar.mjs");
    expect(samePerson("Lindsey Graham", "Darline Graham")).toBe(false);
    expect(samePerson("Darline Graham Nordone", "Darline Graham")).toBe(true);
    expect(samePerson("Kevin Hern", "Kevin Hern (incumbent)")).toBe(true);
    expect(samePerson("José Menéndez", "Jose Menendez")).toBe(true);
  });

  it("reads a leading initial or a first name used as the middle one (2026 Wikipedia tables)", async () => {
    const { samePerson } = await import("../scripts/lib/term-calendar.mjs");
    expect(samePerson("N. Scott Phillips", "Scott Phillips")).toBe(true);
    expect(samePerson("C. Anthony Muse", "Anthony Muse")).toBe(true);
    expect(samePerson("Michael Sarge Pollock", "Sarge Pollock")).toBe(true);
    expect(samePerson("W. Gregory Wims", "Greg Wims")).toBe(true);
    expect(samePerson('James "Jay" Jones', "Jay Jones")).toBe(true);
    // Still different people: the Graham trap, a shared middle name, a true nickname.
    expect(samePerson("Darline Graham", "Lindsey Graham")).toBe(false);
    expect(samePerson("Mary Ann Santos", "Kim Ann Santos")).toBe(false);
    expect(samePerson("Doc Rhett", "Michael Rhett")).toBe(false);
  });
});
