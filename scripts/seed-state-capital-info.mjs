/**
 * AI-assisted seeder for state_capital_info across all 51 states.
 *
 * Closes the last NY-only gap: the hand-curated capital playbook
 * (address, session dates, public-comment URLs, field-work notes
 * about parking + security + committee battlegrounds). With one row
 * (NY) curated by hand, briefings for the other 50 states render
 * with empty "Capital + access" sections. This seeder fills them.
 *
 * How it works:
 *   1. For each state without an existing state_capital_info row,
 *      call Gemini-grounded (Google Search) with a structured prompt
 *      asking for: capital_city, capital_address, legislature_url,
 *      session calendar URL, current session ID + dates, public-
 *      comment URL, hearing-schedule URL, visitor-info URL, staff
 *      directory URL, and a notes_md block.
 *   2. Validate the response (must have at least capital_city + one
 *      URL).
 *   3. Upsert with last_updated_by='ai-seeder' so admins can spot
 *      AI-drafted entries vs the hand-curated NY one.
 *
 * Idempotent: skips states that already have a row (NY won't be
 * overwritten). Use --refresh to re-seed AI rows (won't touch
 * non-ai-seeder entries).
 *
 * Cost: 50 Gemini grounded calls per full run, well under the
 * 1500/day free tier. Runs in ~5 minutes.
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-state-capital-info.mjs
 *   node --env-file=.env.local scripts/seed-state-capital-info.mjs --dry-run
 *   node --env-file=.env.local scripts/seed-state-capital-info.mjs --state TX
 *   node --env-file=.env.local scripts/seed-state-capital-info.mjs --refresh
 */

import { createClient } from "@supabase/supabase-js";
import { aiRouter } from "./lib/ai-router.mjs";

const args = process.argv.slice(2);
const arg = (n, fallback = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fallback; };
const flag = (n) => args.includes(n);

const DRY_RUN = flag("--dry-run");
const REFRESH = flag("--refresh");
const ONLY_STATE = arg("--state");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",
  FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",
  IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
  OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",
  SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",
  VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",
  WY:"Wyoming",
};

// =============================================================
// Per-state AI call. Routes through the shared aiRouter which rotates
// across Groq / Gemini / Cerebras / Mistral / Cloudflare / Ollama with
// cooldown tracking. Originally tried Gemini grounded search but the
// grounded quota is 50/day and easily exhausted; this falls back to
// any available provider and uses training-cutoff knowledge of state
// capitols (which is reliable — state capitol addresses don't churn
// like, say, legislator phone numbers).
//
// Trade-off: URLs may be a step out of date. The notes_md block is
// still high-value either way (committee names, session structure,
// security/parking patterns are stable for years).
// =============================================================
async function seedOne(state, stateName) {
  const systemPrompt = `You are filling a structured intel sheet for the state legislature of ${stateName} (${state}). The data will be used by kratom-policy advocates planning capital visits and public-comment submissions. Respond with VALID JSON only — no markdown, no commentary.`;

  const userPrompt = `Return a JSON object with EXACTLY these fields about the ${stateName} state legislature:

{
  "capital_city": "<city name, e.g. 'Austin'>",
  "capital_address": "<full street address of the State Capitol building>",
  "legislature_url": "<official legislature home page URL>",
  "session_url": "<URL of the legislative session calendar / schedule>",
  "current_session_id": "<session label, e.g. '2025-2026', '89th', or 'Regular Session 2026'>",
  "current_session_start": "<YYYY-MM-DD of session start, or null>",
  "current_session_end": "<YYYY-MM-DD of session end, or null>",
  "public_comment_url": "<URL where citizens submit written public comment or contact reps>",
  "hearing_schedule_url": "<URL listing committee hearing schedule>",
  "visitor_info_url": "<URL with visitor / tour info for the Capitol>",
  "staff_directory_url": "<URL with legislator + staff contact directory>",
  "notes_md": "<Markdown block of field-work tactical notes specific to ${stateName} — which committees handle kratom-relevant legislation (Health / Judiciary / Agriculture / etc., by chamber and historical naming), session quirks (biennial? hybrid sessions? session length?), how the public comment process actually works. Be specific, not generic. 4-8 bullet points.>"
}

Rules:
- Use real URLs from your knowledge. If unsure about an exact URL, set the field to null rather than guess.
- Dates must be ISO YYYY-MM-DD or null. Don't guess if current session dates aren't known.
- notes_md MUST be ${stateName}-specific. No generic "contact the legislator's office" filler. Name actual committee names.
- Return ONLY the JSON object. No code fences, no prose.`;

  // 2048 maxTokens leaves comfortable headroom for notes_md (~1.5k chars
  // typical) plus the 11 field-value pairs.
  const result = await aiRouter({
    systemPrompt,
    userPrompt,
    maxTokens: 2048,
    verbose: false,
  });
  if (!result?.parsed) throw new Error("empty response from router");
  return { parsed: result.parsed, provider: result.provider };
}

