import { describe, it, expect } from "vitest";
import { bylineFrom, findPaperAuthor, findWriter } from "../scripts/lib/press-contacts.mjs";
import { pressLetter } from "../src/modules/press/letter";

const story = { url: "https://poststar.com/news/a", sourceName: "The Post Star" };

describe("a story's writer", () => {
  it("takes a person's address on the outlet's domain from the end of the story", () => {
    const paragraphs = ["The board met.", "Contact Nicole Holdridge at nholdridge@poststar.com."];
    expect(findWriter({ ...story, paragraphs })).toEqual({
      email: "nholdridge@poststar.com",
      name: "Nicole Holdridge",
    });
  });

  it("reads a name out of a dotted address when nothing else names them", () => {
    const paragraphs = ["Have a tip? edward.callahan@patch.com"];
    const found = findWriter({ url: "https://patch.com/x", sourceName: "Patch", paragraphs });
    expect(found?.name).toBe("Edward Callahan");
  });

  it("accepts another domain when the address matches the byline", () => {
    const html = `<script>{"author":{"@type":"Person","name":"Mike Smith"}}</script>`;
    const paragraphs = ["Email Mike Smith at msmith@theadvocate.com."];
    const found = findWriter({ html, paragraphs, url: "https://www.nola.com/a", sourceName: "NOLA.com" });
    expect(found).toEqual({ email: "msmith@theadvocate.com", name: "Mike Smith" });
  });

  it("skips shared inboxes", () => {
    for (const address of ["opinions@poststar.com", "newsroom@poststar.com", "tips@poststar.com"]) {
      expect(findWriter({ ...story, paragraphs: [`Write to ${address}`] })).toBeNull();
    }
  });

  it("skips CBS's placeholder", () => {
    const paragraphs = ["Send a tip to yourreporter@cbs.com"];
    expect(findWriter({ url: "https://cbsnews.com/a", sourceName: "CBS News", paragraphs })).toBeNull();
  });

  it("skips someone quoted in the story", () => {
    const paragraphs = ["Questions go to jeremy.c.brann@dos.nh.gov", "Or jane@kratomgroup.org"];
    expect(findWriter({ ...story, paragraphs })).toBeNull();
  });

  it("doesn't trust an outlet address from the middle of a story", () => {
    const paragraphs = ["A letter to jsmith@poststar.com said so.", ...Array(9).fill("More text.")];
    expect(findWriter({ ...story, paragraphs })).toBeNull();
  });

  it("finds nothing in a story with no address", () => {
    expect(findWriter({ ...story, paragraphs: ["Nothing here."] })).toBeNull();
  });

  it("doesn't take an organization for a byline", () => {
    expect(bylineFrom(`<meta name="author" content="staff">`)).toBeNull();
    expect(bylineFrom(`<meta name="author" content="Jane Doe">`)).toBe("Jane Doe");
  });
});

describe("a paper's author", () => {
  it("takes the first author who printed an address", () => {
    const xml = `<Author><LastName>Lee</LastName><ForeName>Ann</ForeName></Author>
      <Author><LastName>Roy</LastName><ForeName>Sam</ForeName>
      <AffiliationInfo><Affiliation>Univ. Electronic address: sroy@uni.edu.</Affiliation></AffiliationInfo></Author>`;
    expect(findPaperAuthor(xml)).toEqual({ email: "sroy@uni.edu", name: "Sam Roy" });
  });

  it("writes accented names out properly", () => {
    const xml = `<Author><LastName>Roy</LastName><ForeName>Al&#xeb;na</ForeName>
      <AffiliationInfo><Affiliation>aroy@uni.edu</Affiliation></AffiliationInfo></Author>`;
    expect(findPaperAuthor(xml)?.name).toBe("Alëna Roy");
  });

  it("finds nothing when no author printed one", () => {
    expect(findPaperAuthor(`<Author><LastName>Lee</LastName></Author>`)).toBeNull();
  });
});

describe("the starter letter", () => {
  it("greets by name and quotes the piece", () => {
    const { body } = pressLetter({ kind: "reporter", name: "Jane Doe", title: "Kratom in Tulsa" });
    expect(body).toContain("Dear Jane Doe,");
    expect(body).toContain('"Kratom in Tulsa"');
  });

  it("has a plain greeting without a name", () => {
    expect(pressLetter({ kind: "reporter", name: null, title: "T" }).body).toContain("Hello,");
  });

  it("gives a member a short subject that doesn't pretend to be a reply", () => {
    for (const kind of ["reporter", "researcher"] as const) {
      const { subject } = pressLetter({ kind, name: null, title: "T" });
      expect(subject.length).toBeLessThanOrEqual(30);
      expect(subject).not.toMatch(/^re:/i);
    }
  });
});
