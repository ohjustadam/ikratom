/**
 * Resolve every pending local_rep_requests row — no admin in the loop.
 *
 * Usage: node --env-file=.env.local scripts/auto-fulfill-pending-local-reps.mjs
 *
 * Owner directive 2026-05-16: process pending local-rep coverage requests
 * automatically. De-Gemini'd 2026-06-08 (private/LOCAL_REPS_DEGEMINI_PLAN.md):
 * resolution is findAndExtractOfficials — Legistar webapi first (authoritative,
 * keyless), then self-hosted SearXNG + local Ollama / free-tier Groq-Cerebras
 * to extract officials from a deterministically-fetched .gov page. NO Gemini,
 * NO Google-Search grounding, no per-day quota. Re-runnable; idempotent.
 *
 * Run this where the SearXNG/Ollama infra is reachable (owner box / self-hosted
 * runner) to drain the long tail the cloud crons leave queued.
 */
import { createClient } from "@supabase/supabase-js";
import { findAndExtractOfficials } from "./lib/officials-extract.mjs";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Two-source gate: confirm an extracted official's name actually appears on
// its cited source page before we publish the row.
async function verify(fullName, sourceUrl) {
  if (!sourceUrl) return { ok: false, reason: "no-url" };
  try {
    const r = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "iKratom Civic Verifier (research@ikratom.org)" },
    });
    if (!r.ok) return { ok: false, reason: `fetch ${r.status}` };
    const text = stripHtml(await r.text()).toLowerCase();
    if (text.includes(fullName.toLowerCase())) return { ok: true, snippet: text.slice(Math.max(0, text.indexOf(fullName.toLowerCase()) - 60), text.indexOf(fullName.toLowerCase()) + 120) };
    const last = fullName.split(/\s+/).pop()?.toLowerCase();
    if (last && last.length >= 4 && text.includes(last)) return { ok: true, snippet: `(last-name match: ${last})` };
    return { ok: false, reason: "name-not-found" };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

const { data: pending } = await sb
  .from("local_rep_requests")
  .select("id, state, locality, level")
  .eq("status", "pending");
console.log(`pending: ${pending?.length ?? 0}`);

const seen = new Set();
let totalInserted = 0;
let totalSkipped = 0;
// Stop the run if many localities can't be resolved in a row (infra down or
// genuinely sparse) — but never on a single miss; one bad locality shouldn't
// strand every other pending member request behind it.
let consecutiveUnresolved = 0;
const UNRESOLVED_STREAK_STOP = 5;

for (const req of pending ?? []) {
  const key = `${req.state}|${req.locality}|${req.level}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`\n--- ${req.locality} (${req.level}) ---`);
  const city = req.locality.replace(/,\s*[A-Z]{2}$/, "");

  const res = await findAndExtractOfficials({
    sb, city, state: req.state, locality: req.locality, level: req.level, caller: "auto-fulfill-pending-cli",
  });

  if (res.queued) {
    console.log(`  ⏳ queued (${res.reason}) — left pending`);
    if (res.reason === "searxng-unconfigured") {
      console.log("  ⚠ SEARXNG_URL not configured — run this where the local search+Ollama infra is reachable. Stopping.");
      break;
    }
    consecutiveUnresolved++;
    if (consecutiveUnresolved >= UNRESOLVED_STREAK_STOP) {
      console.log(`  ⚠ ${consecutiveUnresolved} localities unresolved in a row — stopping; rerun later.`);
      break;
    }
    continue;
  }
  if (!res.ok || res.officials.length === 0) {
    console.log(`  ✗ no officials: ${res.error ?? "0 returned"}`);
    consecutiveUnresolved++;
    if (consecutiveUnresolved >= UNRESOLVED_STREAK_STOP) break;
    continue;
  }
  consecutiveUnresolved = 0;

  const fromLegistar = res.source === "legistar";
  console.log(`  ${fromLegistar ? "Legistar (clerk)" : res.source}: ${res.officials.length} official(s)`);

  const { data: existing } = await sb.from("legislators").select("full_name").eq("level", req.level).eq("locality", req.locality).eq("active", true);
  const existingNames = new Set((existing ?? []).map((r) => r.full_name.toLowerCase()));

  const rows = [];
  for (const o of res.officials) {
    if (existingNames.has(o.full_name.toLowerCase())) { console.log(`    = ${o.full_name}: already in DB`); continue; }
    let md;
    if (fromLegistar) {
      md = [
        `- Tier: **verified** (Legistar — official clerk system)`,
        o.source_url ? `- Source: ${o.source_url}` : null,
        o.source_note ? `- ${o.source_note}` : null,
      ].filter(Boolean).join("\n");
    } else {
      const v = await verify(o.full_name, o.source_url);
      if (!v.ok) { console.log(`    ✗ ${o.full_name}: ${v.reason}`); totalSkipped++; continue; }
      md = [
        o.source_url ? `- Source: ${o.source_url}` : null,
        `- Verifier snippet: "${v.snippet}"`,
        o.source_note ? `- ${o.source_note}` : null,
      ].filter(Boolean).join("\n");
    }
    rows.push({
      state: req.state,
      role: o.role || "other_local",
      district: o.district,
      full_name: o.full_name,
      party: o.party,
      email: o.email,
      phone: o.phone,
      website: o.website,
      title: o.title,
      level: req.level,
      locality: req.locality,
      body: req.level === "municipal" ? "city_council" : "county_commission",
      active: true,
      term_end_date: o.term_end_date ?? null,
      verified_sources_md: md,
      last_synced_at: new Date().toISOString(),
    });
    console.log(`    ✓ ${o.full_name} → ${fromLegistar ? "Legistar" : "verified"}`);
  }
  if (rows.length > 0) {
    const { error } = await sb.from("legislators").insert(rows);
    if (error) { console.log(`  ✗ insert: ${error.message}`); continue; }
    console.log(`  ✓ inserted ${rows.length}`);
    totalInserted += rows.length;
  }

  // Fulfill only when the locality now has officials (inserted or already
  // present). If every extracted official failed verification, leave pending.
  const covered = rows.length > 0 || (existing ?? []).length > 0;
  if (covered) {
    await sb.from("local_rep_requests").update({ status: "fulfilled", resolved_at: new Date().toISOString() })
      .eq("state", req.state).eq("locality", req.locality).eq("level", req.level).eq("status", "pending");
  }
}
console.log(`\n=== TOTAL: inserted ${totalInserted} · skipped ${totalSkipped} ===`);
