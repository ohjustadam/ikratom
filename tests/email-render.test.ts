/**
 * email-render.test.ts — digest subjects must read like a person wrote them.
 * The 2026-10-05 test send reached a real inbox as "Hearing alert + 0 kratom
 * updates" with the preview line "1 updates".
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { renderDigest, renderMeetingAlert, renderAnnouncement, emailLink, parseClickPath } from "../scripts/lib/email-render.mjs";

const meeting = { id: "m1", state: "NY", locality: "Clifton Park, NY", body_name: "Town Board", meeting_at: "2026-10-06T23:05:00Z" };
const item = { title: "Bill moves", link: "/bills/x" };
const base = { username: "tester", appUrl: "https://www.ikratom.org", unsubscribeUrl: "https://www.ikratom.org/u" };
const subject = (sections: unknown[]) => renderDigest({ ...base, sections } as never).subject as string;

describe("digest subject", () => {
  it("one hearing and nothing else: no '+ 0'", () => {
    const s = subject([{ title: "Hearings", meetings: [meeting] }]);
    expect(s).not.toMatch(/\+ 0|0 kratom/);
    expect(s).toBe("Kratom hearing coming up — who decides inside");
  });
  it("hearing plus updates, singular/plural right", () => {
    expect(subject([{ title: "H", meetings: [meeting] }, { title: "News", items: [item] }])).toBe("Hearing alert + 1 kratom update");
    expect(subject([{ title: "H", meetings: [meeting, { ...meeting, id: "m2" }] }, { title: "News", items: [item, item] }])).toBe("2 hearings + 2 kratom updates");
  });
  it("updates only", () => {
    expect(subject([{ title: "News", items: [item] }])).toBe("1 kratom policy update for you");
    expect(subject([{ title: "News", items: [item, item, item] }])).toBe("3 kratom policy updates for you");
  });
  it("preview line never says '1 updates'", () => {
    const html = renderDigest({ ...base, sections: [{ title: "News", items: [item] }] } as never).html as string;
    expect(html).not.toMatch(/\b1 updates\b/);
  });
});

// Click counting (owner, 2026-10-29): two weeks of numbers decide how much of a
// story an email carries. A wrong tag is a dead link in every inbox.
describe("email click counting", () => {
  const APP = base.appUrl;
  it("routes iKratom links through /e/<kind>/ and leaves outside links alone", () => {
    expect(emailLink(APP, "/bills/1", "digest")).toBe(`${APP}/e/digest/bills/1`);
    expect(emailLink(APP, "bills/1", "digest")).toBe(`${APP}/e/digest/bills/1`);
    expect(emailLink(APP, "/?lounge=abc", "digest")).toBe(`${APP}/e/digest/?lounge=abc`);
    expect(emailLink(APP, null, "digest")).toBe(`${APP}/e/digest/`);
    expect(emailLink(APP, `${APP}/news/x`, "digest")).toBe(`${APP}/e/digest/news/x`);
    expect(emailLink(APP, "https://zoom.us/j/1", "hearing")).toBe("https://zoom.us/j/1");
  });
  it("without a kind, links are exactly what they were", () => {
    expect(emailLink(APP, "/bills/1")).toBe(`${APP}/bills/1`);
    expect(emailLink(APP, null)).toBe(APP);
    expect(emailLink(APP, `${APP}/news/x`)).toBe(`${APP}/news/x`);
    const plain = renderDigest({ ...base, sections: [{ title: "News", items: [item] }] } as never).html as string;
    expect(plain).not.toContain("/e/");
  });
  it("tags every content link but never unsubscribe or settings", () => {
    const html = renderDigest({ ...base, via: "digest", briefLink: "/brief", sections: [{ title: "H", meetings: [meeting] }, { title: "News", items: [item] }] } as never).html as string;
    expect(html).toContain(`${APP}/e/digest/bills/x`);
    expect(html).toContain(`${APP}/e/digest/brief`);
    expect(html).toContain(`${APP}/e/digest/meetings/m1`);
    expect(html).toContain(`href="${APP}/account"`);
    expect(html).toContain(`href="${base.unsubscribeUrl}"`);
    const alert = renderMeetingAlert({ ...base, meetings: [meeting], via: "hearing" } as never).html as string;
    expect(alert).toContain(`${APP}/e/hearing/meetings/m1`);
  });
  it("a full report's own links are tagged, its outside sources are not", () => {
    const html = renderAnnouncement({ ...base, subject: "s", intro: "i", pageLink: "/briefings/r", via: "report",
      md: "See [the bill](/bills/1) and [the notice](https://www.federalregister.gov/d/1)." } as never).html as string;
    expect(html).toContain(`${APP}/e/report/bills/1`);
    expect(html).toContain(`${APP}/e/report/briefings/r`);
    expect(html).toContain('href="https://www.federalregister.gov/d/1"');
  });
  it("parseClickPath reads the kind and the page back, and skips the sender's probe", () => {
    expect(parseClickPath("/e/digest/bills/x")).toEqual({ kind: "digest", page: "bills" });
    expect(parseClickPath("/e/digest/")).toEqual({ kind: "digest", page: "home" });
    expect(parseClickPath("/e/probe/notifications")).toBeNull();
    expect(parseClickPath("/bills/x")).toBeNull();
  });
  it("netlify.toml still forwards /e/ paths, which the links depend on", () => {
    const toml = fs.readFileSync("netlify.toml", "utf8");
    expect(toml).toMatch(/from = "\/e\/:kind\/\*"\s+to = "\/:splat"\s+status = 302/);
  });
});
