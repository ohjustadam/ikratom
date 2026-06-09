/**
 * Local-officials suggestions — deterministic, Gemini-free.
 *
 * De-Gemini'd 2026-06-08 (private/LOCAL_REPS_DEGEMINI_PLAN.md). Google killed
 * the Civic Information *Representatives* API (2025-04-30), and we will NOT
 * pay for grounded search. This LIVE (Vercel) path can't reach the owner's
 * self-hosted SearXNG/Ollama, so it resolves officials from the keyless
 * Legistar webapi (the discovered/seeded `legistar_tenants` cache). Localities
 * not on Legistar return a transient "queued" error and are left for the batch
 * SearXNG+Ollama run on the owner's box / self-hosted runner — which DOES the
 * find-page-then-extract step. NO Gemini, NO Google-Search grounding anywhere.
 *
 * The public surface of this module (suggestLocalOfficials, SuggestedOfficial,
 * SuggestResult) is unchanged so callers (admin AI-suggest, auto-fulfill,
 * reverify cron) keep working — they just never spend a grounded call.
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveLegistarTenant, fetchLegistarRoster } from "@/lib/legistar-roster";

export type SuggestedOfficial = {
  full_name: string;
  role: "mayor" | "city_council" | "county_executive" | "county_commissioner" | "school_board" | "other_local";
  title: string | null;
  district: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  party: string | null;
  source_note: string | null;
  /** ISO date the official's current term ends, if known. Cron uses it to
   *  auto-retire stale entries (migration 0148). */
  term_end_date: string | null;
  /** Specific source URL naming this official; the verifier fetches it to
   *  confirm the name appears before auto-accept. */
  source_url: string | null;
  /** How this official was sourced. 'legistar' = authoritative clerk roster
   *  (pre-verified — callers skip the source-fetch verification). 'search' =
   *  extracted from a fetched .gov page (batch SearXNG+Ollama path). */
  source_kind?: "legistar" | "search";
};

export type SuggestResult =
  | { ok: true; locality: string; officials: SuggestedOfficial[]; sources: string[] }
  | {
      error: string;
      /** When true the caller should NOT mark its work item terminally
       *  processed — it will likely succeed on a future retry (batch run). */
      transient?: boolean;
    };

/**
 * Resolve current local officials for a city/county WITHOUT Gemini.
 * Deterministic Legistar first; otherwise a transient "queued" error so the
 * batch (SearXNG + local Ollama) path fulfills it where that infra is present.
 */
export async function suggestLocalOfficials(input: {
  city: string;
  state: string;
  /** Caller label for telemetry (e.g. "admin-inline-suggest"). */
  caller?: string;
}): Promise<SuggestResult> {
  const city = input.city.trim();
  const state = input.state.trim().toUpperCase();
  if (!city) return { error: "City is required." };
  if (!/^[A-Z]{2}$/.test(state)) return { error: "State must be 2-letter code." };

  const locality = `${city}, ${state}`;
  const db = createServiceRoleClient();

  // Deterministic Tier 1: the keyless Legistar webapi (authoritative clerk
  // roster from the discovered/seeded legistar_tenants cache).
  const tenant = await resolveLegistarTenant(db, state, locality);
  if (tenant) {
    try {
      const officials = await fetchLegistarRoster(tenant);
      if (officials.length > 0) {
        return {
          ok: true,
          locality,
          officials,
          sources: [`https://${tenant.subdomain}.legistar.com/People.aspx`],
        };
      }
    } catch {
      /* fall through to queued */
    }
  }

  // Not on Legistar and the cloud can't reach the owner's SearXNG/Ollama.
  // The batch job FINDS the .gov roster page (SearXNG) and EXTRACTS it
  // (Ollama/Groq) where that infra is reachable. transient=true keeps the
  // request pending so it's picked up there — never a Gemini fallback.
  return {
    error: `${locality} is not on Legistar; queued for batch (SearXNG + local Ollama) resolution.`,
    transient: true,
  };
}
