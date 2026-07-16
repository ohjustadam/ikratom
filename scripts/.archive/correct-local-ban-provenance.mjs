#!/usr/bin/env node
/**
 * Apply the two-source verification gate to existing LOCAL bans (one-time, but
 * re-runnable). Background: 0190_bill_verification_gate.sql.
 *
 * The county/municipal kratom bans were bulk-seeded from a single aggregator
 * (kratomlords.com) as enacted+active with no dates. Per the "confirm before
 * we list it as true" rule, an uncorroborated single-aggregator ban must not
 * be shown as a current fact. This script:
 *
 *   1. Holds every editorial-seed / single-aggregator LOCAL ban:
 *      verification_status='single_source', active=false (stops showing on
 *      /banned + /states). scripts/verify-local-bans.mjs then re-confirms the
 *      real ones (>=2 sources -> 'confirmed', active=true) over the next runs.
 *   2. Special-cases the reported one — Monroe County, MS — as 'repealed'
 *      (Northeast Mississippi Daily Journal: supervisors rescinded the ban
 *      3-2 on 2020-06-01; originally passed March 2019).
 *   3. Reports duplicate rows (same locality, different bill_number) so they
 *      can be collapsed.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   node --env-file=.env.local scripts/correct-local-ban-provenance.mjs
 *   node --env-file=.env.local scripts/correct-local-ban-provenance.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const AGGREGATOR_HINTS = ["kratomlords", "kratomscience", "legalclarity", "kratomgeek", "kratomaton", "kratomcountry", "authentickratom", "superspeciosa", "goldenmonk"];

const isAggregator = (url) => !!url && AGGREGATOR_HINTS.some((h) => url.toLowerCase().includes(h));

console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN"}\n`);

// All active LOCAL bans that are editorial-seeded or single-aggregator sourced
// and not already gated.
const { data: rows, error } = await sb.from("bills")
  .select("id, bill_number, state, locality, scope, source_url, session_id, verification_status")
  .in("scope", ["county", "municipal"])
  .eq("active", true)
  .is("verification_status", null);
if (error) { console.error(error.message); process.exit(1); }

const targets = (rows ?? []).filter(
  (r) => r.session_id === "editorial-seed" || isAggregator(r.source_url),
);

console.log(`Local bans active+ungated: ${rows?.length ?? 0} · single-source/editorial targets: ${targets.length}\n`);

// Duplicate detection (same locality+scope, >1 row).
const byLoc = {};
for (const r of targets) { const k = `${r.scope}|${(r.locality || "").toLowerCase()}`; (byLoc[k] ||= []).push(r); }
const dupes = Object.entries(byLoc).filter(([, v]) => v.length > 1);
if (dupes.length) {
  console.log("Duplicate localities (collapse later — all held now anyway):");
  for (const [k, v] of dupes) console.log(`  ${k} → ${v.map((x) => x.bill_number).join(", ")}`);
  console.log("");
}

let held = 0, repealed = 0;
const NOW = new Date().toISOString();

for (const r of targets) {
  const isMonroe = r.state === "MS" && /^monroe county/i.test(r.locality || "");
  if (isMonroe) {
    repealed++;
    console.log(`  REPEALED  ${r.locality} (${r.bill_number})`);
    if (APPLY) {
      await sb.from("bills").update({
        active: false,
        status: "dead",
        verification_status: "repealed",
        verified_at: NOW,
        verification_note: "Monroe County Board of Supervisors rescinded the kratom ban 3-2 on 2020-06-01 (originally passed March 2019). Confirmed by Northeast Mississippi Daily Journal + corroborating reports; resident report flagged the stale listing.",
        verification_sources: [
          { url: "https://www.djournal.com/monroe/news/monroe-county-supervisors-rescind-ban-on-kratom/article_d14806b6-09ec-5729-adfd-87aa5494310b.html", tier: "authoritative", checked_at: NOW },
          { url: "https://www.djournal.com/news/monroe-county-joins-growing-list-of-areas-banning-kratom/article_33df233c-acfb-590a-9441-415cb7602851.html", tier: "authoritative", checked_at: NOW },
        ],
      }).eq("id", r.id);
    }
  } else {
    held++;
    if (APPLY) {
      await sb.from("bills").update({
        active: false,
        verification_status: "single_source",
        verified_at: NOW,
        verification_note: "Held pending two-source confirmation: seeded from a single aggregator, not yet corroborated by an authoritative source. scripts/verify-local-bans.mjs will re-confirm or repeal.",
        verification_sources: r.source_url ? [{ url: r.source_url, tier: "aggregator", checked_at: NOW }] : [],
      }).eq("id", r.id);
    }
  }
}

console.log(`\n${APPLY ? "Applied" : "Would apply"}: ${held} held (single_source, hidden) · ${repealed} repealed (Monroe).`);
console.log(`Next: run scripts/verify-local-bans.mjs to re-confirm genuinely-banned localities (>=2 sources) and re-activate them.`);
process.exit(0);
