#!/usr/bin/env node
/**
 * iKratom — Dedicated substance / 7-OH classification pass.
 * State Mission Control rebuild, PR1 (see private/STATE_MISSION_CONTROL_PLAN.md).
 *
 * THE UNBLOCK: nothing about 7-OH works until per-bill substance data
 * exists and is accurate. The existing substance_targeting map (written
 * as a side effect of enrich-bill-journey.mjs) has weak 7-OH signal —
 * most seven_oh entries land "unaddressed"/"neutral" at confidence 0
 * because that script's prompt is about the bill's *journey*, not its
 * per-alkaloid targeting.
 *
 * This script is the focused fix:
 *   1. Pulls kratom-relevant state bills (anti/pro/neutral) that already
 *      have stored text — NO OpenStates fetch, so it's fast, idempotent,
 *      retryable, and never burns the 250/day OpenStates quota.
 *   2. Feeds the stored text (bill_text_versions → summary_long →
 *      summary → title/abstract, whichever is richest) to the free-tier
 *      AI router with a prompt that classifies all FIVE substance
 *      classes, with 7-OH as a first-class axis.
 *   3. Writes substance_targeting (5-key map, migration 0063 shape),
 *      derives targets_natural_leaf / targets_synthetic_only from it
 *      (single source of truth), and stamps substance_targeting_source =
 *      'ai-substance-pass-v1' (migration 0170) for idempotency +
 *      reconciliation provenance.
 *
 * Idempotent: by default only processes bills this pass doesn't already
 * own (source != 'ai-substance-pass-v1'). --refresh re-does everything.
 *
 * Run with:
 *   npm run classify:substance                       # all unowned, batched
 *   npm run classify:substance -- --limit 10
 *   npm run classify:substance -- --refresh          # re-classify all
 *   npm run classify:substance -- --dry-run          # print, write nothing
 *   npm run classify:substance -- --state CA,LA      # specific states
 *   npm run classify:substance -- --bill <uuid>
 *   npm run classify:substance -- --relevance anti,pro,neutral
 *
 * Requires Supabase service key + at least one AI provider key
 * (GROQ/GEMINI/CEREBRAS/MISTRAL/CLOUDFLARE) or local Ollama.
 */

import { createClient } from "@supabase/supabase-js";
import { aiRouter } from "./lib/ai-router.mjs";
import { runWithLogging } from "./lib/scraper-run.mjs";

const SOURCE_TAG = "ai-substance-pass-v1";
const SCRAPER_SOURCE = "classify_bill_substance";
const SUB_KEYS = ["natural_leaf", "mitragynine", "seven_oh", "pseudoindoxyl", "synthetic"];
const STANCES = ["bans", "restricts", "schedules", "preserves", "neutral", "unaddressed"];
// Stances that mean "this substance class is being curtailed" — used to
// derive the binary targets_* columns.
const TARGETED = new Set(["bans", "restricts", "schedules"]);

