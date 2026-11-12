import { describe, it, expect } from "vitest";
import {
  contactFromPerson, diffContacts, emailRank, markSharedPhones, normalise, rejectedEmails, provenanceLine, looksLikeAddress,
} from "../scripts/lib/legislator-contacts.mjs";

// Trimmed from openstates/people data/mi/legislature/Jay-DeBoyer-*.yml (2026-11-11).
const deboyer = {
  id: "ocd-person/569bf706-64ce-4dd7-8639-886beb018d8c",
  email: "jaydeboyer@house.mi.gov",
  offices: [
    { classification: "capitol", address: "Room H-372, Capitol Building 100 N. Capitol Ave., Lansing, MI 48933", voice: "517-373-1787" },
    { classification: "capitol-mail", address: "House Office Building P.O. Box 30014, Lansing, MI 48909" },
  ],
};
const ourDeboyer = {
  email: "jaydeboyerr@house.mi.gov",
  phone: "517-373-1787",
  office_address: "Room H-372, Capitol Building 100 N. Capitol Ave., Lansing, MI 48933",
  verified_sources_md: null,
};

describe("contactFromPerson", () => {
  it("reads the capitol office ahead of the capitol-mail PO box", () => {
    const c = contactFromPerson(deboyer);
    expect(c.email).toBe("jaydeboyer@house.mi.gov");
    expect(c.phone).toBe("517-373-1787");
    expect(c.office_address).toMatch(/^Room H-372/);
    expect(c.phone_capitol).toBe(true);
    expect(c.office_address_capitol).toBe(true);
  });

  it("drops an address that is only a state code, and a non-address email", () => {
    const c = contactFromPerson({ email: "https://example.com/contact", offices: [{ classification: "district", address: "KY", voice: "502-555-0100" }] });
    expect(c.email).toBeNull();
    expect(c.office_address).toBeNull();
    expect(c.phone_capitol).toBe(false);
  });
});

describe("diffContacts", () => {
  it("fixes the doubled-letter Michigan address PJ's letter bounced off", () => {
    expect(diffContacts(ourDeboyer, contactFromPerson(deboyer))).toEqual([
      { field: "email", from: "jaydeboyerr@house.mi.gov", to: "jaydeboyer@house.mi.gov" },
    ]);
  });

  it("ignores formatting noise", () => {
    const row = { ...ourDeboyer, email: "JayDeBoyer@house.mi.gov", phone: "(517) 373-1787", office_address: "Room H-372 Capitol Building 100 N Capitol Ave Lansing MI 48933" };
    expect(diffContacts(row, contactFromPerson(deboyer))).toEqual([]);
  });

  it("never clears a field upstream leaves blank", () => {
    expect(diffContacts(ourDeboyer, { email: null, phone: null, office_address: null })).toEqual([]);
  });

  it("never steps an official email down to a personal or business one", () => {
    const row = { email: "matt.simpson@alhouse.gov" };
    expect(diffContacts(row, { email: "mattsimpsonal96@gmail.com" })).toEqual([]);
    expect(diffContacts({ email: "jeff.sorrells@alhouse.gov" }, { email: "jeffs@fnbhartford.com" })).toEqual([]);
  });

  it("does step up, and fills an email that is empty or is a URL", () => {
    expect(diffContacts({ email: "janicerichsd7@gmail.com" }, { email: "janice.rich.senate@coleg.gov" })).toHaveLength(1);
    expect(diffContacts({ email: null }, { email: "mattsimpsonal96@gmail.com" })).toHaveLength(1);
    expect(diffContacts({ email: "https://www.repscheuren.com/contact" }, { email: "dscheuren@pahousegop.com" })).toHaveLength(1);
  });

  it("does not put back an address a checker already corrected", () => {
    const row = {
      email: "parkerfairbairn@house.mi.gov",
      verified_sources_md: `- Email corrected 2026-11-11: "parker.fairbairn@house.mi.gov" is not on the Michigan House's official roster.`,
    };
    expect(diffContacts(row, { email: "parker.fairbairn@house.mi.gov" })).toEqual([]);
  });

  it("replaces phone and address only from the capitol office, but fills from any", () => {
    const district = { phone: "502-233-3689", phone_capitol: false, office_address: "1016 Mount Vernon Drive Suite 3, Shelbyville, KY 40065", office_address_capitol: false };
    const row = { phone: "502-564-8100", office_address: "Room Annex 209B, 702 Capital Ave., Frankfort, KY 40601" };
    expect(diffContacts(row, district)).toEqual([]);
    expect(diffContacts({ phone: null, office_address: null }, district).map((c) => c.field)).toEqual(["phone", "office_address"]);
  });

  it("never replaces a direct line with a shared switchboard", () => {
    const up = { phone: "701-328-3373", phone_capitol: true, phone_shared: true };
    expect(diffContacts({ phone: "701-965-6973" }, up)).toEqual([]);
    expect(diffContacts({ phone: null }, up)).toHaveLength(1);
  });
});

describe("markSharedPhones", () => {
  it("flags a number five members of one state share, per state", () => {
    const mk = (state: string, phone: string) => ({ state, contact: { phone } as { phone: string; phone_shared?: boolean } });
    const list = [...Array.from({ length: 5 }, () => mk("ND", "701-328-3373")), mk("ND", "701-965-6973"), mk("SD", "(701) 328-3373")];
    markSharedPhones(list);
    expect(list.filter((e) => e.contact.phone_shared)).toHaveLength(5);
    expect(list[6].contact.phone_shared).toBe(false);
  });
});

describe("helpers", () => {
  it("ranks email domains", () => {
    expect(emailRank("a@house.mi.gov")).toBe(2);
    expect(emailRank("a@arkansashouse.org")).toBe(2);
    expect(emailRank("a@ilsenategop.org")).toBe(2);
    expect(emailRank("a@wyoleg.gov")).toBe(2);
    expect(emailRank("a@chrisbalkema.com")).toBe(1);
    expect(emailRank("a@gmail.com")).toBe(0);
  });

  it("normalises phones with a leading 1", () => {
    expect(normalise("phone", "+1 (517) 373-1787")).toBe(normalise("phone", "517.373.1787"));
  });

  it("reads rejected addresses from both checker phrasings", () => {
    const md = `- Email removed 2026-10-28: "x@pahousegop.gov" has a domain that cannot receive mail.\n- Email corrected 2026-11-01: "Y@yahoo.con" has a domain…`;
    expect([...rejectedEmails(md)]).toEqual(["x@pahousegop.gov", "y@yahoo.con"]);
  });

  it("writes a provenance line that keeps the old value", () => {
    const line = provenanceLine([{ field: "email", from: "a@x.gov", to: "b@x.gov" }], "ocd-person/1", "2026-11-11");
    expect(line).toBe(`- Contact refreshed 2026-11-11 from openstates/people (ocd-person/1): email "a@x.gov" -> "b@x.gov".`);
  });

  it("knows an address from a placeholder", () => {
    expect(looksLikeAddress("KY")).toBe(false);
    expect(looksLikeAddress("P.O. Box 8, Prospect, KY 40059")).toBe(true);
  });
});
