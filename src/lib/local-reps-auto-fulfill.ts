/**
 * Auto-fulfill `local_rep_requests` rows without admin in the loop.
 *
 * Owner directive 2026-05-16: "automatically find and populating the
 * local leaders" + "put in a failsafe way now to auto update and
 * recognize the officials so we ensure we dont list someone that is
 * no longer an official."
 *
 * Flow per request:
 *   1. Call suggestLocalOfficials (Gemini + Google Search grounding)
 *   2. For each returned official: verify against source_url (fetch URL,
 *      confirm name appears) via verifyOfficialAgainstSource
 *   3. Verified officials → insert into `legislators` with
 *      term_end_date + verified_sources_md
 *   4. Mark the local_rep_requests row fulfilled
 *
 * Rejected officials get logged into the request's notes for admin
 * visibility but never reach the public legislators table. Admin can
 * still manually accept via the existing /admin/local-rep-requests UI.
 *
 * Re-verify path (`reVerifyLocality`) re-runs the same flow against an
 * already-populated locality. Used by the cron to detect resigned or
 * defeated officials.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { suggestLocalOfficials, type SuggestedOfficial } from "@/lib/ai/suggest-officials";
import { verifyOfficialAgainstSource } from "@/lib/local-reps-verify";
import { normalizeLocality } from "@/lib/locality";

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export type AutoFulfillOutcome = {
  locality: string;
  level: "municipal" | "county";
  inserted: number;
  /** Of `inserted`, how many were tier='tentative' (admin should spot-check). */
  insertedTentative: number;
  skipped: number;
  skipReasons: Array<{ name: string; reason: string }>;
  fulfilled: boolean;
  error?: string;
};

/**
 * Process one (locality, level) pair end-to-end. Idempotent — won't
 * re-insert officials who already exist for the same locality + name.
 */
export async function autoFulfillLocality(input: {
  locality: string;
  state: string;
  level: "municipal" | "county";
}): Promise<AutoFulfillOutcome> {
  const db = admin();
  const localityNorm = normalizeLocality(input.locality, input.state) ?? input.locality;
  const result: AutoFulfillOutcome = {
    locality: localityNorm,
    level: input.level,
    inserted: 0,
    insertedTentative: 0,
    skipped: 0,
    skipReasons: [],
    fulfilled: false,
  };

  // 1. Suggest via Gemini-with-search
  const city = localityNorm.replace(/,\s*[A-Z]{2}$/, "");
  const suggestion = await suggestLocalOfficials({ city, state: input.state, caller: "auto-fulfill-locality" });
  if ("error" in suggestion) {
    result.error = suggestion.error;
    return result;
  }

  const allSources = suggestion.sources.join(", ");

  // 2. Verify each official against its cited source URL.
  // `tier` distinguishes 'verified' (full-name match on cited URL) from
  // 'tentative' (URL on government-credible domain but no name match —
  // common for JS-rendered CMS pages and PDF rosters). Both are
  // accepted; tentative is flagged so admin can spot-check fast.
  const verified: { official: SuggestedOfficial; snippet: string; tier: "verified" | "tentative" }[] = [];
  for (const o of suggestion.officials) {
    // Legistar officials are authoritative clerk data — already verified at
    // source; skip the page-fetch check (legistar.com isn't a .gov domain).
    const v = o.source_kind === "legistar"
      ? { ok: true as const, tier: "verified" as const, matchedAt: o.source_url ?? "", pageSnippet: "Legistar — official clerk roster" }
      : await verifyOfficialAgainstSource({
          fullName: o.full_name,
          sourceUrl: o.source_url,
          localityHint: localityNorm,
        });
    if (v.ok) {
      verified.push({ official: o, snippet: v.pageSnippet, tier: v.tier });
    } else {
      result.skipped++;
      result.skipReasons.push({
        name: o.full_name,
        reason: `${v.reason}${v.detail ? ` (${v.detail})` : ""}`,
      });
    }
  }

  if (verified.length === 0) {
    result.error = `No officials passed source verification for ${localityNorm}`;
    return result;
  }

  // 3. De-dupe against existing rows for this locality, then insert
  const { data: existing } = await db
    .from("legislators")
    .select("full_name")
    .eq("level", input.level)
    .eq("locality", localityNorm)
    .eq("active", true);
  const existingNames = new Set((existing ?? []).map((r: { full_name: string }) => r.full_name.toLowerCase()));

  const rowsToInsert = [];
  for (const { official, snippet, tier } of verified) {
    if (existingNames.has(official.full_name.toLowerCase())) {
      result.skipped++;
      result.skipReasons.push({ name: official.full_name, reason: "already in legislators" });
      continue;
    }
    if (tier === "tentative") result.insertedTentative++;
    rowsToInsert.push({
      state: input.state,
      role: official.role,
      district: official.district,
      full_name: official.full_name,
      party: official.party,
      email: official.email,
      phone: official.phone,
      website: official.website,
      title: official.title,
      level: input.level,
      locality: localityNorm,
      body: input.level === "municipal" ? "city_council" : "county_commission",
      active: true,
      term_end_date: official.term_end_date,
      verified_sources_md: [
        `- Tier: **${tier}**${tier === "tentative" ? " (admin spot-check recommended)" : ""}`,
        official.source_url ? `- Source: ${official.source_url}` : null,
        `- Verifier snippet: "${snippet}"`,
        allSources ? `- Other AI-cited sources: ${allSources}` : null,
      ].filter(Boolean).join("\n"),
      last_synced_at: new Date().toISOString(),
    });
  }

  if (rowsToInsert.length > 0) {
    const { error } = await db.from("legislators").insert(rowsToInsert);
    if (error) {
      result.error = `Insert failed: ${error.message}`;
      return result;
    }
    result.inserted = rowsToInsert.length;
  }

  // 4. Mark requests fulfilled ONLY when we actually inserted officials.
  // If verification rejected everything (AI hallucinated, dead URLs,
  // paywalled directory, etc.) the request stays pending so admin sees
  // it in /admin/local-rep-requests and can manually research.
  if (result.inserted > 0) {
    const { error: updErr } = await db
      .from("local_rep_requests")
      .update({
        status: "fulfilled",
        resolved_at: new Date().toISOString(),
        // resolved_by stays null when auto-fulfilled (no human admin acted)
      })
      .eq("state", input.state)
      .eq("locality", localityNorm)
      .eq("level", input.level)
      .eq("status", "pending");
    if (updErr) {
      console.warn("[auto-fulfill] couldn't close requests:", updErr.message);
    }
    result.fulfilled = !updErr;
    // Notify requesters + residents via the shared RPC (0193) — best-effort;
    // push delivery rides the hourly fan-out (DND/quiet-hours respected there).
    if (result.fulfilled) {
      // supabase-js rpc() returns { error }, it doesn't throw — check it or
      // a missing/broken RPC fails silently (standing rule 6).
      const { error: notifyErr } = await db.rpc("notify_locality_residents", {
        p_state: input.state,
        p_locality: localityNorm,
        p_official_names: rowsToInsert.map((r) => r.full_name),
      });
      if (notifyErr) console.warn("[auto-fulfill] notify RPC failed:", notifyErr.message);
    }
  } else {
    // 0 inserted (all rejected by source verifier or all duplicates).
    // Leave pending; admin will see in the queue.
    result.fulfilled = false;
    if (!result.error && result.skipped > 0) {
      result.error = `${result.skipped} officials suggested but none passed source verification`;
    }
  }

  return result;
}

