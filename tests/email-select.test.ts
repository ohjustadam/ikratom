/**
 * email-select.test.ts — the daily email must not repeat itself.
 *
 * 2026-10-05: the digest listed every upcoming hearing, so one hearing three
 * weeks out would have arrived in every member's inbox for 21 days straight,
 * and a placeholder address burned a send on a guaranteed 422.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isDeliverable, digestHearings } from "../scripts/lib/email-select.mjs";

const NOW = Date.parse("2026-10-05T19:00:00Z");
const h = (id: string, meetingAt: string, reviewedAt: string) => ({ id, meeting_at: meetingAt, moderation_reviewed_at: reviewedAt });

describe("digestHearings", () => {
  const lastDigest = "2026-10-04T10:17:00Z";
  const meetings = [
    h("tomorrow-old", "2026-10-06T23:05:00Z", "2026-10-01T00:00:00Z"),
    h("far-new", "2026-10-20T23:00:00Z", "2026-10-05T12:00:00Z"),
    h("far-old", "2026-10-21T23:00:00Z", "2026-10-02T00:00:00Z"),
  ];

  it("keeps hearings confirmed since the last digest and ones within 48 hours", () => {
    expect(digestHearings(meetings, lastDigest, NOW).map((m: { id: string }) => m.id)).toEqual(["tomorrow-old", "far-new"]);
  });

  it("drops a far-off hearing the member was already told about", () => {
    expect(digestHearings([meetings[2]], lastDigest, NOW)).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 9 }, (_, i) => h(`m${i}`, "2026-10-06T12:00:00Z", "2026-10-01T00:00:00Z"));
    expect(digestHearings(many, lastDigest, NOW)).toHaveLength(5);
  });
});

describe("isDeliverable", () => {
  it("accepts real addresses", () => {
    expect(isDeliverable("someone@gmail.com")).toBe(true);
    expect(isDeliverable("a.b+tag@proton.me")).toBe(true);
  });
  it("rejects placeholders Resend refuses", () => {
    for (const e of ["x@example.com", "x@example.org", "x@site.test", "x@box.local", "x@a.invalid", "nope", "", null]) {
      expect(isDeliverable(e)).toBe(false);
    }
  });
});

describe("send-email-notifications wiring", () => {
  const src = readFileSync("scripts/send-email-notifications.mjs", "utf8");
  it("uses the hearing filter, not every upcoming hearing", () => {
    expect(src).toMatch(/meetings: digestHearings\(meetings, from, now\)/);
  });
  it("refuses a second digest within 12 hours unless forced", () => {
    expect(src).toMatch(/now - Date\.parse\(last\) < 12 \* 3600e3/);
    expect(src).toMatch(/--force/);
  });
  it("skips undeliverable addresses before they cost quota", () => {
    expect(src).toMatch(/if \(!isDeliverable\(p\.email\)\) return false/);
  });
});
