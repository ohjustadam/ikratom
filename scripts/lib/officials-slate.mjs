/**
 * officials-slate.mjs — shared helper: fetch + persist the full slate of
 * local officials for a "City, ST" / "County, ST" locality.
 *
 * Extracted so both scripts/seed-bill-officials.mjs (bill-driven) and
 * scripts/extract-news-officials.mjs (news-alert-driven) build the same
 * legislators rows the same way.
 *
 * De-Gemini'd 2026-06-08 (private/LOCAL_REPS_DEGEMINI_PLAN.md): the slate now
 * comes from findAndExtractOfficials — Legistar webapi first (authoritative,
 * keyless), then self-hosted SearXNG + local Ollama / free-tier Groq-Cerebras
 * to extract from a deterministically-fetched .gov page. NO Gemini, NO
 * Google-Search grounding, no per-day quota. If the long-tail infra isn't
 * reachable, it returns status='fail' with a "queued" note and the caller
 * leaves the locality for a later run where SearXNG/Ollama are present.
 */

import { findAndExtractOfficials } from "./officials-extract.mjs";

const PARKED_DOMAINS = [
  "hugedomains.com", "sedoparking.com", "dan.com", "godaddy.com",
  "parkingcrew.net", "afternic.com", "uniregistry.com", "buydomains.com",
  "domainmarket.com",
];

export async function isUsableUrl(rawUrl) {
  if (!rawUrl) return false;
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (!u.protocol.startsWith("http")) return false;
  const host = u.hostname.toLowerCase();
  if (PARKED_DOMAINS.some((p) => host === p || host.endsWith("." + p))) return false;
  try {
    const res = await fetch(rawUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "Mozilla/5.0 iKratom-link-check" },
    });
    if (res.status === 404 || res.status >= 500) return false;
    const finalHost = new URL(res.url).hostname.toLowerCase();
    if (PARKED_DOMAINS.some((p) => finalHost === p || finalHost.endsWith("." + p))) return false;
    return true;
  } catch {
    return true; // fail-open on network errors (many .gov block HEAD)
  }
}

// Tier label for verified_sources_md. Legistar = clerk system (verified).
// SearXNG-extracted = verified when the cited page is on a .gov/.us domain
// (the name was read off that page), else tentative for admin spot-check.
function tierFor(official) {
  if (official.source_kind === "legistar") return "verified";
  try {
    const host = new URL(official.source_url).hostname.toLowerCase();
    if (host.endsWith(".gov") || host.endsWith(".us")) return "verified";
  } catch { /* ignore */ }
  return "tentative";
}

function sourcesMd(official, tier) {
  const lines = [`- Tier: **${tier}**${tier === "tentative" ? " (admin spot-check recommended)" : ""}`];
  if (official.source_kind === "legistar") {
    lines[0] = `- Tier: **verified** (Legistar — official clerk system)`;
  }
  if (official.source_url) lines.push(`- Source: ${official.source_url}`);
  if (official.source_note) lines.push(`- ${official.source_note}`);
  return lines.join("\n");
}

/**
 * Fetch + persist the full official slate for a locality. Idempotent:
 * dedupes against existing (state, locality, role, lower(full_name)).
 *
 * @returns {Promise<{ status: "ok"|"skip"|"fail", inserted: number,
 *                      existing: number, officialIds: string[], error?: string }>}
 */
export async function seedLocalitySlate({ sb, state, locality, refresh = false, caller = "officials-slate" }) {
  const city = locality.split(",")[0].trim();
  const level = /\b(county|parish|borough)\b/i.test(locality) ? "county" : "municipal";

  // Already covered?
  const { data: pre } = await sb.from("legislators").select("id")
    .eq("state", state)
    .eq("locality", locality)
    .in("role", ["city_council", "mayor", "county_executive", "county_commissioner"])
    .eq("active", true);
  const preIds = (pre ?? []).map((r) => r.id);
  if (!refresh && preIds.length > 0) {
    return { status: "skip", inserted: 0, existing: preIds.length, officialIds: preIds };
  }

  const res = await findAndExtractOfficials({ sb, city, state, locality, level, caller });
  if (res.queued) {
    // No deterministic Legistar match AND the SearXNG+Ollama long-tail infra
    // isn't reachable here (e.g. a cloud runner). Leave it for a run where the
    // infra is present — never fall back to Gemini.
    return { status: "fail", inserted: 0, existing: preIds.length, officialIds: preIds, error: `queued: ${res.reason}` };
  }
  if (!res.ok || res.officials.length === 0) {
    return { status: "fail", inserted: 0, existing: preIds.length, officialIds: preIds, error: res.error ?? "0 officials returned" };
  }

  const cap = (s, n) => (s ? String(s).slice(0, n).trim() || null : null);
  const websiteOk = await Promise.all(res.officials.map((o) => isUsableUrl(o.website)));
  const rows = res.officials.map((o, i) => {
    const isCounty = (o.role ?? "").startsWith("county_");
    const tier = tierFor(o);
    return {
      full_name: cap(o.full_name, 120) ?? "Unknown",
      state,
      role: o.role,
      locality,
      title: cap(o.title, 120),
      district: cap(o.district, 30),
      email: cap(o.email, 254),
      phone: cap(o.phone, 30),
      website: websiteOk[i] ? cap(o.website, 500) : null,
      party: cap(o.party, 60),
      level: isCounty ? "county" : "municipal",
      body: isCounty ? "county_commission" : "city_council",
      active: true,
      term_end_date: o.term_end_date ?? null,
      verified_sources_md: sourcesMd(o, tier),
      last_synced_at: new Date().toISOString(),
    };
  }).filter((r) => ["city_council", "mayor", "county_executive", "county_commissioner"].includes(r.role));

  // Dedupe against existing
  const { data: existing } = await sb.from("legislators").select("id, role, full_name")
    .eq("state", state)
    .eq("locality", locality)
    .in("level", ["municipal", "county"]);
  const existingKeys = new Set((existing ?? []).map((r) => `${r.role}::${(r.full_name ?? "").toLowerCase().trim()}`));
  const newRows = rows.filter((r) => !existingKeys.has(`${r.role}::${r.full_name.toLowerCase().trim()}`));

  let insertedIds = [];
  if (newRows.length > 0) {
    const { data: ins, error } = await sb.from("legislators").insert(newRows).select("id");
    if (error) return { status: "fail", inserted: 0, existing: preIds.length, officialIds: preIds, error: error.message };
    insertedIds = (ins ?? []).map((r) => r.id);
  }

  const allIds = [...new Set([...(existing ?? []).map((r) => r.id), ...insertedIds])];
  return {
    status: insertedIds.length > 0 ? "ok" : "skip",
    inserted: insertedIds.length,
    existing: (existing ?? []).length,
    officialIds: allIds,
  };
}
