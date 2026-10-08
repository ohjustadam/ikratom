/**
 * email-render.test.ts — digest subjects must read like a person wrote them.
 * The 2026-10-05 test send reached a real inbox as "Hearing alert + 0 kratom
 * updates" with the preview line "1 updates".
 */
import { describe, it, expect } from "vitest";
import { renderDigest } from "../scripts/lib/email-render.mjs";

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
