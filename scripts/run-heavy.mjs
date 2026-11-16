#!/usr/bin/env node
/**
 * run-heavy.mjs — run a CPU-heavy local command without taking over the PC.
 *
 *   node scripts/run-heavy.mjs npm run verify:run
 *
 * Owner, 2026-11-16: parallel Claude sessions running the test suite at once
 * pinned all 12 cores of his own computer. On a local run this wrapper:
 *   1. drops to below-normal priority. Windows children inherit it, so tsc and
 *      every vitest fork give way to whatever the owner is doing;
 *   2. waits for scripts/lib/heavy-lock.mjs, so only ONE heavy job runs on the
 *      machine at a time, whichever session or worktree started it.
 * vitest.config.ts also caps local runs at 4 forks (VITEST_MAX_WORKERS
 * overrides). CI skips the lock and the priority change: it has its own runner.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import { holder, lockPath, release, tryLock } from "./lib/heavy-lock.mjs";

const cmd = process.argv.slice(2).join(" ");
if (!cmd) {
  console.error("usage: node scripts/run-heavy.mjs <command>");
  process.exit(2);
}

let file = null;
if (!process.env.CI && !process.env.HEAVY_LOCK_HELD) {
  try {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    /* not permitted here; the lock still applies */
  }
  file = lockPath();
  const started = Date.now();
  let told = false;
  while (!tryLock(file, { pid: process.pid, cmd, at: Date.now() })) {
    if (!told) {
      const h = holder(file);
      console.log(`run-heavy: waiting for another heavy job${h ? ` (pid ${h.pid}: ${h.cmd})` : ""}; one at a time keeps the PC usable.`);
      told = true;
    }
    if (Date.now() - started > 20 * 60_000) {
      console.log("run-heavy: waited 20 minutes, running anyway.");
      file = null;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const child = spawn(cmd, { shell: true, stdio: "inherit", env: { ...process.env, HEAVY_LOCK_HELD: "1" } });
const finish = (code) => {
  if (file) release(file);
  process.exit(code);
};
child.on("exit", (code, signal) => finish(code ?? (signal ? 1 : 0)));
child.on("error", () => finish(1));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