const args = process.argv.slice(2);
function arg(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; }
const LIMIT = parseInt(arg("--limit") ?? "50");
const REFRESH = args.includes("--refresh");
const DRY_RUN = args.includes("--dry-run");
const SPECIFIC_BILL = arg("--bill");
const STATES = (arg("--state") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const RELEVANCE = (arg("--relevance") ?? "anti,pro,neutral").split(",").map((s) => s.trim()).filter(Boolean);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const SYSTEM = `You are a kratom-policy analyst reading the actual statutory text of a U.S. state bill. Your ONE job: determine, for each of five substance classes, exactly what this bill does to it.

Bills routinely look anti-kratom in their title but carve out plain leaf in the operative text, or quietly schedule 7-hydroxymitragynine while leaving leaf legal. Read the operative sections, not the headline. When the bill has multiple versions in the text, classify THE LATEST version.

The five substance classes (classify ALL five, every time):
- natural_leaf — whole-leaf kratom / traditional preparations (heat, water/ethanol extraction). The plant itself.
- mitragynine — mitragynine (MGM), the dominant natural alkaloid (~1-2% of leaf), including purified MGM.
- seven_oh — 7-hydroxymitragynine (7-OH). Natural trace alkaloid (~0.04% in fresh leaf) BUT the policy fight is over semi-synthetic / concentrated / "enriched" 7-OH above natural levels. Treat any bill language about "7-hydroxymitragynine", "7-OH", "enriched", "concentrated", "semi-synthetic", or "synthetically derived" alkaloids as targeting seven_oh.
- pseudoindoxyl — mitragynine pseudoindoxyl ("pseudo"), an oxidation metabolite, often produced semi-synthetically.
- synthetic — ANY lab-synthesized / biosynthesized kratom alkaloid (recombinant, fermentation), regardless of which alkaloid.

For EACH class return an object:
{
  "stance": "bans" | "restricts" | "schedules" | "preserves" | "neutral" | "unaddressed",
  "scope": "statewide" | "retail_only" | "specific_retailer" | "research_exempt" | null,
  "schedule": "I" | "II" | "III" | "IV" | "V" | null,
  "confidence": 0.00-1.00,
  "notes": "one short clause citing the mechanism"
}

Stance meanings:
- "bans" — outright prohibition of that class statewide.
- "restricts" — partial limits (age gate, labeling, retail-license limits, potency cap, registration).
- "schedules" — added to the controlled-substance schedule (also set "schedule").
- "preserves" — bill EXPLICITLY protects / carves out that class (KCPA-style consumer protection, or an explicit exemption).
- "neutral" — the bill mentions the class but neither restricts nor protects it (e.g. defines it, or a study-only reference).
- "unaddressed" — the bill simply does not touch that class. Use confidence 0 here.

CRITICAL distinctions:
- A KCPA-style bill typically: preserves natural_leaf + mitragynine, and bans/restricts/schedules seven_oh + synthetic. That is the common "synthetic-only" shape — DO NOT mark natural_leaf as banned for these.
- A full prohibition (e.g. scheduling "Mitragyna speciosa and its alkaloids" as a controlled substance) bans natural_leaf AND mitragynine AND seven_oh — all of them.
- If the text is too thin to tell, lower confidence; do not invent specifics.

Return ONLY a JSON object of this exact shape (no markdown, no prose):
{"natural_leaf":{...},"mitragynine":{...},"seven_oh":{...},"pseudoindoxyl":{...},"synthetic":{...},"overall_confidence":0.00-1.00}`;

// Build the richest available text blob from already-stored fields.
// Order: full version text (latest first, capped) → summary_long →
// summary → title+abstract. Returns { text, kind } or null.
function buildSourceText(bill) {
  const cap = 14_000;
  const versions = Array.isArray(bill.bill_text_versions) ? bill.bill_text_versions : [];
  // Prefer the LATEST version with substantive text.
  const withText = versions.filter((v) => v && typeof v.text === "string" && v.text.trim().length > 400);
  if (withText.length) {
    const latest = withText[withText.length - 1];
    return { text: latest.text.slice(0, cap), kind: `version:${latest.label ?? "latest"}` };
  }
  if (typeof bill.summary_long === "string" && bill.summary_long.trim().length > 120) {
    return { text: bill.summary_long.slice(0, cap), kind: "summary_long" };
  }
  if (typeof bill.summary === "string" && bill.summary.trim().length > 120) {
    return { text: bill.summary.slice(0, cap), kind: "summary" };
  }
  const fallback = [bill.title, bill.summary_ai].filter((s) => typeof s === "string" && s.trim()).join("\n\n");
  if (fallback.length > 80) return { text: fallback.slice(0, cap), kind: "title+summary_ai" };
  return null;
}

// Validate + normalize the AI output into the strict 5-key map.
function cleanTargeting(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!SUB_KEYS.every((k) => raw[k] && typeof raw[k] === "object")) return null;
  const clean = {};
  for (const k of SUB_KEYS) {
    const v = raw[k];
    clean[k] = {
      stance: STANCES.includes(v.stance) ? v.stance : "unaddressed",
      scope: typeof v.scope === "string" ? v.scope : null,
      schedule: typeof v.schedule === "string" ? v.schedule : null,
      confidence: Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, Number(v.confidence))) : 0.5,
      notes: typeof v.notes === "string" ? v.notes.slice(0, 240) : "",
    };
  }
  return clean;
}

