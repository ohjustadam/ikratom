#!/usr/bin/env node
/**
 * Pull the full slate of local officials for any city/county-scoped bill —
 * mayor + ALL city council members (or county exec + ALL commissioners) — and
 * insert them into the legislators table so:
 *
 *   1. The /bills/[id] action card can render them all with mailto:/tel:/
 *      website buttons (not just the 1-2 names mentioned in a news article)
 *   2. They appear on /admin/locals + the public surface for the locality
 *   3. Future campaigns auto-target them (retarget RPC picks them up)
 *
 * De-Gemini'd 2026-06-08 (private/LOCAL_REPS_DEGEMINI_PLAN.md): resolution is
 * findAndExtractOfficials — Legistar webapi first (authoritative, keyless),
 * then self-hosted SearXNG + local Ollama / free-tier Groq-Cerebras to extract
 * from a deterministically-fetched .gov page. NO Gemini, NO Google-Search
 * grounding, no per-day quota. Localities not on Legistar that can't be reached
 * here (no SearXNG/Ollama) are left for an owner batch run.
 *
 * Run:
 *   node --env-file=.env.local scripts/seed-bill-officials.mjs --bill <uuid>
 *   node --env-file=.env.local scripts/seed-bill-officials.mjs --all-municipal
 *   node --env-file=.env.local scripts/seed-bill-officials.mjs --all-municipal --refresh
 */
import { createClient } from "@supabase/supabase-js";
import { reconcileLocality } from "./lib/geo-resolver.mjs";
import { findAndExtractOfficials } from "./lib/officials-extract.mjs";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Domains that squat / park URLs. If a council member's website resolves to
// one of these on a HEAD check, drop the URL rather than feed it to the UI.
const PARKED_DOMAINS = [
  "hugedomains.com", "sedoparking.com", "dan.com", "godaddy.com",
  "parkingcrew.net", "afternic.com", "uniregistry.com", "buydomains.com",
  "domainmarket.com",
];

async function isUsableUrl(rawUrl) {
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
    return true; // fail-open on network errors
  }
}

// Tier for verified_sources_md: Legistar clerk roster = verified; a
// SearXNG-extracted official is verified when the cited page is .gov/.us
// (the name was read off that page), else tentative for admin spot-check.
function tierFor(o) {
  if (o.source_kind === "legistar") return "verified";
  try {
    const host = new URL(o.source_url).hostname.toLowerCase();
    if (host.endsWith(".gov") || host.endsWith(".us")) return "verified";
  } catch { /* ignore */ }
  return "tentative";
}
function sourcesMd(o, tier) {
  if (o.source_kind === "legistar") {
    return [`- Tier: **verified** (Legistar — official clerk system)`, o.source_url ? `- Source: ${o.source_url}` : null, o.source_note ? `- ${o.source_note}` : null].filter(Boolean).join("\n");
  }
  return [`- Tier: **${tier}**${tier === "tentative" ? " (admin spot-check recommended)" : ""}`, o.source_url ? `- Source: ${o.source_url}` : null, o.source_note ? `- ${o.source_note}` : null].filter(Boolean).join("\n");
}

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const SPECIFIC = arg("--bill");
const ALL = args.includes("--all-municipal");
const REFRESH = args.includes("--refresh");

if (!SPECIFIC && !ALL) {
  console.error("Usage: --bill <uuid>  OR  --all-municipal  (optionally --refresh)");
  process.exit(1);
}

