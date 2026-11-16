/**
 * The 7-day resend lock, minus officials whose email was fixed (PJ, 2026-11-13).
 *
 * PJ's letters to three Michigan House members bounced because the addresses
 * on file were wrong. The addresses were corrected the next day, but the lock
 * still said "you've sent this campaign to all your legislators". A send only
 * counts toward the lock if it went out AFTER the official's email last
 * changed (legislators.email_changed_at, migration 0322).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const RESEND_COOLDOWN_HOURS = 24 * 7; // 1 week: same campaign + same official

export type CooldownSend = { legislator_id: string | null; sent_at: string };

/** Officials still locked: a send inside the window that postdates their last email change. */
export function coolingTargets(
  sends: CooldownSend[],
  emailChangedAt: Map<string, string | null>,
): Set<string> {
  const out = new Set<string>();
  for (const s of sends) {
    if (!s.legislator_id) continue;
    const changed = emailChangedAt.get(s.legislator_id);
    if (changed && new Date(changed).getTime() > new Date(s.sent_at).getTime()) continue;
    out.add(s.legislator_id);
  }
  return out;
}

/** email_changed_at for the given officials. A read error just means "no change known". */
export async function emailChangeTimes(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from("legislators").select("id, email_changed_at").in("id", unique);
  return new Map(
    ((data ?? []) as { id: string; email_changed_at: string | null }[]).map((r) => [r.id, r.email_changed_at]),
  );
}