// Derive the binary columns from the per-substance map (single source of
// truth). Leaf is targeted if natural_leaf OR mitragynine is curtailed.
// synthetic_only = a synthetic/7-OH/pseudo class is curtailed AND leaf is
// explicitly NOT (so the bill protects natural leaf while hitting synthetics).
function deriveBinaries(t) {
  const leafTargeted = TARGETED.has(t.natural_leaf.stance) || TARGETED.has(t.mitragynine.stance);
  const synClassTargeted =
    TARGETED.has(t.seven_oh.stance) || TARGETED.has(t.synthetic.stance) || TARGETED.has(t.pseudoindoxyl.stance);
  return {
    targets_natural_leaf: leafTargeted,
    targets_synthetic_only: synClassTargeted && !leafTargeted,
  };
}

function fmt(t) {
  return SUB_KEYS.map((k) => {
    const s = t[k].stance;
    if (s === "unaddressed") return null;
    return `${k.replace("_", "")}=${s}${t[k].schedule ? `(${t[k].schedule})` : ""}`;
  }).filter(Boolean).join(" ") || "(all unaddressed)";
}

// ---------- query target bills ----------
function baseQuery(includeSource) {
  let cols =
    "id, state, bill_number, title, summary, summary_ai, summary_long, " +
    "bill_text_versions, kratom_relevance, substance_targeting, " +
    "targets_natural_leaf, targets_synthetic_only";
  if (includeSource) cols += ", substance_targeting_source";
  let q = supabase
    .from("bills")
    .select(cols)
    .eq("scope", "state")
    .eq("active", true);
  if (SPECIFIC_BILL) return q.eq("id", SPECIFIC_BILL);
  q = q.in("kratom_relevance", RELEVANCE);
  if (STATES.length) q = q.in("state", STATES);
  return q;
}

async function fetchTargets() {
  // Try with the provenance column (post-0170). If it doesn't exist yet
  // (migration not pushed — dry-run before db:push), fall back without it.
  let withSource = true;
  let res = await baseQuery(true).limit(2000);
  if (res.error && /substance_targeting_source/.test(res.error.message || "")) {
    withSource = false;
    res = await baseQuery(false).limit(2000);
  }
  if (res.error) throw new Error(res.error.message);
  let bills = res.data ?? [];
  // Idempotency: skip rows this pass already owns, unless --refresh or a
  // single bill / state filter was explicitly requested.
  if (!REFRESH && !SPECIFIC_BILL && withSource) {
    bills = bills.filter((b) => b.substance_targeting_source !== SOURCE_TAG);
  }
  return { bills, withSource };
}

