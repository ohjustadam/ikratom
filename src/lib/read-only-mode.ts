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

import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";

export type ReadOnlyState =
  | { read_only: false }
  | { read_only: true; reason: string | null };

export async function getReadOnlyState(): Promise<ReadOnlyState> {
  try {
    const sb = await createClient();
    const { data } = await sb
      .from("site_config")
      .select("read_only_mode, read_only_reason")
      .eq("id", true)
      .maybeSingle();
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
