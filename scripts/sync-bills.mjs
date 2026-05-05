#!/usr/bin/env node
/**
 * iKratom — State bill tracker via OpenStates /bills.
 *
 * Free tier we already have. Searches each state for kratom-related bills,
 * stores them in the bills table. Replaces the LegiScan dependency for v1
 * (LegiScan would still be a nice upgrade later — better status webhooks).
 *
 * Run with:
 *   node --env-file=.env.local scripts/sync-bills.mjs              # all
 *   node --env-file=.env.local scripts/sync-bills.mjs OK            # one state
 */

import { createClient } from "@supabase/supabase-js";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM",
  "NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA",
  "WV","WI","WY",
];

const KEYWORDS = ["kratom", "mitragynine", "7-hydroxymitragynine", "7-OH"];

const apiKey = process.env.OPENSTATES_API_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!apiKey) { console.error("Missing OPENSTATES_API_KEY"); process.exit(1); }
if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(state, query, page = 1, attempt = 0) {
  const url = new URL("https://v3.openstates.org/bills");
  url.searchParams.set("jurisdiction", state.toLowerCase());
  url.searchParams.set("q", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", "20");
  url.searchParams.set("sort", "updated_desc");
  url.searchParams.set("include", "abstracts");

  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 429 && attempt < 3) {
    const wait = (attempt + 1) * 30_000;
    console.log(`\n    rate limited — waiting ${wait / 1000}s`);
    await sleep(wait);
    return fetchPage(state, query, page, attempt + 1);
  }
  if (!res.ok) throw new Error(`OpenStates ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/**
 * Score a bill 'kratom_relevance' from the title/abstract:
 *   - "pro" if it explicitly references protective/regulatory framing (KCPA, regulation, age limits)
 *   - "anti" if it bans/schedules/prohibits
 *   - "neutral" if mentioned but unclear
 */
function classify(title, abstract) {
  const text = `${title} ${abstract ?? ""}`.toLowerCase();
  const ban = /\b(ban|prohibit|schedule|criminaliz|controlled substance)\b/.test(text);
  const protect = /\b(protect|regulat|age limit|consumer protection|kcpa|labeling|standards)\b/.test(text);
  const sevenOh = /\b(7-?oh|7-hydroxy|seven hydroxy)\b/.test(text);

  if (ban && !protect) return "anti";
  if (ban && sevenOh) return "anti";  // 7-OH bans = de facto anti even if framed neutrally
  if (protect && !ban) return "pro";
  return "neutral";
}

function statusFromBill(b) {
  // OpenStates statuses are varied; we collapse to our schema's enum:
  // 'introduced' | 'committee' | 'passed_chamber' | 'enacted' | 'dead'
  const latestAction = b.latest_action_description?.toLowerCase() ?? "";
  if (latestAction.includes("signed") || latestAction.includes("became law") || latestAction.includes("enacted")) return "enacted";
  if (latestAction.includes("died") || latestAction.includes("indefinitely postponed") || latestAction.includes("withdrawn") || latestAction.includes("failed")) return "dead";
  if (latestAction.includes("passed") || latestAction.includes("third reading")) return "passed_chamber";
  if (latestAction.includes("committee") || latestAction.includes("referred")) return "committee";
  return "introduced";
}

async function syncState(state) {
  process.stdout.write(`  ${state}: `);
  const all = new Map();

  for (const kw of KEYWORDS) {
    let page = 1;
    while (true) {
      let data;
      try {
        data = await fetchPage(state, kw, page);
      } catch (e) {
        console.log(`FAILED — ${e.message}`);
        return { state, count: 0, error: e.message };
      }
      const results = data.results ?? [];
      for (const b of results) {
        if (!all.has(b.id)) all.set(b.id, b);
      }
      const max = data.pagination?.max_page ?? 1;
      if (page >= max) break;
      page++;
      await sleep(1100);
    }
    await sleep(500);
  }

  if (all.size === 0) {
    console.log("0");
    return { state, count: 0 };
  }

  const cap = (s, n) => (s ? String(s).slice(0, n).trim() || null : null);
  const rows = [];
  for (const b of all.values()) {
    const abstract = b.abstracts?.[0]?.abstract ?? null;
    rows.push({
      state,
      bill_number: cap(b.identifier, 60) ?? "—",
      title: cap(b.title, 500),
      summary: cap(abstract, 5000),
      status: statusFromBill(b),
      kratom_relevance: classify(b.title, abstract),
      last_action: cap(b.latest_action_description, 500),
      last_action_at: b.latest_action_date ?? null,
      source_url: b.openstates_url ?? null,
      active: true,
      last_synced_at: new Date().toISOString(),
    });
  }

  // Dedupe by (state, bill_number) — same bill can match multiple keywords,
  // and Postgres ON CONFLICT can't handle dupes within a single upsert batch.
  const dedupedMap = new Map();
  for (const r of rows) {
    const key = `${r.state}::${r.bill_number}`;
    const existing = dedupedMap.get(key);
    if (!existing || (r.summary?.length ?? 0) > (existing.summary?.length ?? 0)) {
      dedupedMap.set(key, r);
    }
  }
  const deduped = Array.from(dedupedMap.values());

  // Upsert by (state, bill_number) — bills update over time as they progress
  const { error } = await supabase
    .from("bills")
    .upsert(deduped, { onConflict: "state,bill_number" });

  if (error) {
    console.log(`DB ERROR — ${error.message}`);
    return { state, count: 0, error: error.message };
  }
  console.log(`${deduped.length} bill(s)`);
  return { state, count: deduped.length };
}

// ---------- main ----------
const onlyState = process.argv[2]?.toUpperCase();
const targets = onlyState
  ? STATES.includes(onlyState) ? [onlyState] : (() => { console.error(`Unknown state ${onlyState}`); process.exit(1); })()
  : STATES;

console.log(`\nSyncing kratom-related bills for ${targets.length} state(s) via OpenStates…\n`);
console.log(`Keywords: ${KEYWORDS.join(", ")}\n`);

const t0 = Date.now();
const summary = [];
for (const state of targets) {
  const r = await syncState(state);
  summary.push(r);
  await sleep(1500);
}

const total = summary.reduce((a, b) => a + (b.count || 0), 0);
const failed = summary.filter((s) => s.error);
const found = summary.filter((s) => s.count > 0);
const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\n----------------------------------------`);
console.log(`Done in ${elapsed} min — ${total} bills across ${found.length}/${targets.length} states`);
if (failed.length) console.log(`Failed: ${failed.map((f) => f.state).join(", ")}`);
process.exit(0);
