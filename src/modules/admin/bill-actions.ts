"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "./actions";
import { requireMfaForMutation } from "./mfa";
import { recordAdminAction } from "@/lib/audit";
import { normalizeLocality } from "@/lib/locality";

const VALID_SCOPES = ["federal", "state", "county", "municipal"] as const;
type Scope = (typeof VALID_SCOPES)[number];
const VALID_RELEVANCE = ["pro", "anti", "neutral", "unknown"] as const;
const VALID_STATUS = ["introduced", "committee", "passed_chamber", "enacted", "dead"] as const;

const cap = (s: string, n: number) => s.slice(0, n).trim();

export async function createLocalBill(formData: FormData) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Admin or leader only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  const scope = cap(String(formData.get("scope") ?? ""), 16) as Scope;
  if (!(VALID_SCOPES as readonly string[]).includes(scope)) {
    return { error: "Invalid scope." };
  }

  const stateRaw = String(formData.get("state") ?? "").trim().toUpperCase();
  const state = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null;
  if (!state) return { error: "State is required (2-letter code)." };

  const billNumber = cap(String(formData.get("bill_number") ?? ""), 60);
  if (!billNumber) return { error: "Bill number is required (e.g. 'CO-Ord 2026-12')." };

  const title = cap(String(formData.get("title") ?? ""), 500);
  if (!title) return { error: "Title is required." };

  const summary = cap(String(formData.get("summary") ?? ""), 5000) || null;
  const advocacyCallout = cap(String(formData.get("advocacy_callout") ?? ""), 500) || null;
  const officialUrl = cap(String(formData.get("official_url") ?? ""), 1000) || null;
  const sessionId = cap(String(formData.get("session_id") ?? ""), 40) || null;

  const relevance = cap(String(formData.get("kratom_relevance") ?? "unknown"), 16);
  if (!(VALID_RELEVANCE as readonly string[]).includes(relevance)) {
    return { error: "Invalid relevance." };
  }
  const status = cap(String(formData.get("status") ?? "introduced"), 30);
  if (!(VALID_STATUS as readonly string[]).includes(status)) {
    return { error: "Invalid status." };
  }
  const lastActionAt = cap(String(formData.get("last_action_at") ?? ""), 32) || null;

  // Locality only for county/municipal — required there, forbidden for state/federal
  let locality: string | null = null;
  if (scope === "county" || scope === "municipal") {
    const localityRaw = cap(String(formData.get("locality") ?? ""), 120);
    if (!localityRaw) {
      return { error: "Locality is required for county or municipal bills (e.g. 'Tulsa, OK')." };
    }
    locality = normalizeLocality(localityRaw, state);
    if (!locality) return { error: "Could not normalize locality. Use 'City, ST' format." };
  }

  // Confidence is implicit-1.0 for hand-entered bills
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("bills")
    .insert({
      state,
      scope,
      locality,
      bill_number: billNumber,
      title,
      summary,
      advocacy_callout: advocacyCallout,
      status,
      kratom_relevance: relevance,
      relevance_confidence: 1.0,
      last_action: cap(String(formData.get("last_action") ?? ""), 500) || null,
      last_action_at: lastActionAt,
      source_url: null, // OpenStates doesn't track these
      official_url: officialUrl,
      session_id: sessionId,
      active: true,
      last_synced_at: new Date().toISOString(),
      enriched_at: new Date().toISOString(), // hand-summary counts as enriched
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: `A bill ${state} ${billNumber} already exists. Edit that instead.` };
    }
    return { error: error.message };
  }

  await recordAdminAction({
    action: "bill_created_manual",
    targetType: "legislator", // closest enum match (no 'bill' yet)
    targetId: row.id,
    details: { state, scope, bill_number: billNumber, locality, official_url: officialUrl },
  });

  revalidatePath("/bills");
  redirect(`/bills/${row.id}`);
}
