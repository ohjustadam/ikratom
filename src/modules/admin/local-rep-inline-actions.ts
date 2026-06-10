"use server";

/**
 * Inline-suggest server actions for the /admin/local-rep-requests page.
 *
 * Owner directive 2026-05-16: "make the 'ai suggest' button actually
 * pull their officials right there on the same page without rerouting
 * pages, showing the added officials in a dropdown connected to the
 * location we queried in the same line and making it collapsible
 * and expandable."
 *
 * Two endpoints:
 *   - previewSuggestions  — runs AI suggest + source verification for
 *                            one locality; returns officials with tier
 *                            info. NO DB writes. UI shows them inline.
 *   - acceptSelectedOfficials — admin checked specific officials in
 *                                the panel; insert just those into the
 *                                legislators table.
 *
 * Mirrors but DOESN'T replace the older `suggestOfficialsAction` +
 * `acceptSuggestions` flow — that one is still wired into the bulk
 * /admin/locals/suggest page.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getCreatorContext } from "@/modules/admin/actions";
import { suggestLocalOfficials, type SuggestedOfficial } from "@/lib/ai/suggest-officials";
import { friendlyGroundingError } from "@/lib/ai/grounding-errors";
import { verifyOfficialAgainstSource } from "@/lib/local-reps-verify";
import { normalizeLocality } from "@/lib/locality";
import { recordAdminAction } from "@/lib/audit";

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export type SuggestionWithTier = SuggestedOfficial & {
  tier: "verified" | "tentative" | "rejected";
  verifier_note: string;
  /** True if a legislator with this exact name already exists for the
   *  locality. UI greys out the checkbox to avoid duplicates. */
  already_exists: boolean;
};

export type PreviewSuggestionsResult =
  | {
      ok: true;
      locality: string;
      officials: SuggestionWithTier[];
      sources: string[];
    }
  | { ok: false; error: string };

export async function previewSuggestions(input: {
  state: string;
  locality: string;
  level: "municipal" | "county";
}): Promise<PreviewSuggestionsResult> {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { ok: false, error: "Sign in as an admin or advocate leader." };

  const stateRaw = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(stateRaw)) return { ok: false, error: "Invalid state." };
  const localityNorm = normalizeLocality(input.locality, stateRaw) ?? input.locality;
  const city = localityNorm.replace(/,\s*[A-Z]{2}$/, "");

  const suggestion = await suggestLocalOfficials({ city, state: stateRaw, caller: "admin-inline-suggest" });
  if ("error" in suggestion) {
    // De-Gemini'd: a Legistar miss returns a transient "queued for batch"
    // result. Surface it as an informational note, not a red error box.
    if (suggestion.transient) {
      return { ok: false, error: "🕒 Not on Legistar — queued for the next batch (SearXNG + Ollama) resolution run. Check back shortly." };
    }
    return { ok: false, error: friendlyGroundingError(suggestion.error) };
  }

  const db = admin();
  const { data: existing } = await db
    .from("legislators")
    .select("full_name")
    .eq("level", input.level)
    .eq("locality", localityNorm)
    .eq("active", true);
  const existingNames = new Set(
    (existing ?? []).map((r: { full_name: string }) => r.full_name.toLowerCase()),
  );

  const results: SuggestionWithTier[] = [];
  for (const o of suggestion.officials) {
    // Legistar officials are authoritative clerk data — skip the page fetch.
    const v = o.source_kind === "legistar"
      ? { ok: true as const, tier: "verified" as const, matchedAt: o.source_url ?? "", pageSnippet: "Legistar — official clerk roster" }
      : await verifyOfficialAgainstSource({
          fullName: o.full_name,
          sourceUrl: o.source_url,
          localityHint: localityNorm,
        });
    const exists = existingNames.has(o.full_name.toLowerCase());
    if (v.ok) {
      results.push({
        ...o,
        tier: v.tier,
        verifier_note: v.pageSnippet,
        already_exists: exists,
      });
    } else {
      results.push({
        ...o,
        tier: "rejected",
        verifier_note: `${v.reason}${v.detail ? ` (${v.detail})` : ""}`,
        already_exists: exists,
      });
    }
  }

  return {
    ok: true,
    locality: localityNorm,
    officials: results,
    sources: suggestion.sources,
  };
}

