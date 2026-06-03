/**
 * Run autoFulfillLocality against every pending local_rep_requests row.
 *
 * Usage: node --env-file=.env.local scripts/auto-fulfill-pending-local-reps.mjs
 *
 * Owner directive 2026-05-16: process pending local-rep coverage
 * requests without admin in the loop. This script is a one-off
 * orchestrator that calls the same lib used at request creation +
 * future cron. Re-runnable; idempotent.
 *
 * Because the lib is TS + uses @/ aliases, we duplicate the AI suggest
 * call + source verification inline here for the one-off run.
 */

import { createClient } from "@supabase/supabase-js";
import {
  assertGroundingBudget,
  GroundingQuotaError,
  recordGroundingCall,
} from "./lib/grounding-budget.mjs";
import { LEGISTAR_TENANTS } from "./lib/legistar-tenants.mjs";
import { fetchLegistarOfficials, webapiClientFor, resolveTenant } from "./lib/legistar-officials.mjs";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Grounded free-tier capacity refreshes intermittently through the day
// (successes observed at 02:14, 07:27, 16:05… between bursts of 429s),
// so a short backoff often lands a call that just got throttled. These
// are member-requested lookups — worth a couple of retries before we
// give up and leave the request pending.
const RETRY_BACKOFFS_MS = [15_000, 40_000];

const SYSTEM = `You are a research assistant that finds current elected local government officials in US cities and counties.

Use Google Search to find authoritative sources (the city's official .gov site, official county pages, state-level rosters). Do NOT guess. If a piece of info isn't on a verifiable source, leave it null.

For EACH official, you MUST provide source_url — a direct link to the page that names that person. If you can't supply a verifiable source_url for an official, OMIT that entry entirely.

When the source page mentions when the term ends ("term expires January 2028", "serving through 2027", "up for re-election November 2026"), capture term_end_date as YYYY-MM-DD (use 01-01 for year-only, or election month). Otherwise null.

Return ONLY JSON inside <result>...</result> tags:

<result>
{
  "officials": [
    {
      "full_name": "Jane Doe",
      "role": "mayor"|"city_council"|"county_executive"|"county_commissioner"|"school_board"|"other_local",
      "title": "Mayor" | "Council Member, District 4" | null,
      "district": "4" | null,
      "email": "jane.doe@city.gov" | null,
      "phone": "555-555-5555" | null,
      "website": "https://..." | null,
      "party": "Democratic"|"Republican"|"Nonpartisan"|null,
      "source_note": "Sourced from cityname.gov/council, YYYY-MM-DD",
      "term_end_date": "2028-01-01" | null,
      "source_url": "https://cityname.gov/council/jane-doe"
    }
  ],
  "sources": ["url1","url2"]
}
</result>

Rules:
- Include the mayor + ALL current city council members for cities.
- Include the county executive + ALL current county commissioners for counties.
- Skip school boards.
- Empty officials array if no verifiable data.
- Never fabricate emails. Contact-form URLs go in website.
- Output ONLY the <result>...</result> block.`;

