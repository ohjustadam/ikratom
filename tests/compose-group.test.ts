/**
 * Tests for bill-level GROUP send (all reps / all senators / exec trio).
 *
 * Guards the exact bug class the alert-response panel produced on bill pages:
 * empty-recipient send links (Gmail/Outlook open with a blank To; a bare
 * `mailto:?...` no-ops). Here we prove the shared builders address the batch
 * (to + bcc) and that the mailto length guard trips before the client cap.
 */
import { describe, it, expect } from "vitest";
import {
  buildMailtoUrl,
  buildGmailComposeUrl,
  buildOutlookComposeUrl,
  mailtoWithinLimit,
} from "../src/modules/compose/send-links";

describe("send-links — multi-recipient (to + bcc)", () => {
  it("mailto puts the first recipient in the path and the rest in bcc", () => {
    const url = buildMailtoUrl("a@x.gov", "Subj", "Body", "b@x.gov,c@x.gov");
    expect(url.startsWith("mailto:a%40x.gov?")).toBe(true);
    expect(url).toContain("bcc=b%40x.gov%2Cc%40x.gov");
    expect(url).toContain("subject=Subj");
    // RFC 6068: spaces in the body encode as %20, never '+'.
    expect(buildMailtoUrl("a@x.gov", "S", "one two")).toContain("body=one%20two");
  });

  it("Gmail + Outlook carry the recipient and bcc in the right params", () => {
    const g = buildGmailComposeUrl("a@x.gov", "S", "B", "b@x.gov");
    expect(g).toContain("to=a%40x.gov");
    expect(g).toContain("bcc=b%40x.gov");
    expect(g).toContain("su=S");
    const o = buildOutlookComposeUrl("a@x.gov", "S", "B", "b@x.gov");
    expect(o).toContain("to=a%40x.gov");
    expect(o).toContain("bcc=b%40x.gov");
    expect(o).toContain("subject=S");
  });

  it("omits bcc entirely when not supplied (single recipient)", () => {
    expect(buildMailtoUrl("a@x.gov", "S", "B")).not.toContain("bcc=");
    expect(buildGmailComposeUrl("a@x.gov", "S", "B")).not.toContain("bcc=");
  });

  it("mailtoWithinLimit trips for a chamber-sized bcc (steer to Gmail/copy)", () => {
    const many = Array.from({ length: 110 }, (_, i) => `rep${i}@house.state.gov`).join(",");
    const bigUrl = buildMailtoUrl("chair@house.state.gov", "Oppose SB 1", "x".repeat(1500), many);
    expect(mailtoWithinLimit(bigUrl)).toBe(false);
    expect(mailtoWithinLimit(buildMailtoUrl("a@x.gov", "S", "short body"))).toBe(true);
  });
});
