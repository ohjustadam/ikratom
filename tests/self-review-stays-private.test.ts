import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

/**
 * This repo is public, so whatever a job writes to an issue, a run summary or a
 * log is public too. The weekly self-review is for internal use (owner,
 * 2026-11-06), so it runs by hand on the owner's machine until it has a private
 * destination. Turning it back on should be a decision someone makes in a diff.
 */
describe("the weekly self-review stays out of public CI", () => {
  const wf = load(readFileSync(join(".github", "workflows", "cron-weekly.yml"), "utf8")) as {
    jobs: Record<string, { if?: unknown }>;
  };

  it("is paused", () => {
    expect(wf.jobs["weekly-self-review"], "the job was renamed, so this guard reads nothing").toBeTruthy();
    expect(wf.jobs["weekly-self-review"].if).toBe(false);
  });
});