async function suggest(city, state) {
  const isCounty = /county$/i.test(city);
  const userPrompt = isCounty
    ? `Find the current ${city} ${state} commissioners and county executive (or judge-executive). Search the official county government website first.`
    : `Find the current Mayor and ALL City Council members for ${city}, ${state}. Search the official city government website (.gov / .us) first.`;
  try {
    await assertGroundingBudget(sb);
  } catch (e) {
    if (e instanceof GroundingQuotaError) return { error: e.message, quotaExhausted: true };
    throw e;
  }
  // Single grounded attempt, retried on transient throttling (429/5xx).
  let r;
  for (let attempt = 0; ; attempt++) {
    const startedAt = Date.now();
    try {
      r = await fetch(`${GEMINI_API}?key=${process.env.GEMINI_API_KEY}`, {
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
    } catch (e) {
      const msg = `gemini fetch failed: ${e.message}`;
      await recordGroundingCall(sb, { caller: "auto-fulfill-pending-cli", status: "failure", error: msg, elapsedMs: Date.now() - startedAt, promptPreview: userPrompt });
      if (attempt < RETRY_BACKOFFS_MS.length) { console.log(`    ⏳ network error — backoff ${RETRY_BACKOFFS_MS[attempt] / 1000}s then retry`); await sleep(RETRY_BACKOFFS_MS[attempt]); continue; }
      return { error: msg, transient: true };
    }
    if (r.ok) break;
    const errBody = (await r.text()).slice(0, 200);
    const msg = `gemini ${r.status}: ${errBody}`;
    await recordGroundingCall(sb, { caller: "auto-fulfill-pending-cli", status: "failure", error: msg, elapsedMs: Date.now() - startedAt, promptPreview: userPrompt });
    const retryable = r.status === 429 || r.status >= 500;
    if (retryable && attempt < RETRY_BACKOFFS_MS.length) {
      console.log(`    ⏳ ${r.status} throttled — backoff ${RETRY_BACKOFFS_MS[attempt] / 1000}s then retry`);
      await sleep(RETRY_BACKOFFS_MS[attempt]);
      continue;
    }
    return { error: msg, transient: retryable };
  }
  const data = await r.json();
  const cand = data.candidates?.[0];
  if (!cand) {
    await recordGroundingCall(sb, { caller: "auto-fulfill-pending-cli", status: "failure", error: "no candidates", elapsedMs: Date.now() - startedAt, promptPreview: userPrompt });
    return { error: "no candidates" };
  }
  const finalText = (cand.content?.parts ?? []).map((p) => p.text ?? "").join("\n");
  const m = finalText.match(/<result>([\s\S]*?)<\/result>/);
  if (!m) {
    await recordGroundingCall(sb, { caller: "auto-fulfill-pending-cli", status: "failure", error: "no <result> block", elapsedMs: Date.now() - startedAt, promptPreview: userPrompt });
    return { error: `no <result> block. Got: ${finalText.slice(0, 200)}` };
  }
  try {
    const parsed = JSON.parse(m[1].trim());
    const grounding = cand.groundingMetadata?.groundingChunks ?? [];
    const groundingUrls = grounding.map((c) => c.web?.uri).filter(Boolean);
    await recordGroundingCall(sb, { caller: "auto-fulfill-pending-cli", status: "success", elapsedMs: Date.now() - startedAt, promptPreview: userPrompt, metadata: { officials_returned: (parsed.officials ?? []).length } });
    return {
      ok: true,
      officials: parsed.officials ?? [],
      sources: Array.from(new Set([...(parsed.sources ?? []), ...groundingUrls])),
    };
  } catch (e) {
    await recordGroundingCall(sb, { caller: "auto-fulfill-pending-cli", status: "failure", error: `json: ${e.message}`, elapsedMs: Date.now() - startedAt, promptPreview: userPrompt });
    return { error: `json: ${e.message}` };
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function verify(fullName, sourceUrl) {
  if (!sourceUrl) return { ok: false, reason: "no-url" };
  try {
    const r = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "iKratom Civic Verifier (research@ikratom.org)" },
    });
    if (!r.ok) return { ok: false, reason: `fetch ${r.status}` };
    const text = stripHtml(await r.text()).toLowerCase();
    if (text.includes(fullName.toLowerCase())) return { ok: true, snippet: text.slice(Math.max(0, text.indexOf(fullName.toLowerCase()) - 60), text.indexOf(fullName.toLowerCase()) + 120) };
    const last = fullName.split(/\s+/).pop()?.toLowerCase();
    if (last && last.length >= 4 && text.includes(last)) return { ok: true, snippet: `(last-name match: ${last})` };
    return { ok: false, reason: "name-not-found" };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

const { data: pending } = await sb
  .from("local_rep_requests")
  .select("id, state, locality, level")
  .eq("status", "pending");
console.log(`pending: ${pending?.length ?? 0}`);

const seen = new Set();
let totalInserted = 0;
let totalSkipped = 0;
// Stop the run only when the daily budget cap is truly hit, or when many
// localities fail in a row even after per-call retries (providers clearly
// down) — NOT on the first throttle. One bad locality shouldn't strand
// every other pending member request behind it.
let consecutiveFails = 0;
const FAIL_STREAK_STOP = 4;
for (const req of pending ?? []) {
  const key = `${req.state}|${req.locality}|${req.level}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`\n--- ${req.locality} (${req.level}) ---`);
  const city = req.locality.replace(/,\s*[A-Z]{2}$/, "");

  // FREE, authoritative, no grounding: if this locality runs on Legistar
  // and exposes its roster, seed from the clerk's own system and skip the
  // scarce grounded call entirely.
  const tenant = resolveTenant(LEGISTAR_TENANTS, req.state, req.locality);
  if (tenant) {
    const lg = await fetchLegistarOfficials({ client: webapiClientFor(tenant), bodyHint: tenant.body, level: req.level, subdomain: tenant.subdomain });
    if (lg.ok && lg.officials.length > 0) {
      const { data: existing } = await sb.from("legislators").select("full_name").eq("level", req.level).eq("locality", req.locality).eq("active", true);
      const have = new Set((existing ?? []).map((r) => r.full_name.toLowerCase()));
      const rows = lg.officials.filter((o) => !have.has(o.full_name.toLowerCase())).map((o) => ({
        state: req.state, role: o.role, district: o.district, full_name: o.full_name,
        party: o.party, email: o.email, phone: o.phone, website: o.website, title: o.title,
        level: req.level, locality: req.locality,
        body: req.level === "municipal" ? "city_council" : "county_commission",
        active: true, term_end_date: o.term_end_date,
        verified_sources_md: [`- Tier: **verified** (Legistar — official clerk system)`, `- Source: ${o.source_url}`, `- ${o.source_note}`].join("\n"),
        last_synced_at: new Date().toISOString(),
      }));
      if (rows.length > 0) {
        const { error } = await sb.from("legislators").insert(rows);
        if (error) console.log(`  ✗ Legistar insert: ${error.message}`); else totalInserted += rows.length;
      }
      await sb.from("local_rep_requests").update({ status: "fulfilled", resolved_at: new Date().toISOString() })
        .eq("state", req.state).eq("locality", req.locality).eq("level", req.level).eq("status", "pending");
      console.log(`  ✓ Legistar: ${lg.officials.length} on "${lg.body}" — fulfilled WITHOUT grounding (+${rows.length} new)`);
      consecutiveFails = 0;
      continue;
    }
    if (lg.error) console.log(`  · Legistar has no usable roster (${lg.error.slice(0, 60)}) → falling back to grounding`);
  }

  const sug = await suggest(city, req.state);
  if (sug.error) {
    console.log(`  ✗ suggest error: ${sug.error.slice(0, 100)}`);
    // Real per-day budget cap from our own guard → no point continuing.
    if (sug.quotaExhausted) {
      console.log("  ⚠ grounded daily budget cap reached — stopping, will resume tomorrow (UTC)");
      break;
    }
    // Otherwise it's a transient throttle that survived retries. Count it
    // toward a streak; only bail if the providers are clearly exhausted.
    consecutiveFails++;
    if (consecutiveFails >= FAIL_STREAK_STOP) {
      console.log(`  ⚠ ${consecutiveFails} localities failed in a row after retries — providers exhausted; stopping, will resume next run`);
      break;
    }
    continue;
  }
  consecutiveFails = 0; // a success resets the streak
  console.log(`  suggested ${sug.officials.length} officials`);

  const { data: existing } = await sb.from("legislators").select("full_name").eq("level", req.level).eq("locality", req.locality).eq("active", true);
  const existingNames = new Set((existing ?? []).map(r => r.full_name.toLowerCase()));

  const rows = [];
  for (const o of sug.officials) {
    const v = await verify(o.full_name, o.source_url);
    if (!v.ok) { console.log(`    ✗ ${o.full_name}: ${v.reason}`); totalSkipped++; continue; }
    if (existingNames.has(o.full_name.toLowerCase())) { console.log(`    = ${o.full_name}: already in DB`); continue; }
    rows.push({
      state: req.state,
      role: o.role || "other_local",
      district: o.district,
      full_name: o.full_name,
      party: o.party,
      email: o.email,
      phone: o.phone,
      website: o.website,
      title: o.title,
      level: req.level,
      locality: req.locality,
      body: req.level === "municipal" ? "city_council" : "county_commission",
      active: true,
      term_end_date: o.term_end_date,
      verified_sources_md: [
        o.source_url ? `- Source: ${o.source_url}` : null,
        `- Verifier snippet: "${v.snippet}"`,
        sug.sources.length ? `- AI-cited: ${sug.sources.join(", ")}` : null,
      ].filter(Boolean).join("\n"),
      last_synced_at: new Date().toISOString(),
    });
    console.log(`    ✓ ${o.full_name} → verified`);
  }
  if (rows.length > 0) {
    const { error } = await sb.from("legislators").insert(rows);
    if (error) { console.log(`  ✗ insert: ${error.message}`); continue; }
    console.log(`  ✓ inserted ${rows.length}`);
    totalInserted += rows.length;
  }
  // Mark all matching pending requests fulfilled
  await sb.from("local_rep_requests").update({ status: "fulfilled", resolved_at: new Date().toISOString() })
    .eq("state", req.state).eq("locality", req.locality).eq("level", req.level).eq("status", "pending");
}
console.log(`\n=== TOTAL: inserted ${totalInserted} · skipped ${totalSkipped} ===`);
