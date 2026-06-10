/**
 * locality-intel.mjs — compose + upsert the per-locality intelligence record
 * (locality_intel, migration 0192) from a ban-verify result plus derived
 * links into legislators and municipal_meetings.
 *
 * The ban TRUTH stays in bills (0190 two-source gate). This is the intel
 * layer: the locality's legal framework, measures being pushed, who governs
 * it, and when its council meets next — one pass, one record.
 *
 * Degrades gracefully: if the table doesn't exist yet (0192 not applied) or
 * any lookup fails, callers get { ok:false, error } and nothing throws.
 */

/**
 * ONE canonical locality key everywhere: the bare place name, WITHOUT a
 * ", ST" suffix (state lives in its own column). bills.locality sometimes
 * carries the suffix and news extraction doesn't — without this, the same
 * place splits into two contradictory public rows.
 */
export function canonicalLocality(locality) {
  return String(locality ?? "").replace(/,\s*[A-Z]{2}$/i, "").trim();
}

/** Map a ban-verify outcome to a defensible intel legal_status. */
export function legalStatusFrom(result) {
  if (!result?.ok) return "uncertain";
  if (result.outcome === "confirmed") return "banned";
  if (result.outcome === "repealed") return "repealed";
  // held: single-source suspicion stays uncertain; pending evidence is its
  // own state; a clean sweep that found nothing local is no_local_law only
  // when we actually read pages (>=2) — never from an empty search.
  const sources = result.sources ?? [];
  if ((result.pending ?? []).length > 0) return "pending_measure";
  if (sources.length > 0) return "uncertain";
  return (result.pagesChecked ?? 0) >= 2 ? "no_local_law" : "uncertain";
}

export function composeSourcesMd(sources) {
  return (sources ?? [])
    .map((s) => `- [${s.tier}] ${s.url}${s.what ? ` — ${s.what}` : ""}`)
    .join("\n") || null;
}

export function composePendingMd(pending) {
  return (pending ?? [])
    .map((p) => `- ${p.note} (${p.url})`)
    .join("\n") || null;
}

export function composeFrameworkMd({ state, locality, result }) {
  if (!result?.ok) return null;
  const lines = [];
  if (result.outcome === "confirmed") {
    lines.push(`**${locality}, ${state}** has a confirmed local kratom ban in force${result.enacted_date ? ` (enacted ${result.enacted_date})` : ""}${result.ordinance_citation ? ` — ${result.ordinance_citation}` : ""}.`);
  } else if (result.outcome === "repealed") {
    lines.push(`**${locality}, ${state}** repealed its local kratom ban${result.repeal_date ? ` on ${result.repeal_date}` : ""}${result.ordinance_citation ? ` (${result.ordinance_citation})` : ""}.`);
  } else if ((result.sources ?? []).length > 0) {
    lines.push(`A local kratom ban in **${locality}, ${state}** is reported but not yet corroborated by two independent sources — held, not published.`);
  } else {
    lines.push(`No local kratom ordinance found for **${locality}, ${state}** (${result.pagesChecked ?? 0} page(s) checked).`);
  }
  if ((result.pending ?? []).length > 0) {
    lines.push(`Pending activity: ${result.pending.length} measure note(s) — see pending measures.`);
  }
  return lines.join("\n\n");
}

/**
 * Upsert the intelligence record for one locality.
 * @returns { ok:true, status } | { ok:false, error }
 */
export async function upsertLocalityIntel({ sb, state, locality: rawLocality, scope, result, sweepNote, dry = false }) {
  const st = String(state).toUpperCase();
  const locality = canonicalLocality(rawLocality);
  const lvl = scope ?? (/\b(county|parish|borough)\b/i.test(locality) ? "county" : "municipal");

  // Derived links — best-effort, never fatal.
  let officialsCount = 0;
  try {
    const { count } = await sb.from("legislators")
      .select("id", { count: "exact", head: true })
      .eq("state", st).eq("active", true)
      .in("level", ["municipal", "county"])
      .ilike("locality", `${locality}%`);
    officialsCount = count ?? 0;
  } catch { /* best-effort */ }

  let nextMeetingAt = null;
  try {
    const { data } = await sb.from("municipal_meetings")
      .select("meeting_at")
      .eq("state", st).eq("moderation_status", "approved")
      .gte("meeting_at", new Date().toISOString())
      .ilike("locality", `${locality}%`)
      .order("meeting_at", { ascending: true })
      .limit(1);
    nextMeetingAt = data?.[0]?.meeting_at ?? null;
  } catch { /* best-effort */ }

  const row = {
    state: st,
    locality,
    scope: lvl,
    legal_status: legalStatusFrom(result),
    legal_framework_md: composeFrameworkMd({ state: st, locality, result }),
    ordinance_citation: result?.ordinance_citation ?? null,
    ordinance_url: (result?.sources ?? []).find((s) => s.tier === "authoritative")?.url ?? null,
    pending_measures_md: composePendingMd(result?.pending),
    pending_count: (result?.pending ?? []).length,
    officials_count: officialsCount,
    next_meeting_at: nextMeetingAt,
    sources_md: composeSourcesMd(result?.sources),
    sweep_status: result?.ok ? "swept" : "failed",
    sweep_note: sweepNote ?? (result?.ok ? result.reason ?? null : result?.reason ?? "verify failed"),
    swept_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (dry) return { ok: true, status: "dry", row };
  try {
    const { error } = await sb.from("locality_intel").upsert(row, { onConflict: "state,locality" });
    if (error) return { ok: false, error: error.message };
    return { ok: true, status: row.sweep_status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Queue a locality for the nightly sweep (no-op if a row already exists). */
export async function queueLocalityIntel({ sb, state, locality, scope }) {
  try {
    const { error } = await sb.from("locality_intel").upsert(
      { state: String(state).toUpperCase(), locality: canonicalLocality(locality), scope: scope ?? "municipal" },
      { onConflict: "state,locality", ignoreDuplicates: true },
    );
    return { ok: !error, error: error?.message };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
