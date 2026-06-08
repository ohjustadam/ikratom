#!/usr/bin/env node
/**
 * extract-news-officials.mjs — make news-derived alerts actionable.
 *
 * The gap this closes: when classify-news-policy.mjs turns a kratom news
 * article into an action_required policy_alert (a city smoke-shop
 * crackdown, a county announcement, an AG action), the auto-campaign
 * trigger tries to target local officials — but pick_targets_for_alert
 * derived the city from the alert TITLE, and news headlines aren't
 * formatted "City, ST". So local targeting was skipped and the alert
 * landed un-actionable or stuck on the wrong state-level fallback.
 *
 * This script, per unprocessed news alert:
 *   1. Uses the free-tier AI router to extract the precise jurisdiction
 *      (city / county + state) and any officials named in the article.
 *   2. Writes policy_alerts.specific_locality so the (0164-patched)
 *      targeting function can find the locality without title-parsing.
 *   3. Seeds the FULL local official slate for that jurisdiction via
 *      Gemini Search grounding (mayor + every council member, or county
 *      execs/commissioners) — also growing our nationwide officials DB.
 *   4. Re-runs targeting on the alert's auto-campaign (retarget_auto_
 *      campaign RPC) so the campaign now targets ALL those local
 *      officials → the alert becomes one-click actionable against the
 *      right people.
 *   5. Stamps officials_extracted_at so we don't re-spend AI on it.
 *
 * Cost: $0. Gemini Flash + Groq/Cerebras are all free-tier.
 *
 * Run:
 *   node --env-file=.env.local scripts/extract-news-officials.mjs
 *   node --env-file=.env.local scripts/extract-news-officials.mjs --limit 25
 *   node --env-file=.env.local scripts/extract-news-officials.mjs --dry-run
 *   node --env-file=.env.local scripts/extract-news-officials.mjs --days 30
 */
import { createClient } from "@supabase/supabase-js";
import { aiRouter } from "./lib/ai-router.mjs";
import { seedLocalitySlate } from "./lib/officials-slate.mjs";
import { reconcileLocality } from "./lib/geo-resolver.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const LIMIT = parseInt(arg("--limit") ?? "40", 10);
const DAYS = parseInt(arg("--days") ?? "14", 10);
const PROVIDER = arg("--provider");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const STATE_RE = /^[A-Z]{2}$/;

const EXTRACT_SYSTEM = `You determine the GOVERNMENT JURISDICTION a kratom-policy news item concerns, and list any government officials it names. Return STRICT JSON only — no prose, no markdown fences.

Output shape:
{
  "scope": "city" | "county" | "state" | "federal" | "none",
  "locality_name": "Nassau County" | "Marshall" | null,   // city or county name WITHOUT the state; null if scope is state/federal/none
  "state_code": "NY" | null,                                // 2-letter; null if federal/none
  "named_officials": [ { "name": "Jane Doe", "role": "mayor|city_council|county_executive|county_commissioner|state_legislator|ag|other" } ]
}

Rules:
- scope=city when the action is by a city/town/village government (ordinance, council vote, mayor).
- scope=county when by a county government (commissioners, county exec, sheriff acting on county policy).
- scope=state for state legislature / state agency / state AG actions.
- scope=federal for FDA / DEA / Congress.
- scope=none if it's not a government-action story (e.g. a product recall by a company, a scientific study) — leave locality_name/state_code null.
- locality_name is the bare place name: "Nassau County", "Marshall", "Philadelphia" — NOT "Marshall, IL".
- For counties, include the word "County" in locality_name.
- named_officials: only government officials actually named in the text. Empty array if none.
- Output ONLY the JSON object.`;

async function extractJurisdiction(alert) {
  const user = `Headline: ${alert.title}\nState bucket: ${alert.locality}\nDetails: ${(alert.body ?? "").slice(0, 1200)}`;
  const { parsed, provider } = await aiRouter({
    systemPrompt: EXTRACT_SYSTEM,
    userPrompt: user,
    maxTokens: 500,
    providerOverride: PROVIDER,
    verbose: false,
  });
  return { parsed, provider };
}

const t0 = Date.now();
console.log(`Extract-news-officials${DRY ? " [DRY]" : ""} — last ${DAYS}d, limit ${LIMIT}`);

const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
const { data: alerts, error } = await sb
  .from("policy_alerts")
  .select("id, title, body, locality, kind, campaign_id, specific_locality, action_required")
  .eq("moderation_status", "approved")
  .eq("action_required", true)
  .is("officials_extracted_at", null)
  .gte("created_at", since)
  .order("created_at", { ascending: false })
  .limit(LIMIT);

if (error) { console.error("query failed:", error.message); process.exit(1); }
console.log(`  ${alerts.length} unprocessed action-required alert(s)`);

let seeded = 0, retargeted = 0, skippedScope = 0, failed = 0, processed = 0;

