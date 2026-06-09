#!/usr/bin/env node
/**
 * Restore the MS COUNTY kratom bans that the verification gate (migration 0190 /
 * verify-local-bans) deactivated as "single_source", but which are in fact
 * current bans — verified here with a repeal-aware, primary-anchored chain:
 *
 *   - The county bans were enacted ~2017–2019 (well-documented).
 *   - MS HB1077 (2025 Regular Session, PRIMARY: billstatus.ls.state.ms.us)
 *     grandfathers every local kratom ban enacted before 2025-07-01 — i.e. a
 *     pre-2025 county ban PERSISTS unless the county itself repealed it.
 *   - Repeal sweep (2026-06): only Monroe County (repealed 2020) and Jones
 *     County (reversed 2025-05, WDAM) were found repealed. Monroe is EXCLUDED
 *     here; Jones was never in our set.
 *
 * Cities are deliberately NOT restored — city-level lists are the most
 * aggregator-inflated and fall below the two-source bar; the verify pipeline
 * (de-Gemini / SearXNG) handles those.
 *
 * Dry-run by default. Owner authorized the restore (2026-06-08).
 *   node --env-file=.env.local scripts/restore-verified-ms-county-bans.mjs
 *   node --env-file=.env.local scripts/restore-verified-ms-county-bans.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// The 10 confirmed-current MS county bans (Monroe excluded — repealed 2020).
// bill_number is the stable key; we restore by it so row-id drift is moot.
const CONFIRMED_COUNTY_BILLS = [
  "LOCAL-BAN ALCORN-CO",
  "LOCAL-BAN CALHOUN-CO",
  "LOCAL-BAN ITAWAMBA-CO",
  "LOCAL-BAN LOWNDES-CO",
  "LOCAL-BAN NOXUBEE-CO",
  "LOCAL-BAN PEARL-RIVER-CO",
  "LOCAL-BAN PRENTISS-CO",
  "LOCAL-BAN TIPPAH-CO",
  "LOCAL-BAN TISHOMINGO-CO",
  "LOCAL-BAN UNION-CO", // canonical; the dup LOCAL-BAN UNION-COUNTY stays inactive
];

const VERIFIED_NOTE = [
  "Verified current 2026-06-08 (owner-authorized restore).",
  "Basis: enacted ~2017–2019; persists per MS HB1077 (2025, grandfathers pre-2025-07-01 local bans);",
  "repeal sweep found no reversal (Monroe County excluded — repealed 2020; Jones County reversed 2025).",
  "Sources: MS HB1077 (billstatus.ls.state.ms.us) + legislativeanalysis.org (LAPPA) + Magnolia Tribune coverage.",
].join(" ");

const SOURCE_URL = "https://billstatus.ls.state.ms.us/documents/2025/html/HB/1000-1099/HB1077SG.htm";

console.log(`${APPLY ? "APPLY" : "DRY-RUN"} — restoring ${CONFIRMED_COUNTY_BILLS.length} MS county bans\n`);

let restored = 0, missing = 0, alreadyActive = 0;
for (const bn of CONFIRMED_COUNTY_BILLS) {
  const { data: row } = await sb.from("bills")
    .select("id, locality, active, status, verification_status")
    .eq("state", "MS").eq("bill_number", bn).maybeSingle();
  if (!row) { console.log(`  ? ${bn}: not found`); missing++; continue; }
  if (row.active && row.verification_status === "confirmed") { console.log(`  = ${row.locality}: already confirmed+active`); alreadyActive++; continue; }
  console.log(`  ${APPLY ? "↑" : "would restore"} ${row.locality} (was active=${row.active} vstatus=${row.verification_status})`);
  if (APPLY) {
    const { error } = await sb.from("bills").update({
      active: true,
      status: "enacted",
      verification_status: "confirmed",
      verified_at: new Date().toISOString(),
      // Provenance: primary HB1077 link in source_url; full chain in summary.
      source_url: SOURCE_URL,
      summary: VERIFIED_NOTE,
      last_synced_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (error) { console.log(`    ✗ ${error.message}`); continue; }
    restored++;
  }
}

console.log(`\n${APPLY ? `Restored ${restored}` : "Dry-run"} · already-confirmed ${alreadyActive} · missing ${missing}`);
console.log("Monroe County + all MS cities intentionally NOT restored (repealed / below the two-source bar).");
process.exit(0);
