/**
 * Persist bill sponsorships from an OpenStates `sponsorships[]` array.
 *
 * Each item from OpenStates looks like:
 *   { name: "Sen. Altschiller", classification: "primary"|"cosponsor"|...,
 *     entity_type: "person", person?: { id, name }, organization?: ... }
 *
 * We try to match each sponsor to our `legislators` table by exact
 * full_name within the bill's state. Misses leave legislator_id = null
 * and we still store the name for display.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type OpenStatesSponsor = {
  name?: string;
  classification?: string;
  primary?: boolean;
};

export async function upsertBillSponsors(
  supabase: SupabaseClient,
  billId: string,
  state: string,
  sponsorships: OpenStatesSponsor[] | undefined,
): Promise<void> {
  if (!Array.isArray(sponsorships) || sponsorships.length === 0) return;

  // Pull all legislators in this state once for name-matching
  const { data: legislators } = await supabase
    .from("legislators")
    .select("id, full_name, party, district")
    .eq("state", state)
    .eq("active", true);

  const byName = new Map<string, { id: string; party: string | null; district: string | null }>();
  for (const l of (legislators ?? []) as Array<{ id: string; full_name: string | null; party: string | null; district: string | null }>) {
    if (!l.full_name) continue;
    byName.set(normalizeName(l.full_name), { id: l.id, party: l.party, district: l.district });
  }

  // Build deduped rows
  const rows = new Map<string, {
    bill_id: string;
    legislator_id: string | null;
    name: string;
    classification: string;
    party: string | null;
    district: string | null;
  }>();
  for (const s of sponsorships) {
    if (!s.name) continue;
    const cleanName = String(s.name).slice(0, 200).trim();
    if (!cleanName) continue;
    const classification = (s.primary === true ? "primary" : (s.classification ?? "cosponsor")).slice(0, 30);
    const norm = normalizeName(cleanName);
    const match = byName.get(norm);
    const key = `${cleanName}::${classification}`;
    rows.set(key, {
      bill_id: billId,
      legislator_id: match?.id ?? null,
      name: cleanName,
      classification,
      party: match?.party ?? null,
      district: match?.district ?? null,
    });
  }

  if (rows.size === 0) return;

  // Replace all sponsor rows for this bill (idempotent — sponsorships rarely
  // change, but if they do we want the current set, not appended duplicates)
  await supabase.from("bill_sponsors").delete().eq("bill_id", billId);
  await supabase.from("bill_sponsors").insert(Array.from(rows.values()));
}

/** Strip "Sen.", "Rep.", titles, punctuation; lowercase. */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(sen|rep|representative|senator|hon|the honorable|mr|mrs|ms|dr|jr|sr|ii|iii|iv)\.?\b/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
