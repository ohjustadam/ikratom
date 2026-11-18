import { describe, it, expect } from "vitest";
import {
  carriesSurname, compareChamber, correctionLine, extractEmails, givenNames, nameFits, pageKey, rosterPages, surnameHits, surnameKeys,
} from "../scripts/lib/roster-emails.mjs";
import { rejectedEmails } from "../scripts/lib/legislator-contacts.mjs";

const row = (id: string, email: string, family: string, rejected: string[] = [], first = "Pat") => {
  const keys = surnameKeys(family, "");
  return { id, email, surnameKeys: keys, givenNames: givenNames(`${first} ${family}`, undefined, keys), rejected: new Set(rejected) };
};

// Ten colleagues listed exactly: with one mismatch that is 91%, so the page vouches for the chamber.
const colleagues = ["Adams", "Baker", "Clark", "Diaz", "Evans", "Fox", "Grant", "Hayes", "Irwin", "Jones"]
  .map((n, i) => row(`c${i}`, `${n}@house.mi.gov`, n));
const page = (extra: string) => extractEmails(
  `${colleagues.map((c) => `<a href="mailto:${c.email}">Email</a>`).join("")}${extra}`,
);
const taken = (rows: { id: string; email: string }[]) => new Map(rows.map((r) => [r.email.toLowerCase(), r.id]));

describe("extractEmails", () => {
  it("keeps the page's spelling and decodes hidden @ signs", () => {
    const m = extractEmails('<a href="mailto:ParkerFairbairn@house.mi.gov">x</a> jane&#64;senate.ca.gov a%40b.org');
    expect(m.get("parkerfairbairn@house.mi.gov")).toBe("ParkerFairbairn@house.mi.gov");
    expect(m.has("jane@senate.ca.gov")).toBe(true);
    expect(m.has("a@b.org")).toBe(true);
  });
});

describe("surname matching", () => {
  it("uses the family name, its last word, and skips suffixes", () => {
    expect(surnameKeys("Van Woerkom", "")).toEqual(["vanwoerkom", "woerkom"]);
    expect(surnameKeys("Núñez", "")).toEqual(["nunez"]);
    expect(surnameKeys(undefined, "John Smith Jr.")).toEqual(["smith"]);
    expect(surnameKeys("Ng", "")).toEqual([]);
  });
  it("matches the surname only at the start or end of a part", () => {
    expect(carriesSurname("ParkerFairbairn@house.mi.gov", ["fairbairn"])).toBe(true);
    expect(carriesSurname("rep.lee@x.gov", ["lee"])).toBe(true);
    expect(carriesSurname("fairbairnp@x.gov", ["fairbairn"])).toBe(true);
    expect(carriesSurname("kathleen.smith@x.gov", ["lee"])).toBe(false);
  });
  it("needs the rest of the address to be a title or the member's own first name", () => {
    const k = surnameKeys("Linthicum", "");
    expect(nameFits("Sen.DennisLinthicum@oregonlegislature.gov", k, givenNames("Diane Linthicum", undefined, k))).toBe(false);
    expect(nameFits("ParkerFairbairn@house.mi.gov", ["fairbairn"], ["parker"])).toBe(true);
    expect(nameFits("Tim.Soucy@gc.nh.gov", ["soucy"], ["timothy"])).toBe(true);
    expect(nameFits("sen.bwestlin@mnsenate.gov", ["westlin"], ["bonnie"])).toBe(true);
    expect(nameFits("jacque.phillips.house@coleg.gov", ["phillips"], ["jacque"])).toBe(true);
    expect(nameFits("SenElect.JeffHelfrich@oregonlegislature.gov", ["helfrich"], ["jeff"])).toBe(false);
  });
  it("stays on the member's own domain", () => {
    const m = extractEmails("ParkerFairbairn@house.mi.gov parker@fairbairnforhouse.com");
    expect(surnameHits(m, ["fairbairn"], "house.mi.gov")).toEqual(["parkerfairbairn@house.mi.gov"]);
  });
});

