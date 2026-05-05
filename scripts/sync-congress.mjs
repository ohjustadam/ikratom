#!/usr/bin/env node
/**
 * iKratom — US Congress sync (Senate + House).
 *
 * Source: github.com/unitedstates/congress-legislators (CC0 public domain).
 * No API key. Always-current JSON published from the official roster.
 *
 * Run with: node --env-file=.env.local scripts/sync-congress.mjs
 */

import { createClient } from "@supabase/supabase-js";

// JSON mirror published by the maintainers (raw repo only ships YAML)
const URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

console.log("Fetching congress-legislators data…");
const res = await fetch(URL);
if (!res.ok) {
  console.error(`Failed: ${res.status}`);
  process.exit(1);
}
const people = await res.json();

// We only track 50 states + DC. Territories (AS, GU, MP, PR, VI) have
// non-voting House delegates — skip them for now.
const VALID_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM",
  "NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA",
  "WV","WI","WY",
]);

const rows = [];
let skipped = 0;
const now = new Date().toISOString();

for (const p of people) {
  // Take the most recent term
  const term = p.terms?.[p.terms.length - 1];
  if (!term) continue;
  if (term.end && new Date(term.end) < new Date()) continue; // skip expired

  const role =
    term.type === "sen" ? "us_senate" :
    term.type === "rep" ? "us_house" : null;
  if (!role) continue;

  // Skip territories (no entry in our states table)
  if (!VALID_STATES.has(term.state)) {
    skipped++;
    continue;
  }

  const fullName = `${p.name?.first ?? ""} ${p.name?.last ?? ""}`.trim();
  const partyMap = { Democrat: "Democratic", Republican: "Republican", Independent: "Independent" };
  const party = partyMap[term.party] ?? term.party ?? null;

  // House members have a district; senators don't (state-wide).
  const district = role === "us_house" && term.district != null
    ? String(term.district)
    : null;

  rows.push({
    state: term.state,
    role,
    district,
    full_name: fullName,
    party,
    email: term.contact_form ?? null, // form URL — not a true email but the canonical contact channel
    phone: term.phone ?? null,
    office_address: term.office ?? null,
    website: term.url ?? null,
    bioguide_id: p.id?.bioguide ?? null,
    active: true,
    last_synced_at: now,
  });
}

console.log(`Mapped ${rows.length} federal legislators (House + Senate). Upserting…`);

// Batch upsert by bioguide_id
const { error } = await supabase
  .from("legislators")
  .upsert(rows, { onConflict: "bioguide_id" });

if (error) {
  console.error("Upsert failed:", error.message);
  process.exit(1);
}

const senCount = rows.filter((r) => r.role === "us_senate").length;
const repCount = rows.filter((r) => r.role === "us_house").length;
console.log(`✓ ${senCount} Senators · ${repCount} Representatives synced`);
if (skipped > 0) console.log(`  (skipped ${skipped} territory delegates)`);
