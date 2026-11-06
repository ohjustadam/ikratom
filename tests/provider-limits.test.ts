import { describe, it, expect } from "vitest";
import {
  detectTier,
  resolveLimits,
  tiersForProvider,
  planParts,
  capForNewAccount,
  NEW_ACCOUNT_DAILY,
  NEW_ACCOUNT_HOURS,
} from "@/lib/email/provider-limits";
import { readFileSync } from "node:fs";

describe("detectTier", () => {
  it("treats consumer gmail domains as free", () => {
    expect(detectTier("gmail", "someone@gmail.com")).toBe("gmail_free");
    expect(detectTier("gmail", "someone@googlemail.com")).toBe("gmail_free");
    // case + whitespace must not change the verdict — these arrive from OAuth
    expect(detectTier("gmail", "  Someone@GMAIL.com ")).toBe("gmail_free");
  });

  it("treats a custom domain on the Gmail API as Workspace", () => {
    // Load-bearing inference: a free Gmail account cannot send from a custom
    // domain via the API, so this direction is sound rather than a guess.
    expect(detectTier("gmail", "advocate@ikratom.org")).toBe("gmail_workspace");
  });

  it("separates consumer Outlook from a work tenant", () => {
    for (const d of ["outlook.com", "hotmail.com", "live.com", "msn.com"]) {
      expect(detectTier("outlook", `a@${d}`)).toBe("outlook_consumer");
    }
    expect(detectTier("outlook", "a@contoso.com")).toBe("outlook_business");
  });

  it("falls to the FLOOR when the address is unknown", () => {
    // Being wrong low costs patience; being wrong high costs the user's
    // account standing. Unknown must never resolve to the generous tier.
    expect(detectTier("gmail", null)).toBe("gmail_free");
    expect(detectTier("gmail", "")).toBe("gmail_free");
    expect(detectTier("outlook", undefined)).toBe("outlook_consumer");
  });
});

describe("resolveLimits", () => {
  it("applies safety headroom rather than the documented ceiling", () => {
    const g = resolveLimits("gmail", "a@gmail.com");
    expect(g.documentedDaily).toBe(500);
    expect(g.effectiveDaily).toBe(425); // 500 * 0.85
    expect(g.effectiveDaily).toBeLessThan(g.documentedDaily);
  });

  it("honours a user override for the same provider", () => {
    const r = resolveLimits("gmail", "a@gmail.com", "gmail_workspace");
    expect(r.tier).toBe("gmail_workspace");
    expect(r.effectiveDaily).toBe(1700); // 2000 * 0.85
  });

  it("IGNORES an override belonging to a different provider", () => {
    // A stale outlook_business override left over from a previous connection
    // must not hand a free Gmail account a 10,000/day allowance.
    const r = resolveLimits("gmail", "a@gmail.com", "outlook_business");
    expect(r.tier).toBe("gmail_free");
    expect(r.effectiveDaily).toBe(425);
  });

  it("carries pacing that matches the provider's real constraint", () => {
    expect(resolveLimits("outlook", "a@contoso.com").maxPerMinute).toBe(30);
    expect(resolveLimits("gmail", "a@gmail.com").maxPerMinute).toBe(60);
  });
});

describe("tiersForProvider", () => {
  it("offers only tiers belonging to that provider", () => {
    expect(tiersForProvider("gmail").map((t) => t.tier).sort()).toEqual([
      "gmail_free",
      "gmail_workspace",
    ]);
    expect(tiersForProvider("outlook").map((t) => t.tier).sort()).toEqual([
      "outlook_business",
      "outlook_consumer",
    ]);
  });
});

describe("planParts", () => {
  const gmailFree = resolveLimits("gmail", "a@gmail.com"); // 425/day

  it("fits entirely in part 1 when today's headroom covers it", () => {
    expect(planParts(198, gmailFree, 425)).toEqual([
      { part: 1, count: 198, sameDay: true },
    ]);
  });

  it("splits across days when the total exceeds today's headroom", () => {
    // The exact shape the owner asked for: "send 1 to 200", then "send 2 to 98".
    const parts = planParts(298, gmailFree, 200);
    expect(parts).toEqual([
      { part: 1, count: 200, sameDay: true },
      { part: 2, count: 98, sameDay: false },
    ]);
    expect(parts.reduce((a, p) => a + p.count, 0)).toBe(298);
  });

  it("uses REMAINING headroom, not the full allowance, for part 1", () => {
    // A user who already sent 400 of 425 today gets a first part of 25.
    const parts = planParts(100, gmailFree, 25);
    expect(parts[0]).toEqual({ part: 1, count: 25, sameDay: true });
    expect(parts[1]).toEqual({ part: 2, count: 75, sameDay: false });
  });

  it("starts tomorrow when nothing is left today", () => {
    const parts = planParts(50, gmailFree, 0);
    expect(parts).toEqual([{ part: 1, count: 50, sameDay: false }]);
  });

  it("never loses or duplicates a recipient across many parts", () => {
    const total = 5000;
    const parts = planParts(total, gmailFree, 10);
    expect(parts.reduce((a, p) => a + p.count, 0)).toBe(total);
    expect(parts.every((p) => p.count > 0)).toBe(true);
  });

  it("returns nothing for an empty selection", () => {
    expect(planParts(0, gmailFree, 425)).toEqual([]);
  });
});

describe("capForNewAccount", () => {
  const gmail = resolveLimits("gmail", "someone@gmail.com");
  const now = Date.parse("2026-11-05T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

  it("holds a day-one account to the new-account limit, whatever the mailbox allows", () => {
    const capped = capForNewAccount(gmail, hoursAgo(1), now);
    expect(capped.effectiveDaily).toBe(NEW_ACCOUNT_DAILY);
    expect(capped.newAccount).toBe(true);
    expect(capped.label).toBe(gmail.label);
  });
  it("lifts at the line, not after it", () => {
    expect(capForNewAccount(gmail, hoursAgo(NEW_ACCOUNT_HOURS - 1), now).effectiveDaily).toBe(NEW_ACCOUNT_DAILY);
    expect(capForNewAccount(gmail, hoursAgo(NEW_ACCOUNT_HOURS), now)).toBe(gmail);
  });
  it("never raises a limit that's already lower", () => {
    const small = { ...gmail, effectiveDaily: 20 };
    expect(capForNewAccount(small, hoursAgo(1), now)).toBe(small);
  });
  it("leaves the limit alone when the join date is missing or unreadable", () => {
    expect(capForNewAccount(gmail, null, now)).toBe(gmail);
    expect(capForNewAccount(gmail, "not a date", now)).toBe(gmail);
  });
  it("splits a long list across days at the new-account size", () => {
    const parts = planParts(101, capForNewAccount(gmail, hoursAgo(1), now), NEW_ACCOUNT_DAILY);
    expect(parts.map((x) => x.count)).toEqual([50, 50, 1]);
    expect(parts.map((x) => x.sameDay)).toEqual([true, false, false]);
  });
  it("both the queue and the worker apply it", () => {
    const queue = readFileSync("src/modules/campaigns/send-batch-actions.ts", "utf8");
    expect(queue.match(/capForNewAccount\(/g)?.length).toBeGreaterThanOrEqual(2);
    const worker = readFileSync("src/modules/campaigns/drain-batch.ts", "utf8");
    expect(worker).toMatch(/capForNewAccount\(/);
    expect(worker).toMatch(/email_provider_tier, created_at/);
  });
});
