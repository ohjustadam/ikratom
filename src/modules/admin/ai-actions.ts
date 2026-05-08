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
  const { error, data } = await supabase
    .from("legislators")
    .insert(rows)
    .select("id");

  if (error) return { error: error.message };
  const added = data?.length ?? 0;

  // Mark any pending user-driven requests for this area as fulfilled.
  if (added > 0) {
    try {
      const sr = createServiceRoleClient();
      await sr.rpc("fulfill_local_rep_requests", {
        p_state: stateRaw,
        p_locality: localityNorm,
      });
    } catch {
      // non-fatal
    }
  }

  // Notify residents — best-effort, never blocks the response.
  if (added > 0) {
    try {
      const sr = createServiceRoleClient();
      // Match users whose city OR county normalizes to the same locality
      // and live in the same state. Both city + county are stored
      // canonical (Census normalization happens in updateProfile), so
      // direct equality works here.
      const { data: residents } = await sr
        .from("profiles")
        .select("id")
        .eq("state", stateRaw)
        .or(`city.eq.${localityNorm},county.eq.${localityNorm}`);

      const userIds = (residents ?? []).map((r: { id: string }) => r.id);
      if (userIds.length > 0) {
        const repNames = input.officials
          .slice(0, 3)
          .map((o) => o.full_name)
          .join(", ");
        const moreCount = input.officials.length > 3 ? input.officials.length - 3 : 0;
        const body =
          repNames +
          (moreCount > 0 ? ` and ${moreCount} more` : "") +
          ` now appear on your dashboard.`;
        await sr.from("notifications").insert(
          userIds.map((uid) => ({
            user_id: uid,
            kind: "reps_added",
            title: `Your local reps in ${localityNorm} are in your war room`,
            body,
            link: "/dashboard",
          })),
        );
      }
    } catch {
      // Fan-out failure must not roll back the legislator inserts. The
      // user can still see the new reps when they next visit /dashboard
      // — this notification is about *immediate* awareness, not state.
    }
  }

  return { ok: true, added };
}
