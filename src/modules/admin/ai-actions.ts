"use server";

import { createClient } from "@/lib/supabase/server";
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
  return { ok: true, added: data?.length ?? 0 };
}
