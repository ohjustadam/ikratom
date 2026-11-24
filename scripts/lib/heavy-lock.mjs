/**
 * heavy-lock.mjs — one CPU-heavy local job at a time on this machine.
 *
 * Owner, 2026-11-16: several Claude sessions each ran `npm run verify` at
 * once. Every run is tsc plus a vitest fork per core, so three of them pinned
 * all 12 cores of his own PC. The lock lives in the git COMMON dir, which the
 * main checkout and every worktree share, so all sessions see the same file.
 *
 * A lock whose owner process is gone, or that is older than MAX_HOLD_MS, is
 * stale and gets taken over, so a crashed run never blocks the next one.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export const MAX_HOLD_MS = 20 * 60_000;

/** The shared lock file for this repository (same path from any worktree). */
export function lockPath(cwd = process.cwd()) {
  const common = execSync("git rev-parse --git-common-dir", { cwd, encoding: "utf8" }).trim();
  return path.join(path.resolve(cwd, common), "heavy-job.lock");
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // exists, owned by someone else
  }
}

function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Take the lock if it is free or stale. Returns true when this caller holds it. */
export function tryLock(file, me = { pid: process.pid, cmd: "", at: Date.now() }, now = Date.now()) {
  try {
    fs.writeFileSync(file, JSON.stringify(me), { flag: "wx" });
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const cur = readLock(file);
  const stale = !cur || !pidAlive(cur.pid) || now - (cur.at ?? 0) > MAX_HOLD_MS;
  if (!stale) return false;
  try {
    fs.unlinkSync(file);
  } catch {
    /* another waiter removed it first */
  }
  try {
    fs.writeFileSync(file, JSON.stringify(me), { flag: "wx" });
    return true;
  } catch {
    return false; // another waiter won the race; try again later
  }
}

/** Release the lock, only if this process holds it. */
export function release(file, pid = process.pid) {
  if (readLock(file)?.pid !== pid) return;
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}

/** Who holds the lock right now, for the waiting message. */
export function holder(file) {
  const cur = readLock(file);
  return cur && pidAlive(cur.pid) ? cur : null;
}
