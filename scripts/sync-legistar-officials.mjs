#!/usr/bin/env node
/**
 * Seed local officials from the Legistar webapi — FREE, key-less, no
 * per-day cap, authoritative (the clerk's own system). The non-grounded
 * counterpart to the Gemini-grounded officials path, so major-metro
 * councils never spend a scarce grounded call.
 *
 * For each tenant in scripts/lib/legistar-tenants.mjs: pull the current
 * council/board roster and upsert into `legislators` (level municipal/
 * county, dedupe by locality+name). Also closes any matching
 * local_rep_requests. Tenants whose Legistar doesn't expose membership
 * (many only use it for agendas) are skipped + logged — grounding still
 * covers those.
 *
 * Idempotent. scraper_runs telemetry via runWithLogging. Registered in
 * check-cron-staleness.mjs (daily).
 *
 *   npm run sync:legistar -- --dry-run        # coverage report, no writes
 *   npm run sync:legistar                      # seed all tenants
 *   npm run sync:legistar -- --tenant seattle  # one tenant
 */
import { createClient } from "@supabase/supabase-js";
import { LEGISTAR_TENANTS } from "./lib/legistar-tenants.mjs";
import { fetchLegistarOfficials, webapiClientFor } from "./lib/legistar-officials.mjs";
import { normLoc } from "./lib/legistar-resolver.mjs";
import { runWithLogging } from "./lib/scraper-run.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const ONE = arg("--tenant");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function levelFor(tenant) {
  if (/county|borough|parish/i.test(tenant.locality) || /supervisor|commission|county/i.test(tenant.body)) return "county";
  return "municipal";
}

await runWithLogging({ source: "sync_legistar_officials", supabase: sb }, async () => {
  let tenants;
  if (ONE) {
    tenants = LEGISTAR_TENANTS.filter((t) => t.subdomain === ONE);
  } else {
    // Hand-curated list + auto-discovered cache (discover-legistar-tenants.mjs
    // writes legistar_tenants with probe_status='live'). Dedupe the cache
    // against the hand list by (state, normalized locality).
    const handKeys = new Set(LEGISTAR_TENANTS.map((t) => `${t.state.toUpperCase()}|${normLoc(t.locality)}`));
    const { data: cached } = await sb.from("legistar_tenants")
      .select("state, locality, subdomain, webapi_client, body").eq("probe_status", "live");
    const extra = (cached ?? [])
      .filter((t) => t.webapi_client && !handKeys.has(`${String(t.state).toUpperCase()}|${normLoc(t.locality)}`))
      .map((t) => ({ subdomain: t.subdomain ?? t.webapi_client, state: String(t.state).toUpperCase(), locality: t.locality, body: t.body ?? undefined }));
    tenants = [...LEGISTAR_TENANTS, ...extra];
    console.log(`  (${LEGISTAR_TENANTS.length} hand + ${extra.length} discovered)`);
  }
  console.log(`Legistar officials sync${DRY ? " (DRY RUN)" : ""} — ${tenants.length} tenant(s)\n`);

  let inserted = 0, updated = 0, fulfilledReqs = 0, covered = 0, skipped = 0;
  const todayIso = new Date().toISOString();

  for (const t of tenants) {
    const level = levelFor(t);
    const tag = `${t.locality}`.padEnd(28);
    const res = await fetchLegistarOfficials({
      client: webapiClientFor(t), bodyHint: t.body, level, subdomain: t.subdomain, todayIso,
    });
    if (res.error) { console.log(`  ✗ ${tag} ${res.error}`); skipped++; continue; }
    covered++;
    console.log(`  ✓ ${tag} ${res.officials.length} on "${res.body}" (${res.officials.filter((o) => o.email).length} emails)`);
    if (DRY) continue;

    // Dedupe against existing active rows for this locality.
    const { data: existing } = await sb.from("legislators")
      .select("id, full_name").eq("level", level).eq("locality", t.locality).eq("active", true);
    const existingByName = new Map((existing ?? []).map((r) => [r.full_name.toLowerCase(), r.id]));

    for (const o of res.officials) {
      const row = {
        state: t.state, role: o.role, district: o.district, full_name: o.full_name,
        party: o.party, email: o.email, phone: o.phone, website: o.website, title: o.title,
        level, locality: t.locality,
        body: level === "municipal" ? "city_council" : "county_commission",
        active: true, term_end_date: o.term_end_date,
        verified_sources_md: [
          `- Tier: **verified** (Legistar — official clerk system)`,
          `- Source: ${o.source_url}`,
          `- ${o.source_note}`,
        ].join("\n"),
        last_synced_at: new Date().toISOString(),
      };
      const existingId = existingByName.get(o.full_name.toLowerCase());
      if (existingId) {
        // Refresh contact info on the existing row (term/email may change).
        const { error } = await sb.from("legislators").update({
          email: row.email, phone: row.phone, website: row.website,
          title: row.title, term_end_date: row.term_end_date,
          verified_sources_md: row.verified_sources_md, last_synced_at: row.last_synced_at,
        }).eq("id", existingId);
        if (!error) updated++;
      } else {
        const { error } = await sb.from("legislators").insert(row);
        if (!error) inserted++;
      }
    }

    // Close any pending coverage requests for this locality.
    const { data: closed } = await sb.from("local_rep_requests")
      .update({ status: "fulfilled", resolved_at: new Date().toISOString() })
      .eq("state", t.state).eq("locality", t.locality).eq("level", level).eq("status", "pending")
      .select("id");
    fulfilledReqs += closed?.length ?? 0;
  }

  console.log(`\nDone — ${covered}/${tenants.length} tenants covered, ${skipped} skipped (no Legistar roster).`);
  console.log(`  inserted ${inserted}, updated ${updated}, member requests fulfilled ${fulfilledReqs}`);
  return {
    rowsAdded: DRY ? 0 : inserted,
    rowsUpdated: DRY ? 0 : updated,
    notes: `${DRY ? "dry-run " : ""}${covered}/${tenants.length} covered, ${skipped} no-roster, ${inserted} inserted, ${updated} updated, ${fulfilledReqs} reqs fulfilled`,
  };
});
