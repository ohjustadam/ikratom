import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  normName, nameKeys, chamberOf, personName, matchPerson, matchVoterName, collisionFree, sameName,
} from "../scripts/lib/legiscan-people.mjs";

const leg = (id: string, full_name: string, role: string, district: string, legiscan_people_id: number | null = null) =>
  ({ id, full_name, role, district, legiscan_people_id });

describe("normName / nameKeys", () => {
  it("reads 'Last, First' and drops titles and suffixes", () => {
    expect(normName("Smith, Jane Q.")).toBe("jane q smith");
    expect(normName("Sen. Jane Smith Jr.")).toBe("jane smith");
    expect(normName("José O'Brien")).toBe("jose obrien");
  });
  it("adds a key without middle initials", () => {
    expect(nameKeys("Jane Q. Smith").has("jane smith")).toBe(true);
  });
});

describe("chamberOf", () => {
  it("maps LegiScan roles and our roles", () => {
    expect(chamberOf("Sen")).toBe("senate");
    expect(chamberOf("Rep")).toBe("house");
    expect(chamberOf("state_senate")).toBe("senate");
    expect(chamberOf("state_house")).toBe("house");
    expect(chamberOf("governor")).toBe("");
  });
});

describe("matchPerson", () => {
  const cands = [
    leg("a", "Bill Anderson", "state_house", "12"),
    leg("b", "Jane Q. Smith", "state_senate", "4"),
    leg("c", "Zack Grady", "state_house", "15"),
    leg("d", "Pat Moore", "state_house", "7"),
    leg("e", "Pat Moore", "state_house", "9"),
    leg("f", "Ann Lee", "state_house", "3", 999),
  ];

  it("matches by name within the chamber", () => {
    expect(matchPerson({ people_id: 1, name: "Jane Smith", role: "Sen", district: "SD-004" }, cands)).toBe("b");
  });
  it("matches a nickname through LegiScan's nickname field", () => {
    const p = { people_id: 2, name: "William Anderson", first_name: "William", last_name: "Anderson", nickname: "Bill", role: "Rep", district: "HD-012" };
    expect(matchPerson(p, cands)).toBe("a");
  });
  it("never matches by seat alone: a predecessor is not the current member", () => {
    const p = { people_id: 6522, name: "Randall Patterson", last_name: "Patterson", role: "Rep", district: "HD-015" };
    expect(matchPerson(p, cands)).toBeNull();
  });
  it("matches the same last name in the same seat", () => {
    const p = { people_id: 3, name: "Isaac Grady", first_name: "Isaac", last_name: "Grady", role: "Rep", district: "HD-015" };
    expect(matchPerson(p, cands)).toBe("c");
  });
  it("refuses an ambiguous name unless the seat settles it", () => {
    expect(matchPerson({ people_id: 4, name: "Pat Moore", last_name: "Moore", role: "Rep", district: "" }, cands)).toBeNull();
    expect(matchPerson({ people_id: 4, name: "Pat Moore", last_name: "Moore", role: "Rep", district: "HD-009" }, cands)).toBe("e");
  });
  it("won't use the other chamber", () => {
    expect(matchPerson({ people_id: 5, name: "Jane Smith", role: "Rep" }, cands)).toBeNull();
  });
  it("won't take a legislator already tied to another people_id", () => {
    expect(matchPerson({ people_id: 7, name: "Ann Lee", role: "Rep" }, cands)).toBeNull();
    expect(matchPerson({ people_id: 999, name: "Ann Lee", role: "Rep" }, cands)).toBe("f");
  });
  it("doesn't trust an existing tie whose name disagrees", () => {
    const wrong = [leg("c", "Zack Grady", "state_house", "15", 6522)];
    expect(matchPerson({ people_id: 6522, name: "Randall Patterson", last_name: "Patterson", role: "Rep", district: "HD-015" }, wrong)).toBeNull();
  });
});

describe("sameName", () => {
  it("accepts a nickname or a shared last name, rejects a different person", () => {
    expect(sameName({ name: "Michael Karickhoff", last_name: "Karickhoff" }, "Mike Karickhoff")).toBe(true);
    expect(sameName({ name: "Doug McLeod", last_name: "McLeod" }, "Steve Lott")).toBe(false);
  });
});

describe("personName", () => {
  it("falls back to the name parts", () => {
    expect(personName({ first_name: "Jane", last_name: "Smith" })).toBe("Jane Smith");
    expect(personName(null)).toBe("");
  });
});

describe("matchVoterName (OpenStates)", () => {
  const cands = [
    leg("t", "Paul Torkelson", "state_house", "15"),
    leg("j1", "Mark Johnson", "state_house", "1"),
    leg("j2", "Ann Johnson", "state_house", "2"),
    leg("s", "Jackie Terribile", "state_house", "3"),
  ];
  it("matches 'Last, First M.'", () => {
    expect(matchVoterName("Terribile, Jackie R.", cands, { chamber: "house", voteDate: "2024-03-01" })).toBe("s");
  });
  it("matches a bare last name only for recent votes and only when unique", () => {
    expect(matchVoterName("Torkelson", cands, { chamber: "house", voteDate: "2026-02-01" })).toBe("t");
    expect(matchVoterName("Torkelson", cands, { chamber: "house", voteDate: "2019-02-01" })).toBeNull();
    expect(matchVoterName("Johnson", cands, { chamber: "house", voteDate: "2026-02-01" })).toBeNull();
  });
  it("uses an initial to split a shared last name", () => {
    expect(matchVoterName("Johnson, M.", cands, { chamber: "house", voteDate: "2026-02-01" })).toBe("j1");
  });
});

describe("collisionFree", () => {
  it("drops a legislator claimed by two people_ids", () => {
    const out = collisionFree([{ pid: 1, legId: "a" }, { pid: 2, legId: "a" }, { pid: 3, legId: "b" }]);
    expect(out).toEqual([{ pid: 3, legId: "b" }]);
  });
});

describe("the LegiScan sync names every vote", () => {
  const src = readFileSync("scripts/sync-bills-via-legiscan.mjs", "utf8");
  it("reads session people and matches through the shared helper", () => {
    expect(src).toContain('legiscanFetch("getSessionPeople"');
    expect(src).toMatch(/import \{[^}]*matchPerson[^}]*\} from "\.\/lib\/legiscan-people\.mjs"/);
    expect(src).toContain("personName(people.get(m.people_id))");
  });
  it("has no seat-only fallback", () => {
    expect(src).not.toMatch(/district[^\n]*legislator_id/);
  });
});
