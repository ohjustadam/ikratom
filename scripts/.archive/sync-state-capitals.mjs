#!/usr/bin/env node
/**
 * Bulk sweep: AI-suggest officials for every US state capital and insert them.
 *
 * Uses Gemini free tier (15 RPM). With 51 capitals + 4s delay = ~5–8 minutes.
 * Skips capitals that already have officials in the DB (idempotent re-runs).
 *
 * Run with: node --env-file=.env.local scripts/sync-state-capitals.mjs
 *           node --env-file=.env.local scripts/sync-state-capitals.mjs OK   # single
 */

import { createClient } from "@supabase/supabase-js";

const STATE_CAPITALS = {
  AL: "Montgomery", AK: "Juneau", AZ: "Phoenix", AR: "Little Rock",
  CA: "Sacramento", CO: "Denver", CT: "Hartford", DE: "Dover",
  DC: "Washington", FL: "Tallahassee", GA: "Atlanta", HI: "Honolulu",
  ID: "Boise", IL: "Springfield", IN: "Indianapolis", IA: "Des Moines",
  KS: "Topeka", KY: "Frankfort", LA: "Baton Rouge", ME: "Augusta",
  MD: "Annapolis", MA: "Boston", MI: "Lansing", MN: "Saint Paul",
  MS: "Jackson", MO: "Jefferson City", MT: "Helena", NE: "Lincoln",
  NV: "Carson City", NH: "Concord", NJ: "Trenton", NM: "Santa Fe",
  NY: "Albany", NC: "Raleigh", ND: "Bismarck", OH: "Columbus",
  OK: "Oklahoma City", OR: "Salem", PA: "Harrisburg", RI: "Providence",
  SC: "Columbia", SD: "Pierre", TN: "Nashville", TX: "Austin",
  UT: "Salt Lake City", VT: "Montpelier", VA: "Richmond", WA: "Olympia",
  WV: "Charleston", WI: "Madison", WY: "Cheyenne",
};

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM = `You are a research assistant that finds current elected local government officials in US cities.

Use Google Search to find authoritative sources (the city's official .gov site). Do NOT guess. If a piece of info isn't on a verifiable source, leave it null.

Return ONLY a JSON object inside <result>...</result> tags:

<result>
{
  "officials": [
    {
      "full_name": "Jane Doe",
      "role": "mayor" | "city_council",
      "title": "Mayor" | "Council Member, District 4" | etc,
      "district": "4" | null,
      "email": "jane.doe@city.gov" | null,
      "phone": "555-555-5555" | null,
      "website": "https://..." | null,
      "party": "Democratic" | "Republican" | "Nonpartisan" | null,
      "source_note": "Sourced from cityname.gov/council, accessed YYYY-MM-DD"
    }
  ]
}
</result>

Rules:
- Include the mayor + ALL current city council members.
- If you cannot find verifiable current data, return an empty officials array.
- Phone numbers in 555-555-5555 format.
- Never fabricate emails. If only a contact form exists, put the URL in website and leave email null.
- Output ONLY the <result>...</result> block.`;

const apiKey = process.env.GEMINI_API_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!apiKey) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }
if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOfficials(city, state, attempt = 0) {
  const userPrompt = `Find the current Mayor and ALL City Council members for ${city}, ${state}. Search the official city government website (.gov or .us domains) first.`;

  const res = await fetch(`${GEMINI_API}?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: SYSTEM }] },
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  // Exponential backoff on 429 (rate limit) — up to 3 retries
  if (res.status === 429 && attempt < 3) {
    const delay = (attempt + 1) * 60_000; // 60s, 120s, 180s
    console.log(`\n    rate limited — waiting ${delay / 1000}s and retrying…`);
    await sleep(delay);
    return fetchOfficials(city, state, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error("no candidates");

  const text = (candidate.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("\n");

  const m = text.match(/<result>([\s\S]*?)<\/result>/);
  if (!m) throw new Error(`no <result> block: ${text.slice(0, 100)}`);

  const parsed = JSON.parse(m[1].trim());
  return parsed.officials ?? [];
}

async function syncCapital(state, city) {
  const locality = `${city}, ${state}`;
  process.stdout.write(`  ${state} (${city}): `);

  // Skip if already populated — case-insensitive match prevents double-adds
  // even when older runs may have used different locality casing.
  const { data: existingRows } = await supabase
    .from("legislators")
    .select("id")
    .ilike("locality", locality)
    .in("level", ["municipal", "county"]);

  if ((existingRows?.length ?? 0) > 0) {
    console.log(`skip (already ${existingRows.length} on file)`);
    return { state, count: 0, skipped: true };
  }

  let officials;
  try {
    officials = await fetchOfficials(city, state);
  } catch (e) {
    console.log(`FAILED — ${e.message}`);
    return { state, count: 0, error: e.message };
  }

  if (!Array.isArray(officials) || officials.length === 0) {
    console.log("0 (no verifiable data found)");
    return { state, count: 0 };
  }

  const validRoles = new Set([
    "mayor", "city_council", "county_executive",
    "county_commissioner", "school_board", "other_local",
  ]);

  const cap = (s, n) => (s ? String(s).slice(0, n).trim() || null : null);

  const rows = officials
    .filter((o) => o.full_name && validRoles.has(o.role))
    .map((o) => ({
      full_name: cap(o.full_name, 120),
      state,
      role: o.role,
      locality,
      title: cap(o.title, 120),
      district: cap(o.district, 30),
      email: cap(o.email, 254),
      phone: cap(o.phone, 30),
      website: cap(o.website, 500),
      party: cap(o.party, 60),
      level: "municipal",
      active: true,
    }));

  if (rows.length === 0) {
    console.log("0 (none passed validation)");
    return { state, count: 0 };
  }

  const { error } = await supabase.from("legislators").insert(rows);
  if (error) {
    console.log(`DB ERROR — ${error.message}`);
    return { state, count: 0, error: error.message };
  }

  console.log(`${rows.length} added`);
  return { state, count: rows.length };
}

// ---------- main ----------
const onlyState = process.argv[2]?.toUpperCase();
const targets = onlyState
  ? STATE_CAPITALS[onlyState]
    ? [[onlyState, STATE_CAPITALS[onlyState]]]
    : (() => { console.error(`No capital for ${onlyState}`); process.exit(1); })()
  : Object.entries(STATE_CAPITALS);

console.log(`\nSyncing ${targets.length} state capital(s) via Gemini…`);
console.log(`(Gemini free tier limits us to 15 req/min, so ~4s delay between calls)\n`);

const t0 = Date.now();
const summary = [];

for (const [state, city] of targets) {
  const r = await syncCapital(state, city);
  summary.push(r);
  // Rate-limit: 8 sec between requests (Gemini free tier with grounding is stricter than 15 RPM)
  await sleep(8000);
}

const total = summary.reduce((a, b) => a + (b.count || 0), 0);
const skipped = summary.filter((s) => s.skipped).length;
const failed = summary.filter((s) => s.error);
const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);

console.log("\n----------------------------------------");
console.log(`Done in ${elapsed} min — ${total} new officials across ${targets.length} capitals`);
console.log(`Skipped: ${skipped} (already on file)`);
if (failed.length) {
  console.log(`Failed: ${failed.map((f) => f.state).join(", ")}`);
}
process.exit(0);
