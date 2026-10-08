"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";

/**
 * A page loaded before a deploy and used after it can no longer reach the
 * server: each build renames its server actions (and JS chunks), so a form
 * submit answers 404 x-nextjs-action-not-found and Next throws
 * UnrecognizedActionError. Without this, every form on the site (sign-in,
 * password reset, settings, posts) showed "Something broke" to anyone with a
 * tab open across a deploy — found 2026-10-06 when password reset "failed"
 * for the owner while working for everyone who loaded the page fresh.
 */
export function isStaleDeployError(error: unknown): boolean {
  if (unstable_isUnrecognizedActionError(error)) return true;
  const e = error as { name?: string; message?: string } | null;
  const name = e?.name ?? "";
  const msg = e?.message ?? "";
  return name === "UnrecognizedActionError"
    || name === "ChunkLoadError"
    || /was not found on the server|failed-to-find-server-action/i.test(msg)
    || /Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);
}

const KEY = "ikr-stale-reload-at";

/** Reload onto the new version, at most once a minute (never a reload loop). */
export function reloadOnceForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage blocked: still reload; a loop is impossible because a fresh page
    // carries the new action ids.
  }
  window.location.reload();
  return true;
}