/**
 * Re-verify an already-populated locality. Used by the periodic cron
 * (term_end_date passed, or 90+ days since last_synced_at) to catch
 * resignations, lost re-elections, and term expirations.
 *
 * Logic:
 *   1. Re-run suggestLocalOfficials for the locality
 *   2. For each CURRENTLY ACTIVE official, check if a matching name
 *      appears in the new suggestion set
 *   3. Officials NOT in the new set → mark active=false (they've left
 *      office; admin gets notified)
 *   4. New officials in the suggestion set that aren't in our table →
 *      verify + insert as usual
 *
 * Doesn't touch federal/state legislators — they sync from LegiScan /
 * OpenStates. Only `level in ('municipal','county')`.
 */
export async function reVerifyLocality(input: {
  locality: string;
  state: string;
  level: "municipal" | "county";
}): Promise<{
  locality: string;
  retired: string[];
  added: number;
  unchanged: number;
  error?: string;
}> {
  const db = admin();
  const localityNorm = normalizeLocality(input.locality, input.state) ?? input.locality;

  const city = localityNorm.replace(/,\s*[A-Z]{2}$/, "");
  const suggestion = await suggestLocalOfficials({ city, state: input.state, caller: "reverify-locality" });
  if ("error" in suggestion) {
    return { locality: localityNorm, retired: [], added: 0, unchanged: 0, error: suggestion.error };
  }

  // Build verified-name set from the new suggestion (any tier counts —
  // tentative is still good enough evidence that they're an active
  // official; only fully-rejected officials get treated as "gone")
  const verifiedNames = new Set<string>();
  for (const o of suggestion.officials) {
    const v = o.source_kind === "legistar"
      ? { ok: true as const }
      : await verifyOfficialAgainstSource({ fullName: o.full_name, sourceUrl: o.source_url });
    if (v.ok) verifiedNames.add(o.full_name.toLowerCase());
  }

  const { data: currentActive } = await db
    .from("legislators")
    .select("id, full_name")
    .eq("level", input.level)
    .eq("locality", localityNorm)
    .eq("active", true);

  const retired: string[] = [];
  for (const row of (currentActive ?? []) as Array<{ id: string; full_name: string }>) {
    if (!verifiedNames.has(row.full_name.toLowerCase())) {
      await db
        .from("legislators")
        .update({ active: false, last_synced_at: new Date().toISOString() })
        .eq("id", row.id);
      retired.push(row.full_name);
    } else {
      await db
        .from("legislators")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  }

  // Insert any newcomers via the same auto-fulfill flow
  const after = await autoFulfillLocality({ locality: localityNorm, state: input.state, level: input.level });

  return {
    locality: localityNorm,
    retired,
    added: after.inserted,
    unchanged: (currentActive?.length ?? 0) - retired.length,
  };
}