// ---------- main ----------
await runWithLogging({ source: SCRAPER_SOURCE, supabase }, async () => {
  console.log(`\nClassifying bill substance targeting${DRY_RUN ? " (DRY RUN — no writes)" : ""}…`);
  console.log(`  relevance=${RELEVANCE.join("/")}${STATES.length ? ` states=${STATES.join(",")}` : ""}${REFRESH ? " refresh" : ""} limit=${LIMIT}\n`);

  const { bills: all } = await fetchTargets();
  // Only keep bills we can actually read text from.
  const ready = [];
  let noText = 0;
  for (const b of all) {
    const src = buildSourceText(b);
    if (src) ready.push({ bill: b, src });
    else noText++;
  }
  const batch = ready.slice(0, LIMIT);
  console.log(`Candidates: ${all.length} | have text: ${ready.length} | no text: ${noText} | processing: ${batch.length}\n`);
  if (batch.length === 0) {
    console.log("Nothing to do.");
    return { rowsAdded: 0, rowsUpdated: 0, notes: `no candidates (relevance=${RELEVANCE.join("/")})` };
  }

  let updated = 0, failed = 0, leaf = 0, synOnly = 0, sevenOh = 0;
  const providerCounts = {};

  for (let i = 0; i < batch.length; i++) {
    const { bill, src } = batch[i];
    const tag = `${bill.state} ${bill.bill_number}`.padEnd(16);
    process.stdout.write(`  [${i + 1}/${batch.length}] ${tag} (${src.kind}, ${(src.text.length / 1000).toFixed(1)}K) `);

    try {
      const userPrompt =
        `Bill: ${bill.state} ${bill.bill_number}\n` +
        `Title: ${bill.title ?? "(none)"}\n` +
        `Current AI relevance: ${bill.kratom_relevance ?? "?"}\n\n` +
        `--- BILL TEXT ---\n${src.text}`;

      const { parsed, provider } = await aiRouter({
        systemPrompt: SYSTEM,
        userPrompt,
        maxTokens: 1400,
        verbose: false,
      });
      providerCounts[provider] = (providerCounts[provider] ?? 0) + 1;

      const targeting = cleanTargeting(parsed);
      if (!targeting) { console.log("✗ bad JSON shape"); failed++; continue; }

      const bin = deriveBinaries(targeting);
      if (bin.targets_natural_leaf) leaf++;
      if (bin.targets_synthetic_only) synOnly++;
      if (TARGETED.has(targeting.seven_oh.stance)) sevenOh++;

      if (DRY_RUN) {
        const flags = [bin.targets_natural_leaf ? "🚨leaf" : "✓no-leaf", bin.targets_synthetic_only ? "syn-only" : ""].filter(Boolean).join(" ");
        console.log(`[${provider}] ${flags} · ${fmt(targeting)}`);
        updated++;
        continue;
      }

      const update = {
        substance_targeting: targeting,
        substance_targeting_analyzed_at: new Date().toISOString(),
        substance_targeting_source: SOURCE_TAG,
        targets_natural_leaf: bin.targets_natural_leaf,
        targets_synthetic_only: bin.targets_synthetic_only,
      };
      const { error: upErr } = await supabase.from("bills").update(update).eq("id", bill.id);
      if (upErr) { console.log(`✗ DB ${upErr.message}`); failed++; continue; }

      const flags = [bin.targets_natural_leaf ? "🚨leaf" : "✓no-leaf", bin.targets_synthetic_only ? "syn-only" : ""].filter(Boolean).join(" ");
      console.log(`✓ [${provider}] ${flags} · ${fmt(targeting)}`);
      updated++;
    } catch (e) {
      // Self-heal: skip the bad item, keep going. The run still logs.
      console.log(`✗ ${(e.message ?? e).toString().slice(0, 140)}`);
      failed++;
    }
  }

  console.log(`\nDone — ${updated} ${DRY_RUN ? "classified" : "updated"}, ${failed} failed.`);
  console.log(`  natural-leaf targeted: ${leaf} | synthetic-only (leaf-protective): ${synOnly} | 7-OH targeted: ${sevenOh}`);
  console.log(`  providers: ${Object.entries(providerCounts).map(([p, n]) => `${p}=${n}`).join(" ") || "(none)"}`);
  if (ready.length > batch.length) console.log(`  NOTE: ${ready.length - batch.length} more candidates remain — re-run to continue (capped at --limit ${LIMIT}).`);

  return {
    rowsAdded: 0,
    rowsUpdated: DRY_RUN ? 0 : updated,
    notes: `${DRY_RUN ? "dry-run " : ""}${updated} classified, ${failed} failed, ${leaf} leaf, ${synOnly} syn-only, ${sevenOh} 7-OH; ${ready.length - batch.length} remaining`,
  };
});