// Return values:
//   "ok"   — seeded new officials
//   "skip" — no-op (already covered, no locality, or queued for batch infra)
//   "fail" — actual failure (resolver error, insert error, 0 officials found)
async function processBill(bill) {
  console.log(`\n=== ${bill.id.slice(0, 8)} | ${bill.state} ${bill.bill_number} | ${bill.locality} ===`);
  if (!bill.locality) { console.log("  ⏭  no locality on bill"); return "skip"; }

  if (bill.locality.length > 120 || /\n|^\s*Arguments|^\s*[A-Z][a-z]+\s+\d/.test(bill.locality)) {
    console.log(`  ⏭  malformed locality (${bill.locality.length} chars or paragraph-like); skip — needs admin cleanup`);
    return "skip";
  }

  const cityMatch = bill.locality.match(/^([^,]+),\s*([A-Z]{2})/);
  const city = cityMatch?.[1]?.trim() ?? bill.locality.trim();

  // Gazetteer guard: confirm the city in bill.locality actually sits in
  // bill.state before seeding PERMANENT legislator rows for that pair.
  const { locality: resolvedState, corroborated } = reconcileLocality({
    aiLocality: bill.state,
    scopeState: bill.state,
    text: bill.locality,
    title: bill.bill_number ?? "",
  });
  if (!corroborated) {
    console.log(`  ⏭  locality-guard: "${bill.locality}" not corroborated as ${bill.state} (gazetteer → ${resolvedState}); skip seeding — would insert wrong-state officials`);
    return "skip";
  }

  // Skip if locality already has officials and not forcing refresh
  if (!REFRESH) {
    const { count } = await sb.from("legislators").select("id", { count: "exact", head: true })
      .eq("state", bill.state)
      .eq("locality", bill.locality)
      .in("role", ["city_council", "mayor", "county_executive", "county_commissioner"])
      .eq("active", true);
    if ((count ?? 0) > 0) {
      console.log(`  ⏭  ${count} officials already exist for ${bill.locality}; skip (use --refresh to force)`);
      return "skip";
    }
  }

  const level = /\b(county|parish|borough)\b/i.test(bill.locality) ? "county" : "municipal";
  console.log(`  resolving ${city}, ${bill.state} officials (Legistar → SearXNG+Ollama)…`);
  let res;
  try {
    res = await findAndExtractOfficials({ sb, city, state: bill.state, locality: bill.locality, level, caller: "seed-bill-officials" });
  } catch (e) {
    console.log(`  ✗ resolver failed: ${e.message?.slice(0, 200)}`);
    return "fail";
  }
  if (res.queued) {
    console.log(`  ⏳ queued (${res.reason}) — not on Legistar + long-tail infra unavailable here; an owner batch run will cover it`);
    return "skip";
  }
  if (!res.ok || res.officials.length === 0) {
    console.log(`  ⚠ 0 officials returned`);
    return "fail";
  }
  console.log(`  ✓ ${res.source}: ${res.officials.length} official(s)`);

  const cap = (s, n) => s ? String(s).slice(0, n).trim() || null : null;
  const websiteValidations = await Promise.all(res.officials.map((o) => isUsableUrl(o.website)));
  const droppedWebsites = res.officials
    .filter((_, i) => res.officials[i].website && !websiteValidations[i])
    .map((o) => o.full_name);
  if (droppedWebsites.length > 0) {
    console.log(`  ⚠ dropped ${droppedWebsites.length} invalid/parked official website(s): ${droppedWebsites.slice(0, 3).join(", ")}${droppedWebsites.length > 3 ? "…" : ""}`);
  }
  const rows = res.officials.map((o, i) => {
    const isCounty = (o.role ?? "").startsWith("county_");
    const tier = tierFor(o);
    return {
      full_name: cap(o.full_name, 120) ?? "Unknown",
      state: bill.state,
      role: o.role,
      locality: bill.locality,
      title: cap(o.title, 120),
      district: cap(o.district, 30),
      email: cap(o.email, 254),
      phone: cap(o.phone, 30),
      website: websiteValidations[i] ? cap(o.website, 500) : null,
      party: cap(o.party, 60),
      level: isCounty ? "county" : "municipal",
      body: isCounty ? "county_commission" : "city_council",
      active: true,
      term_end_date: o.term_end_date ?? null,
      verified_sources_md: sourcesMd(o, tier),
      last_synced_at: new Date().toISOString(),
    };
  });

  // Dedupe against existing rows in (state, locality, role, lower(full_name))
  const { data: existing } = await sb.from("legislators").select("role, full_name")
    .eq("state", bill.state)
    .eq("locality", bill.locality)
    .in("level", ["municipal", "county"]);
  const existingKeys = new Set(
    (existing ?? []).map((r) => `${r.role}::${(r.full_name ?? "").toLowerCase().trim()}`),
  );
  const newRows = rows.filter(
    (r) => !existingKeys.has(`${r.role}::${r.full_name.toLowerCase().trim()}`),
  );
  const skipped = rows.length - newRows.length;
  if (newRows.length === 0) {
    console.log(`  ⏭  all ${rows.length} already in DB`);
    return "skip";
  }

  const { data: inserted, error } = await sb.from("legislators").insert(newRows).select("id");
  if (error) {
    console.log(`  ✗ insert failed: ${error.message}`);
    return "fail";
  }
  console.log(`  ✓ inserted ${inserted?.length ?? 0} new official(s); skipped ${skipped} dupe(s)`);
  for (const o of newRows) {
    console.log(`     - ${o.role.padEnd(15)} ${o.full_name}${o.district ? ` (${o.district})` : ""}${o.email ? `  ✉ ${o.email}` : ""}`);
  }

  // Phase 4 retarget hook (migration 0073): now that this locality has
  // city/county officials, fix auto-campaigns that landed before the seed.
  try {
    const cityForMatch = bill.locality.split(",")[0].trim();
    const { data: retargets, error: retargetErr } = await sb.rpc(
      "retarget_auto_campaigns_for_locality",
      { p_state: bill.state, p_locality: cityForMatch },
    );
    if (retargetErr) {
      console.log(`  ⚠ retarget RPC failed: ${retargetErr.message}`);
    } else if (retargets && retargets.length > 0) {
      const fixed = retargets.filter((r) => r.result?.ok === true);
      console.log(`  ↻ retargeted ${fixed.length}/${retargets.length} auto-campaign(s)`);
      for (const r of fixed) {
        console.log(`     - ${r.campaign_id.slice(0, 8)}: ${r.result.old_count} → ${r.result.new_count} targets (${r.result.tier})`);
      }
    }
  } catch (e) {
    console.log(`  ⚠ retarget hook error: ${e.message?.slice(0, 200)}`);
  }
  return "ok";
}

