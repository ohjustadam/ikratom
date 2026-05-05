#!/usr/bin/env node
/**
 * iKratom — OpenStates legislator sync
 *
 * Syncs state legislators (state_senate + state_house) for all 50 states + DC
 * from OpenStates v3 API into public.legislators.
 *
 * US Senate / US House (us_senate / us_house) are NOT synced here — those come
 * from LegiScan or ProPublica Congress API once we have access.
 *
 * Run with:
 *   node --env-file=.env.local scripts/sync-legislators.mjs
 *
 * Optional first arg: a single state abbr (e.g. OK) to sync just that state.
 */

import { createClient } from "@supabase/supabase-js";

const OPENSTATES = "https://v3.openstates.org";
const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const apiKey = process.env.OPENSTATES_API_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!apiKey) die("Missing OPENSTATES_API_KEY in .env.local");
if (!supabaseUrl) die("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
if (!serviceKey) die("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

// ---------- helpers ----------
function die(msg) { console.error("❌", msg); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(state, page) {
  const url = `${OPENSTATES}/people?jurisdiction=${state.toLowerCase()}&page=${page}&per_page=50&include=offices`;
  const res = await fetch(url, { headers: { "X-API-Key": apiKey } });
  if (res.status === 429) {
    console.log("  rate limited, sleeping 30s...");
    await sleep(30_000);
    return fetchPage(state, page);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenStates ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function mapPerson(state, p) {
  const role = p.current_role;
  if (!role) return null; // not currently in office

  const orgClass = role.org_classification;
  let mappedRole = null;
  if (orgClass === "upper") mappedRole = "state_senate";
  else if (orgClass === "lower") mappedRole = "state_house";
  else if (orgClass === "legislature") mappedRole = "state_senate"; // unicameral (NE, DC)
  else return null;

  const phone = (p.offices || []).find((o) => o.voice)?.voice || null;
  const website = (p.links || []).find((l) => /home|official/i.test(l.note || ""))?.url
    || (p.links || [])[0]?.url
    || null;
  const officeAddr = (p.offices || []).find((o) => o.address)?.address || null;

  return {
    state,
    role: mappedRole,
    district: role.district != null ? String(role.district) : null,
    full_name: p.name,
    party: p.party || null,
    email: p.email || null,
    phone,
    office_address: officeAddr,
    website,
    openstates_id: p.id,
    active: true,
    last_synced_at: new Date().toISOString(),
  };
}

async function syncState(state) {
  process.stdout.write(`  ${state}: `);
  const all = [];
  let page = 1;
  while (true) {
    const data = await fetchPage(state, page);
    const results = data.results || [];
    for (const p of results) {
      const row = mapPerson(state, p);
      if (row) all.push(row);
    }
    const max = data.pagination?.max_page ?? 1;
    if (page >= max) break;
    page++;
    await sleep(1100); // ~1 req/sec to stay polite
  }

  if (all.length === 0) {
    console.log("0 legislators (nothing to upsert)");
    return { state, count: 0 };
  }

  const { error } = await supabase
    .from("legislators")
    .upsert(all, { onConflict: "openstates_id" });

  if (error) {
    console.log(`ERROR ${error.message}`);
    return { state, count: 0, error: error.message };
  }

  console.log(`${all.length} synced`);
  return { state, count: all.length };
}

// ---------- main ----------
const onlyState = process.argv[2]?.toUpperCase();
const targets = onlyState ? [onlyState] : STATES;

console.log(`\nSyncing ${targets.length} state(s) from OpenStates...\n`);
const t0 = Date.now();
const summary = [];

for (const s of targets) {
  try {
    const r = await syncState(s);
    summary.push(r);
  } catch (e) {
    console.log(`  ${s}: FAILED — ${e.message}`);
    summary.push({ state: s, count: 0, error: e.message });
  }
  await sleep(1100); // gap between states
}

const total = summary.reduce((a, b) => a + (b.count || 0), 0);
const failed = summary.filter((s) => s.error);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log("\n----------------------------------------");
console.log(`Done in ${elapsed}s — ${total} legislators across ${targets.length} states`);
if (failed.length) {
  console.log(`Failed: ${failed.map((f) => f.state).join(", ")}`);
}
process.exit(0);
