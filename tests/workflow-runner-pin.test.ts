import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// On 2026-11-16 GitHub moved ubuntu-latest to Ubuntu 26.04. playwright-chromium's
// postinstall refuses that OS, so `npm ci` failed in every job (CI and every cron)
// until each job was pinned to ubuntu-24.04. Unpin only after Playwright supports
// the new image and a run proves it.
const dir = join(__dirname, "..", ".github", "workflows");
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
const runsOn = files.flatMap((f) =>
  Array.from(readFileSync(join(dir, f), "utf8").matchAll(/^\s*runs-on:\s*(.+)$/gm)).map((m) => ({ file: f, label: m[1].trim() })),
);

describe("workflow runners", () => {
  it("reads the real workflow set (not an empty scan)", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(runsOn.length).toBeGreaterThanOrEqual(90);
  });

  it("never runs a Linux job on a floating ubuntu-latest image", () => {
    expect(runsOn.filter((r) => /ubuntu-latest/.test(r.label))).toEqual([]);
  });

  it("pins every Linux job to ubuntu-24.04", () => {
    const linux = runsOn.filter((r) => /ubuntu/.test(r.label));
    expect(linux.filter((r) => r.label !== "ubuntu-24.04")).toEqual([]);
  });
});
