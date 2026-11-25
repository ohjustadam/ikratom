import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The brake must never read "all clear" because the host changed: an unknown
// host is BLIND (ok:false), a throwing adapter is BLIND, and the shape the
// brake consumes is the same whatever the adapter.
vi.mock("../scripts/lib/netlify-credits.mjs", () => ({
  readTrueCredits: vi.fn(async () => ({ ok: true, total: 1000, used: 500, daily: [{ date: "2026-11-25", total: 10, passive: 10 }] })),
}));

import { readUsageMeter, meterName, ADAPTERS } from "../scripts/lib/usage-meter.mjs";
import { evaluateBrake, liftAllowed } from "../scripts/lib/crawl-brake.mjs";

const saved = process.env.HOST_METER;
beforeEach(() => { delete process.env.HOST_METER; });
afterEach(() => { if (saved === undefined) delete process.env.HOST_METER; else process.env.HOST_METER = saved; });

describe("usage meter", () => {
  it("defaults to the netlify adapter", async () => {
    expect(meterName()).toBe("netlify");
    const t = await readUsageMeter();
    expect(t.ok).toBe(true);
    expect(t.total).toBe(1000);
  });

  it("an unknown host is blind, and says how to fix it", async () => {
    process.env.HOST_METER = "someothercloud";
    const t = await readUsageMeter();
    expect(t.ok).toBe(false);
    expect(t.reason).toMatch(/usage-meter\.mjs/);
  });

  it("a blind meter brakes nothing silently: the brake reports BLIND, and a lift is refused without --force", async () => {
    process.env.HOST_METER = "someothercloud";
    const truth = await readUsageMeter();
    expect(evaluateBrake({ stage: 1, truth }).blind).toBe(true);
    expect(liftAllowed({ truth }).ok).toBe(false);
    expect(liftAllowed({ truth, force: true }).ok).toBe(true);
  });

  it("an adapter that throws is blind, not a crash", async () => {
    process.env.HOST_METER = "boom";
    (ADAPTERS as Record<string, () => Promise<unknown>>).boom = async () => { throw new Error("api down"); };
    const t = await readUsageMeter();
    expect(t.ok).toBe(false);
    expect(t.reason).toMatch(/api down/);
    delete (ADAPTERS as Record<string, unknown>).boom;
  });
});
