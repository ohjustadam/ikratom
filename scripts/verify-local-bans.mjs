#!/usr/bin/env node
/**
 * Two-source verification engine for LOCAL kratom bans — the failsafe behind
 * migration 0190. "Don't list a ban as true until a 2nd, as-close-to-primary-
 * as-possible source confirms it."
 *
 * For each HELD local ban (verification_status single_source/unverified) it
 * runs a grounded Gemini search (free tier, Google Search tool — same path as
 * officials-slate.mjs) and applies the gate:
 *   - 'banned' AND >=2 sources incl. >=1 authoritative (county/city minutes,
 *     municipal code, local paper, AKA) -> verification_status='confirmed',
 *     active=true  (re-published as a real, corroborated ban).
 *   - 'repealed' (dated)                 -> 'repealed', active=false.
 *   - otherwise                          -> stays 'single_source', active=false.
 * Also reconciles the locality's state via the gazetteer resolver so a
 * mislabeled town/county/state can't ride along.
 *
 * Self-healing: per-item try/catch, Gemini key rotation, daily grounding-budget
 * guard (stops cleanly when exhausted), scraper_runs telemetry. Cron-registered.
 *
 *   node --env-file=.env.local scripts/verify-local-bans.mjs --limit 25
 *   node --env-file=.env.local scripts/verify-local-bans.mjs --refresh   # re-check confirmed/repealed too
 *   node --env-file=.env.local scripts/verify-local-bans.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { assertGroundingBudget, GroundingQuotaError, recordGroundingCall, isRetryableGroundingError } from "./lib/grounding-budget.mjs";
import { geminiKeyCount, pickGeminiKey, markGeminiKeyCooldown } from "./lib/gemini-keys.mjs";
import { reconcileLocality } from "./lib/geo-resolver.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const LIMIT = parseInt(arg("--limit") ?? "25");
const REFRESH = args.includes("--refresh");
const DRY = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Source tiering: distrust SEO/vendor aggregators; trust .gov/.us, code
// portals, named local newspapers, and the AKA.
const AGGREGATORS = ["kratomlords", "kratomscience", "legalclarity", "kratomgeek", "kratomaton", "kratomcountry", "authentickratom", "superspeciosa", "goldenmonk"];
const AUTH_HINTS = [".gov", ".us/", "municode", "amlegal", "codepublishing", "ecode360", "djournal", "cdispatch", "americankratom", "supertalk", "wcbi", "wtva", "wlox"];
function tierOf(url) {
  if (!url) return "aggregator";
  const u = url.toLowerCase();
  if (AGGREGATORS.some((h) => u.includes(h))) return "aggregator";
  if (AUTH_HINTS.some((h) => u.includes(h))) return "authoritative";
  return "semi";
}

const SYSTEM = `You are a kratom-policy fact-checker. Use Google Search to determine the CURRENT legal status of natural-leaf kratom in ONE specific US locality.
PREFER primary sources: county board of supervisors minutes/agendas, city council minutes, municipal code portals (Municode / American Legal Publishing / Code Publishing), local newspapers, and the American Kratom Association. DISTRUST SEO/vendor/aggregator pages — they copy each other and miss repeals.
HUNT for repeals: search "rescind", "repeal", "overturn", "lift ban", "sunset" for 2019-2026.
Return ONLY a <result>...</result> block wrapping strict JSON:
{"status":"banned"|"repealed"|"never_banned"|"uncertain","enacted_date":"YYYY-MM-DD or null","repeal_date":"YYYY-MM-DD or null","sources":[{"url":"https://...","what_it_shows":"one line"}]}
Only say "banned" if a CURRENT prohibition is confirmed by an authoritative source; "repealed" only with a dated authoritative source; otherwise "uncertain". Provide >=2 distinct source URLs whenever possible.`;

async function grounded(userPrompt, caller) {
  await assertGroundingBudget(sb);
  const keyCount = Math.max(1, geminiKeyCount());
  let lastErr = null;
  for (let attempt = 0; attempt < keyCount; attempt++) {
    const key = pickGeminiKey() || process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: SYSTEM }] },
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e) {
      await recordGroundingCall(sb, { caller, status: "failure", error: `fetch failed: ${e.message}`, elapsedMs: Date.now() - t0, promptPreview: userPrompt });
      lastErr = e; continue;
    }
    if (!res.ok) {
      const eb = (await res.text()).slice(0, 300);
      await recordGroundingCall(sb, { caller, status: "failure", error: `Gemini ${res.status}: ${eb}`, elapsedMs: Date.now() - t0, promptPreview: userPrompt });
      if (res.status === 429) markGeminiKeyCooldown(key);
      lastErr = new Error(`Gemini ${res.status}: ${eb}`);
      if (res.status === 429 || res.status >= 500) continue;
      throw lastErr;
    }
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("\n");
    const m = text.match(/<result>([\s\S]*?)<\/result>/);
    if (!m) {
      await recordGroundingCall(sb, { caller, status: "failure", error: "no <result> block", elapsedMs: Date.now() - t0, promptPreview: userPrompt });
      throw new Error("model returned no <result> block");
    }
    await recordGroundingCall(sb, { caller, status: "success", elapsedMs: Date.now() - t0, promptPreview: userPrompt });
    return JSON.parse(m[1].trim());
  }
  throw lastErr ?? new Error("Gemini grounded call failed (all keys exhausted)");
}

// ---------- main ----------
const t0 = Date.now();
let q = sb.from("bills")
  .select("id, bill_number, state, locality, scope, verification_status")
  .in("scope", ["county", "municipal"]);
q = REFRESH
  ? q.not("verification_status", "is", null)
  : q.in("verification_status", ["single_source", "unverified"]);
const { data: rows, error } = await q.limit(LIMIT);
if (error) { console.error(error.message); process.exit(1); }
console.log(`verify-local-bans: ${rows?.length ?? 0} held local ban(s)${DRY ? " [DRY]" : ""}\n`);

let confirmed = 0, repealed = 0, held = 0, errored = 0;
const NOW = () => new Date().toISOString();

for (const b of (rows ?? [])) {
  const tag = `[${b.state}] ${b.locality}`;
  try {
    const r = await grounded(
      `Locality: ${b.locality}\nIs there a CURRENT local ordinance banning natural-leaf kratom there, or was a ban repealed? Give the dates and 2+ sources.`,
      "verify_local_bans",
    );
    const sources = (Array.isArray(r.sources) ? r.sources : [])
      .filter((s) => s && s.url)
      .map((s) => ({ url: s.url, tier: tierOf(s.url), what: (s.what_it_shows ?? "").slice(0, 200), checked_at: NOW() }));
    const authoritative = sources.filter((s) => s.tier !== "aggregator");

    // Gazetteer sanity: don't let a mislabeled state ride along.
    const loc = reconcileLocality({ aiLocality: b.state, scopeState: b.state, text: b.locality ?? "" });
    const stateOk = loc.corroborated || loc.locality === b.state || loc.locality === "ALL";

    let vs, active, status, note;
    if (r.status === "repealed") {
      vs = "repealed"; active = false;
      note = `Repealed${r.repeal_date ? ` (${r.repeal_date})` : ""}; confirmed via grounded search.`;
    } else if (r.status === "banned" && sources.length >= 2 && authoritative.length >= 1 && stateOk) {
      vs = "confirmed"; active = true; status = "enacted";
      note = `Confirmed current ban: ${authoritative.length} authoritative + ${sources.length} total source(s)${r.enacted_date ? `, enacted ${r.enacted_date}` : ""}.`;
    } else {
      vs = "single_source"; active = false;
      note = `Not corroborated (grounded status=${r.status}, ${authoritative.length} authoritative / ${sources.length} sources${stateOk ? "" : ", state mismatch"}). Held.`;
    }

    const upd = { verification_status: vs, active, verified_at: NOW(), verification_note: note, verification_sources: sources };
    if (status) upd.status = status;
    if (!DRY) await sb.from("bills").update(upd).eq("id", b.id);

    if (vs === "confirmed") { confirmed++; console.log(`  ✓ CONFIRM ${tag} (${authoritative.length}/${sources.length} src)`); }
    else if (vs === "repealed") { repealed++; console.log(`  ⌫ REPEAL  ${tag}`); }
    else { held++; console.log(`  · HOLD    ${tag} (${r.status})`); }

    await new Promise((res) => setTimeout(res, 1200));
  } catch (e) {
    errored++;
    console.log(`  ✗ ${tag}: ${(e.message ?? "").slice(0, 80)}`);
    if (e instanceof GroundingQuotaError) { console.log("  ⛔ grounding budget exhausted — stopping for today"); break; }
    if (!isRetryableGroundingError(e.message ?? "")) continue;
  }
}

console.log(`\nDone. confirmed=${confirmed} repealed=${repealed} held=${held} errored=${errored}`);
try {
  await sb.from("scraper_runs").insert({
    source: "verify_local_bans",
    started_at: new Date(t0).toISOString(),
    finished_at: NOW(),
    status: (confirmed + repealed + held) === 0 && errored > 0 ? "fail" : "success",
    rows_updated: confirmed + repealed + held,
    notes: `confirmed=${confirmed} repealed=${repealed} held=${held} errored=${errored}`,
  });
} catch { /* best-effort */ }
process.exit(0);
