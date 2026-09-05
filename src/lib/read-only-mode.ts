/**
 * Read-only-mode gate.
 *
 * When the `site_config.read_only_mode` flag is true, the application
 * layer refuses non-admin mutations across the platform. Used as the
 * emergency brake when something is wrong (suspected compromise, spam
 * wave, DB quota issue) and admins need a moment to triage without
 * taking the whole site offline.
 *
 * Callers: every mutating server action should call
 * `assertNotReadOnly()` before touching the DB. If the function
 * throws (or returns the error result), the action is refused.
 *
 * Admins bypass the gate so they can clean up whatever triggered
 * the lockdown.
 *
 * No caching: each check is a single small DB read. The site_config
 * table is a singleton with one row; the read is microseconds.
 */

import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAdminContext } from "@/modules/admin/actions";

export type ReadOnlyState =
  | { read_only: false }
  | { read_only: true; reason: string | null };

/**
 * site_config is ONE row, identical for every visitor, and this was reading it
 * live on every call — 954 billable DB reads/day (5% of all Netlify-side reads,
 * 2026-09-01 measurement). Cached for 30s with the service-role client, which
 * is safe here because the row is global config, not user data, and we select
 * only the two read-only columns.
 *
 * 30s, not longer: flipping read-only mode is an emergency lever, and a stale
 * "writes allowed" window is the failure this must not create. Half a minute
 * removes ~98% of the reads while keeping the lever effectively immediate.
 */
const readReadOnlyRow = unstable_cache(
  async () => {
    const sb = createServiceRoleClient();
    const { data } = await sb
      .from("site_config")
      .select("read_only_mode, read_only_reason")
      .eq("id", true)
      .maybeSingle();
    return data ?? null;
  },
  ["site-config-read-only"],
  // 30s -> 10min (2026-09-04). Read-only mode is an emergency lever, so the
  // short TTL was buying responsiveness — but updateReadOnlyMode() now calls
  // updateTag("site-config"), which makes the toggle take effect AT ONCE
  // instead of within 30s. The TTL is just the backstop, and polling
  // site_config every 30 seconds cost ~950 reads/day to learn nothing.
  { revalidate: 600, tags: ["site-config"] },
);

export async function getReadOnlyState(): Promise<ReadOnlyState> {
  try {
    const data = await readReadOnlyRow();
    if (!data) return { read_only: false };
    const row = data as { read_only_mode: boolean; read_only_reason: string | null };
    if (row.read_only_mode) {
      return { read_only: true, reason: row.read_only_reason };
    }
    return { read_only: false };
  } catch {
    // If we can't read site_config, fail OPEN — accepting writes.
    // The alternative (fail closed) would brick mutations on a transient
    // DB hiccup, which is worse than briefly accepting writes.
    return { read_only: false };
  }
}

/**
 * Helper for server actions. Returns null if the action should proceed,
 * or an error message string if the action should refuse. Admins bypass.
 *
 * Usage:
 *   const ro = await assertNotReadOnly();
 *   if (ro) return { error: ro };
 */
export async function assertNotReadOnly(): Promise<string | null> {
  const state = await getReadOnlyState();
  if (!state.read_only) return null;
  const ctx = await getAdminContext();
  if (ctx.ok && (ctx.isAdmin || ctx.isOwner)) return null;
  const reason = state.reason ? ` (${state.reason})` : "";
  return `The platform is currently in read-only mode${reason}. New submissions are temporarily paused. Please try again shortly.`;
}
