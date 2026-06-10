"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { suggestLocalOfficials, type SuggestedOfficial } from "@/lib/ai/suggest-officials";
import { normalizeLocality } from "@/lib/locality";
import { getCreatorContext } from "./actions";

export async function suggestOfficialsAction(input: { city: string; state: string }) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader." };
  return suggestLocalOfficials(input);
}

/**
 * Bulk-add accepted suggestions to legislators table.
 * Each row goes through the same validation as the manual form.
 *
 * After insert, this also fans out an in-app notification to every user
 * who lives in the affected locality so they see the new local reps
 * appear in their cockpit war-room. The notification flows through the
 * existing notifications + push fan-out pipeline (no extra setup).
 *
 * The fan-out uses the service-role client because we're reading across
 * other users' profile rows that the acting admin's RLS scope doesn't
 * cover. This is admin-initiated by definition (getCreatorContext gate
 * above), so the role escalation is gated by the action's auth check.
 */
export async function acceptSuggestions(input: {
  state: string;
  locality: string;
  officials: SuggestedOfficial[];
}) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader." };

  const stateRaw = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(stateRaw)) return { error: "Invalid state code." };

  const localityNorm = normalizeLocality(input.locality, stateRaw) ?? "";
  if (!localityNorm) return { error: "Invalid locality." };

  const cap = (s: string | null | undefined, n: number) =>
    s ? s.slice(0, n).trim() || null : null;

  const rows = input.officials.map((o) => {
    const isCounty = o.role.startsWith("county_");
    return {
      full_name: cap(o.full_name, 120) ?? "Unknown",
      state: stateRaw,
      role: o.role,
      locality: localityNorm,
      title: cap(o.title, 120),
      district: cap(o.district, 30),
      email: cap(o.email, 254),
      phone: cap(o.phone, 30),
      website: cap(o.website, 500),
      party: cap(o.party, 60),
      level: isCounty ? "county" : "municipal",
      active: true,
    };
  });

  const supabase = await createClient();

  // Pre-check for duplicates against the new unique index
  // (state, locality, role, lower(full_name)) on local-level rows.
  // Fetch all existing local legislators for this locality so we can
  // skip ones that already exist instead of failing the whole batch.
  const { data: existing } = await supabase
    .from("legislators")
    .select("role, full_name")
    .eq("state", stateRaw)
    .eq("locality", localityNorm)
    .in("level", ["municipal", "county"]);
  const existingKeys = new Set(
    ((existing ?? []) as { role: string; full_name: string }[]).map(
      (r) => `${r.role}::${r.full_name.toLowerCase().trim()}`,
    ),
  );

  const newRows = rows.filter(
    (r) => !existingKeys.has(`${r.role}::${(r.full_name ?? "").toLowerCase().trim()}`),
  );
  const skipped = rows.length - newRows.length;

  if (newRows.length === 0) {
    return { ok: true, added: 0, skipped };
  }

  const { error, data } = await supabase
    .from("legislators")
    .insert(newRows)
    .select("id");

  if (error) {
    // 23505 = unique violation. Could happen if two admins accept the
    // same suggestion simultaneously (race past our pre-check). Surface
    // a friendly partial-success rather than a hard error.
    if (error.code === "23505") {
      return { ok: true, added: 0, skipped: rows.length, race: true };
    }
    return { error: error.message };
  }
  const added = data?.length ?? 0;

  // Mark any pending user-driven requests fulfilled, then notify via the
  // SHARED RPC (0193): requesters ∪ residents, deduped per user+locality —
  // the same rule every fulfill path (admin, cron, box batch) uses, so the
  // notify behavior can never drift between runtimes. Best-effort: failure
  // must not roll back the legislator inserts; push rides the hourly
  // fan-out with its own DND / quiet-hours safety.
  if (added > 0) {
    try {
      const sr = createServiceRoleClient();
      const { error: fulfillErr } = await sr.rpc("fulfill_local_rep_requests", {
        p_state: stateRaw,
        p_locality: localityNorm,
      });
      if (fulfillErr) console.warn("[accept] fulfill RPC failed:", fulfillErr.message);
      const { error: notifyErr } = await sr.rpc("notify_locality_residents", {
        p_state: stateRaw,
        p_locality: localityNorm,
        p_official_names: input.officials.map((o) => o.full_name),
      });
      if (notifyErr) console.warn("[accept] notify RPC failed:", notifyErr.message);
    } catch {
      // non-fatal (createServiceRoleClient itself)
    }
  }

  return { ok: true, added };
}