export type AcceptSelectedResult =
  | { ok: true; inserted: number; alreadyExisted: number }
  | { ok: false; error: string };

/**
 * Accept a subset of suggested officials inline. Inserts them into
 * legislators + marks the matching local_rep_requests fulfilled.
 */
export async function acceptSelectedOfficials(input: {
  state: string;
  locality: string;
  level: "municipal" | "county";
  officials: Array<SuggestedOfficial & { tier: "verified" | "tentative" | "rejected"; verifier_note?: string }>;
  sources: string[];
}): Promise<AcceptSelectedResult> {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { ok: false, error: "Sign in as an admin or advocate leader." };

  const stateRaw = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(stateRaw)) return { ok: false, error: "Invalid state." };
  const localityNorm = normalizeLocality(input.locality, stateRaw) ?? input.locality;

  const db = admin();
  const cap = (s: string | null | undefined, n: number) =>
    s ? s.slice(0, n).trim() || null : null;

  const { data: existing } = await db
    .from("legislators")
    .select("full_name")
    .eq("level", input.level)
    .eq("locality", localityNorm)
    .eq("active", true);
  const existingNames = new Set(
    (existing ?? []).map((r: { full_name: string }) => r.full_name.toLowerCase()),
  );

  const sourcesLine = input.sources.length > 0 ? `- AI-cited: ${input.sources.join(", ")}` : null;
  const rows: Record<string, unknown>[] = [];
  let alreadyExisted = 0;
  for (const o of input.officials) {
    if (existingNames.has(o.full_name.toLowerCase())) {
      alreadyExisted++;
      continue;
    }
    rows.push({
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
      level: input.level,
      body: input.level === "municipal" ? "city_council" : "county_commission",
      active: true,
      term_end_date: o.term_end_date,
      verified_sources_md: [
        `- Tier: **${o.tier}**${o.tier === "tentative" ? " (admin spot-check recommended)" : ""}`,
        `- Accepted by ${ctx.email ?? ctx.userId} on ${new Date().toISOString().slice(0, 10)}`,
        o.source_url ? `- Source: ${o.source_url}` : null,
        o.verifier_note ? `- Verifier: "${o.verifier_note.slice(0, 240)}"` : null,
        sourcesLine,
      ]
        .filter(Boolean)
        .join("\n"),
      last_synced_at: new Date().toISOString(),
    });
  }

  if (rows.length === 0 && alreadyExisted === 0) {
    return { ok: false, error: "No officials selected." };
  }

  if (rows.length > 0) {
    const { error } = await db.from("legislators").insert(rows);
    if (error) return { ok: false, error: `Insert failed: ${error.message}` };
  }

  // Mark matching pending requests fulfilled
  await db
    .from("local_rep_requests")
    .update({
      status: "fulfilled",
      resolved_at: new Date().toISOString(),
      resolved_by: ctx.userId,
    })
    .eq("state", stateRaw)
    .eq("locality", localityNorm)
    .eq("level", input.level)
    .eq("status", "pending");

  // Notify requesters + residents via the shared RPC (0193) — best-effort.
  // Once status flips to fulfilled the batch/cron queues skip this locality
  // forever, so missing the notify here would never be retried.
  {
    const { error: notifyErr } = await db.rpc("notify_locality_residents", {
      p_state: stateRaw,
      p_locality: localityNorm,
      p_official_names: rows.map((r) => r.full_name),
    });
    if (notifyErr) console.warn("[inline-accept] notify RPC failed:", notifyErr.message);
  }

  try {
    await recordAdminAction({
      action: "local_reps.inline_accept",
      details: {
        locality: localityNorm,
        level: input.level,
        inserted: rows.length,
        already_existed: alreadyExisted,
      },
    });
  } catch { /* non-fatal */ }

  return { ok: true, inserted: rows.length, alreadyExisted };
}
