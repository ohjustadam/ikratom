import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_HOLD_MS, release, tryLock } from "../scripts/lib/heavy-lock.mjs";

// Owner, 2026-11-16: parallel sessions' test runs pinned his PC's CPU.
const file = path.join(os.tmpdir(), `heavy-lock-test-${process.pid}.lock`);
afterEach(() => fs.rmSync(file, { force: true }));

describe("heavy-lock", () => {
  it("lets one holder in and keeps a second out while the first is alive", () => {
    expect(tryLock(file, { pid: process.pid, cmd: "a", at: Date.now() })).toBe(true);
    expect(tryLock(file, { pid: process.pid + 1, cmd: "b", at: Date.now() })).toBe(false);
    release(file);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("takes over a lock whose process is gone", () => {
    fs.writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 7, cmd: "dead", at: Date.now() }));
    expect(tryLock(file, { pid: process.pid, cmd: "me", at: Date.now() })).toBe(true);
  });

  it("takes over a lock held too long, and ignores a release from a non-holder", () => {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, cmd: "old", at: Date.now() - MAX_HOLD_MS - 1 }));
    expect(tryLock(file, { pid: process.pid, cmd: "me", at: Date.now() })).toBe(true);
    release(file, process.pid + 1);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("verify and verify:full go through the wrapper, and local vitest is capped", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    expect(pkg.scripts.verify).toMatch(/^node scripts\/run-heavy\.mjs /);
    expect(pkg.scripts["verify:full"]).toMatch(/^node scripts\/run-heavy\.mjs /);
    const cfg = fs.readFileSync(path.join(__dirname, "..", "vitest.config.ts"), "utf8");
    expect(cfg).toMatch(/maxWorkers:\s*process\.env\.CI/);
  });
});