let bills;
if (SPECIFIC) {
  const { data } = await sb.from("bills").select("id, state, bill_number, locality, scope")
    .eq("id", SPECIFIC).single();
  bills = data ? [data] : [];
} else {
  const { data } = await sb.from("bills").select("id, state, bill_number, locality, scope")
    .in("scope", ["municipal", "county"])
    .eq("active", true)
    .order("created_at", { ascending: false });
  bills = data ?? [];
}

if (bills.length === 0) { console.log("No bills to process."); process.exit(0); }
console.log(`Processing ${bills.length} local bill(s)…`);

let ok = 0, fail = 0, skip = 0;
for (const b of bills) {
  const r = await processBill(b);
  if (r === "ok") ok++;
  else if (r === "fail") fail++;
  else skip++;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`\nDone. ok=${ok}, fail=${fail}, skip=${skip}`);
try {
  // Error only when failures dominate; skips/queues are correct no-ops.
  const nonFail = ok + skip;
  const status =
    (fail > 0 && fail >= nonFail) ? "error" :
    (ok === 0 && skip === 0) ? "empty" :
    "success";
  await sb.from("scraper_runs").insert({
    source: "seed_bill_officials",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status,
    rows_added: ok,
    notes: `${ok} seeded, ${skip} no-op/queued, ${fail} failed`,
    error_message: fail > 0 ? `${fail}/${bills.length} item(s) failed (resolver/insert)` : null,
  });
} catch { /* best-effort */ }