// =============================================================
// Validation — every state needs at least capital_city + 1 URL or
// the row is useless to the briefing.
// =============================================================
function isValid(parsed) {
  if (!parsed?.capital_city) return false;
  const urls = [
    parsed.legislature_url,
    parsed.session_url,
    parsed.public_comment_url,
    parsed.hearing_schedule_url,
    parsed.visitor_info_url,
    parsed.staff_directory_url,
  ].filter(Boolean);
  return urls.length >= 1;
}

// =============================================================
// Main loop
// =============================================================
const states = ONLY_STATE ? [ONLY_STATE.toUpperCase()] : Object.keys(STATE_NAMES);

console.log(`Seeding state_capital_info for ${states.length} state(s)${DRY_RUN ? " (DRY RUN)" : ""}…\n`);

// Pull existing rows so we skip already-curated ones (unless --refresh)
const { data: existing } = await sb
  .from("state_capital_info")
  .select("state, last_updated_source");
const existingByState = new Map();
for (const e of existing || []) existingByState.set(e.state, e.last_updated_source);

/**
 * AI providers sometimes emit the literal STRING "null" inside JSON
 * fields where they should emit a JSON null. The Postgres `date` type
 * rejects "null" as a value. Coerce here defensively.
 */
function coerceNullable(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "" || trimmed.toLowerCase() === "null" || trimmed === "N/A" || trimmed === "n/a") {
      return null;
    }
  }
  return v;
}

let ok = 0, fail = 0, skip = 0;
for (const state of states) {
  const stateName = STATE_NAMES[state];
  if (!stateName) { console.log(`  ${state}: unknown state, skip`); skip++; continue; }

  // Idempotency rules:
  // - Skip any existing row UNLESS we're in --refresh mode
  // - In --refresh mode, only overwrite AI-seeded rows (never the
  //   hand-curated ones like NY where last_updated_source='hand')
  const existingSource = existingByState.get(state);
  if (existingByState.has(state)) {
    if (!REFRESH) {
      console.log(`  ${state}: already curated (${existingSource ?? "hand"}), skip`);
      skip++;
      continue;
    }
    if (existingSource !== "ai-seeder") {
      console.log(`  ${state}: hand-curated, NEVER overwriting (skip)`);
      skip++;
      continue;
    }
  }

  process.stdout.write(`  ${state} (${stateName})… `);
  let parsed, provider;
  try {
    const r = await seedOne(state, stateName);
    parsed = r.parsed;
    provider = r.provider;
  } catch (e) {
    console.log(`FAIL: ${String(e.message ?? e).slice(0, 150)}`);
    fail++;
    continue;
  }
  if (!isValid(parsed)) {
    console.log(`✗ invalid output (missing capital_city or all URLs)`);
    fail++;
    continue;
  }

  if (DRY_RUN) {
    console.log(`✓ would write via ${provider}: capital=${parsed.capital_city}, urls=${[parsed.legislature_url, parsed.public_comment_url].filter(Boolean).length}, notes=${(parsed.notes_md ?? "").length} chars`);
    ok++;
    continue;
  }

  const row = {
    state,
    capital_city: coerceNullable(parsed.capital_city),
    capital_address: coerceNullable(parsed.capital_address),
    legislature_url: coerceNullable(parsed.legislature_url),
    session_url: coerceNullable(parsed.session_url),
    current_session_id: coerceNullable(parsed.current_session_id),
    current_session_start: coerceNullable(parsed.current_session_start),
    current_session_end: coerceNullable(parsed.current_session_end),
    public_comment_url: coerceNullable(parsed.public_comment_url),
    hearing_schedule_url: coerceNullable(parsed.hearing_schedule_url),
    visitor_info_url: coerceNullable(parsed.visitor_info_url),
    staff_directory_url: coerceNullable(parsed.staff_directory_url),
    notes_md: coerceNullable(parsed.notes_md),
    last_updated_source: "ai-seeder",
    last_updated_at: new Date().toISOString(),
  };
  const { error } = await sb
    .from("state_capital_info")
    .upsert(row, { onConflict: "state" });
  if (error) {
    console.log(`DB FAIL: ${error.message?.slice(0, 150)}`);
    fail++;
    continue;
  }
  console.log(`✓ ${provider} → capital=${parsed.capital_city}, ${(parsed.notes_md ?? "").length} chars notes`);
  ok++;

  // Polite delay between calls
  await new Promise(r => setTimeout(r, 1200));
}

console.log(`\nDone. ok=${ok} fail=${fail} skip=${skip}`);