for (const a of alerts) {
  console.log(`\n=== ${a.id.slice(0, 8)} | ${a.locality} | ${(a.title ?? "").slice(0, 60)} ===`);

  // 1. Extract jurisdiction via AI
  let ex;
  try {
    ex = await extractJurisdiction(a);
  } catch (e) {
    console.log(`  ✗ extraction failed (will retry next run): ${e.message?.slice(0, 100)}`);
    failed++;
    continue; // don't stamp — let it retry
  }
  const j = ex.parsed ?? {};
  console.log(`  [${ex.provider}] scope=${j.scope} locality=${j.locality_name ?? "—"} state=${j.state_code ?? "—"} named=${(j.named_officials ?? []).length}`);

  const isLocal = (j.scope === "city" || j.scope === "county")
    && j.locality_name && typeof j.locality_name === "string"
    && j.state_code && STATE_RE.test(j.state_code);

  if (!isLocal) {
    // State / federal / none — nothing local to seed. Stamp & move on;
    // existing state/federal targeting tiers already handle these.
    if (!DRY) await sb.from("policy_alerts").update({ officials_extracted_at: new Date().toISOString() }).eq("id", a.id);
    skippedScope++;
    processed++;
    continue;
  }

  // Corroborate the AI's claimed state against the article text + the
  // per-state scrape bucket before we stamp a "City, ST" specific_locality or
  // seed a permanent officials slate. The gazetteer-backed resolver is
  // conservative: it never returns a state the article contradicts. If it
  // can't confirm the AI's state_code (corroborated===false), we SKIP this
  // alert entirely and leave it UNSTAMPED so a later run can retry — better an
  // undercount than seeding officials under the wrong state.
  const { locality: resolvedState, corroborated } = reconcileLocality({
    aiLocality: j.state_code,
    scopeState: a.locality,
    text: a.body,
    title: a.title,
  });
  if (!corroborated || !STATE_RE.test(resolvedState)) {
    console.log(`  ⏳ locality-guard: AI said state=${j.state_code} but the article doesn't corroborate it (resolver=${resolvedState}) — skipping seed, leaving unstamped for retry`);
    failed++;
    continue; // don't stamp officials_extracted_at — never seed a wrong-state slate
  }

  const locality = `${j.locality_name.trim()}, ${resolvedState}`;
  console.log(`  → local jurisdiction: ${locality}`);

  if (DRY) { processed++; continue; }

  // 2. Record the precise locality so targeting can find it
  await sb.from("policy_alerts").update({ specific_locality: locality }).eq("id", a.id);

  // 3. Seed the full local slate (skips cleanly if already covered)
  let seedRetryable = false; // true → leave unstamped so it retries
  if (GEMINI_KEY) {
    const slate = await seedLocalitySlate({ sb, state: resolvedState, locality, geminiKey: GEMINI_KEY });
    if (slate.status === "ok") {
      console.log(`  ✓ seeded ${slate.inserted} new official(s) (${slate.officialIds.length} total for locality)`);
      seeded++;
    } else if (slate.status === "skip") {
      console.log(`  ⏭  slate already present (${slate.officialIds.length} officials)`);
    } else {
      console.log(`  ⚠ slate fetch failed: ${slate.error?.slice(0, 120)}`);
      // Quota / rate-limit / transient network → retry next run (don't
      // stamp). Only "0 officials returned" is treated as terminal —
      // re-asking Gemini for a locality it can't find wastes quota.
      const err = (slate.error ?? "").toLowerCase();
      seedRetryable = /429|quota|rate|timeout|fetch failed|503|502|econn/.test(err);
    }
  } else {
    console.log("  ⚠ GEMINI_API_KEY not set — skipping slate seed (specific_locality still recorded)");
    seedRetryable = true; // no key this run; retry when configured
  }

  // 4. Retarget the alert's auto-campaign onto the local slate
  if (a.campaign_id) {
    const { data: rt, error: rtErr } = await sb.rpc("retarget_auto_campaign", { p_campaign_id: a.campaign_id });
    if (rtErr) {
      console.log(`  ⚠ retarget failed: ${rtErr.message?.slice(0, 100)}`);
    } else if (rt?.ok) {
      console.log(`  ↻ campaign retargeted: ${rt.old_count} → ${rt.new_count} (${rt.tier})`);
      retargeted++;
    } else {
      console.log(`  · retarget no-op: ${rt?.reason ?? rt?.tier ?? "unknown"}`);
    }
  } else {
    console.log("  · no campaign on this alert (not action-routed) — specific_locality + officials still seeded");
  }

  // 5. Stamp processed — UNLESS the slate seed hit a retryable error
  // (Gemini quota/rate-limit). specific_locality is already saved, so a
  // retry next run re-seeds + retargets without redoing wasted work.
  if (seedRetryable) {
    console.log("  ⏳ leaving unstamped — slate seed will retry next run (quota/transient)");
    failed++;
  } else {
    await sb.from("policy_alerts").update({ officials_extracted_at: new Date().toISOString() }).eq("id", a.id);
    processed++;
  }

  // Gentle pace — Gemini grounding is the slow part; be a good citizen
  await new Promise((r) => setTimeout(r, 1500));
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — processed ${processed}, seeded ${seeded}, retargeted ${retargeted}, non-local ${skippedScope}, failed ${failed}.`);

if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "extract_news_officials",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: failed > 0 && processed === 0 ? "error" : processed === 0 ? "empty" : "success",
      rows_updated: seeded,
      notes: `processed ${processed} · seeded ${seeded} · retargeted ${retargeted} · non-local ${skippedScope} · failed ${failed}`,
    });
  } catch { /* best-effort */ }
}
