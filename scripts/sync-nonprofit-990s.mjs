#!/usr/bin/env node
/**
 * Sync IRS Form 990 filings for kratom-policy-aligned 501(c) orgs
 * from ProPublica Nonprofit Explorer (free, no auth).
 *
 * For each EIN: hit /organizations/<EIN>.json, parse the filings_with_data
 * + filings_without_data arrays, upsert rows into nonprofit_990_filings.
 * Surfaces topline finances + officer comp on /intel/actors.
 *
 * Adding a new org? Append to TRACKED_ORGS below with its EIN.
 *
 * Usage:
 *   node --env-file=.env.local scripts/sync-nonprofit-990s.mjs
 *   node --env-file=.env.local scripts/sync-nonprofit-990s.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// EINs sourced from the kratom-industry-actors registry. Add new orgs
// here as the registry grows. ProPublica resolves them via
// /api/v2/organizations/<EIN>.json (no auth required).
const TRACKED_ORGS = [
  { ein: "472208981", label: "American Kratom Association (AKA)" },
  { ein: "933734910", label: "Global Kratom Coalition (GKC)" },
  // Additional orgs to add as EINs surface from research:
  //   Botanical Education Alliance (BEA)
  //   Holistic Alternative Recovery Trust (HART)
  //   Center for Plant Science & Health (CPSH)
];

const UA = "iKratom-policy-monitor/1.0 (research@ikratom.org)";

async function fetchOrg(ein) {
  const url = `https://projects.propublica.org/nonprofits/api/v2/organizations/${ein}.json`;
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const t0 = Date.now();
let upserted = 0, errors = 0;
for (const org of TRACKED_ORGS) {
  process.stdout.write(`  ${org.label.padEnd(40)} `);
  let data;
  try { data = await fetchOrg(org.ein); }
  catch (e) { console.log(`✗ ${e.message?.slice(0, 60)}`); errors++; continue; }

  const orgName = data.organization?.name ?? org.label;
  const filings = [
    ...(data.filings_with_data ?? []).map((f) => ({ ...f, _has_data: true })),
    ...(data.filings_without_data ?? []).map((f) => ({ ...f, _has_data: false })),
  ];
  let countForOrg = 0;
  for (const f of filings) {
    const tax_year = f.tax_prd_yr ?? f.tax_prd?.toString().slice(0, 4);
    if (!tax_year) continue;
    const row = {
      ein: String(org.ein),
      org_name: orgName,
      tax_year: parseInt(String(tax_year), 10),
      total_revenue: f.totrevenue ?? null,
      total_expenses: f.totfuncexpns ?? null,
      total_compensation: f.compnsatncurrofcr ?? null,
      officer_compensation: f.compnsatncurrofcr ?? null,
      total_assets_eoy: f.totassetsend ?? null,
      total_liabilities_eoy: f.totliabend ?? null,
      officers: [],
      pdf_url: f.pdf_url ?? null,
      source_url: `https://projects.propublica.org/nonprofits/organizations/${org.ein}`,
      raw_json: f,
      synced_at: new Date().toISOString(),
    };
    if (DRY_RUN) { countForOrg++; continue; }
    const { error } = await sb
      .from("nonprofit_990_filings")
      .upsert(row, { onConflict: "ein,tax_year" });
    if (error) { console.log(`✗ ${error.message?.slice(0, 60)}`); errors++; continue; }
    countForOrg++;
  }
  console.log(`✓ ${countForOrg} filings`);
  upserted += countForOrg;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${upserted} filings${DRY_RUN ? " (dry-run)" : ""}, ${errors} errors.`);

try {
  await sb.from("scraper_runs").insert({
    source: "sync_nonprofit_990s",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: errors === 0 ? "success" : "partial",
    rows_updated: upserted,
    notes: `${TRACKED_ORGS.length} orgs, ${errors} errors`,
  });
} catch { /* best-effort */ }
