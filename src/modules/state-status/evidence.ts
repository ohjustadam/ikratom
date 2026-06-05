import { createClient } from "@/lib/supabase/server";

/**
 * Resolve state_status evidence bill NUMBERS → /bills/[id] links so the
 * canonical-status header can cite verifiable sources (the cross-reference
 * payoff: an advocate can click straight through to the bill that backs the
 * status). Returns {} when nothing resolves — the header then renders the
 * numbers as plain text, so this is always safe to call.
 */
export async function resolveBillHrefs(
  state: string,
  billNumbers: (string | null | undefined)[],
): Promise<Record<string, string>> {
  const nums = Array.from(new Set(billNumbers.filter(Boolean))) as string[];
  if (nums.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("bills")
    .select("id, bill_number")
    .eq("state", state)
    .in("bill_number", nums);
  const out: Record<string, string> = {};
  for (const b of (data as { id: string; bill_number: string | null }[] | null) ?? []) {
    if (b.bill_number && !out[b.bill_number]) out[b.bill_number] = `/bills/${b.id}`;
  }
  return out;
}