describe("compareChamber", () => {
  it("never gives a member a relative's address off a stale roster (Linthicum, 11-16)", () => {
    const diane = row("d", "sen.dianelinthicum@house.mi.gov", "Linthicum", [], "Diane");
    const rows = [...colleagues, diane];
    const c = compareChamber(rows, page(" Sen.DennisLinthicum@house.mi.gov "), taken(rows));
    expect(c.mismatches[0].swap).toBeNull();
    expect(c.mismatches[0].reason).toMatch(/own name/);
  });

  it("reports but never swaps from a page listing 60-90% of the chamber", () => {
    const fair = row("f", "parker.fairbairn@house.mi.gov", "Fairbairn", [], "Parker");
    const stale = row("s", "old.stale@house.mi.gov", "Stale");
    const rows = [...colleagues, fair, stale];
    const c = compareChamber(rows, page(" ParkerFairbairn@house.mi.gov "), taken(rows));
    expect(c.vouches).toBe(false);
    expect(c.reports).toBe(true);
    expect(c.mismatches.every((m) => m.swap === null)).toBe(true);
  });

  it("swaps in the roster's spelling (Fairbairn, 2026-11-11)", () => {
    const fair = row("f", "parker.fairbairn@house.mi.gov", "Fairbairn", [], "Parker");
    const rows = [...colleagues, fair];
    const c = compareChamber(rows, page(" ParkerFairbairn@house.mi.gov "), taken(rows));
    expect(c.vouches).toBe(true);
    expect(c.mismatches).toHaveLength(1);
    expect(c.mismatches[0].swap).toBe("ParkerFairbairn@house.mi.gov");
  });

  it("reports, never swaps, when two addresses carry the surname", () => {
    const r = row("j", "j.johnson@house.mi.gov", "Johnson");
    const rows = [...colleagues, r];
    const c = compareChamber(rows, page(" kjohnson@house.mi.gov tjohnson@house.mi.gov "), taken(rows));
    expect(c.mismatches[0].swap).toBeNull();
    expect(c.mismatches[0].reason).toMatch(/2 addresses/);
  });

  it("never takes another member's address", () => {
    const a = row("a", "old.miller@house.mi.gov", "Miller");
    const b = row("b", "jmiller@house.mi.gov", "Miller");
    const rows = [...colleagues, a, b];
    const c = compareChamber(rows, page(" jmiller@house.mi.gov "), taken(rows));
    const mm = c.mismatches.find((m) => m.row.id === "a");
    expect(mm?.swap).toBeNull();
    expect(mm?.reason).toMatch(/another member/);
  });

  it("never puts back an address our checkers already rejected", () => {
    const md = '- Email corrected 2026-11-01: "lfoster@house.mi.gov" has a domain that cannot receive mail.';
    const r = row("x", "l.foster@house.mi.gov", "Foster", [...rejectedEmails(md)]);
    const rows = [...colleagues, r];
    const c = compareChamber(rows, page(" lfoster@house.mi.gov "), taken(rows));
    expect(c.mismatches[0].swap).toBeNull();
  });

  it("ignores members whose domain is not on the page", () => {
    const r = row("g", "someone@gmail.com", "Gray");
    const rows = [...colleagues, r];
    expect(compareChamber(rows, page(""), taken(rows)).mismatches).toHaveLength(0);
  });

  it("does not vouch for a page listing few of the chamber's addresses", () => {
    const rows = [...colleagues, ...["F", "G", "H", "I", "J", "K", "L", "M"].map((n) => row(n, `${n}x.old@house.mi.gov`, `${n}xname`))];
    const c = compareChamber(rows, page(""), taken(rows));
    expect(c.coverage).toBeLessThan(0.6);
    expect(c.vouches).toBe(false);
  });
});

describe("rosterPages", () => {
  it("takes noted list pages and URLs many members share, one per variant", () => {
    const docs = Array.from({ length: 10 }, (_, i) => ({
      sources: [
        { url: "https://www.house.mi.gov/AllRepresentatives/", note: i === 0 ? "Members List Page" : undefined },
        { url: "https://www.house.mi.gov/AllRepresentatives" },
        { url: `https://www.house.mi.gov/rep${i}` },
        ...(i < 6 ? [{ url: "https://api.example.gov/members", note: "API members list (requires authorization token)" }] : []),
      ],
    }));
    expect(rosterPages(docs)).toEqual(["https://www.house.mi.gov/AllRepresentatives", "https://api.example.gov/members"]);
    expect(pageKey("ftp://ftp.cga.ct.gov/pub/data/LegislatorDatabase.csv")).toBeNull();
  });
});

describe("correctionLine", () => {
  it("is read back by rejectedEmails as the OLD address only", () => {
    const line = correctionLine("parker.fairbairn@house.mi.gov", "ParkerFairbairn@house.mi.gov", "MI House", "https://www.house.mi.gov/AllRepresentatives", "2026-11-16");
    expect([...rejectedEmails(line)]).toEqual(["parker.fairbairn@house.mi.gov"]);
  });
});
