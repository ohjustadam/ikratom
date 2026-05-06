#!/usr/bin/env node
/**
 * iKratom — Deep bill analysis via PDF + local Ollama.
 *
 * The shallow `enrich-bills` pass reads only title + abstract. That's not
 * enough to tell whether a bill restricts plain leaf kratom or only
 * synthetic / 7-OH-enhanced products — they're framed identically in
 * headlines (NH SB 557 was classified anti-kratom on first pass; reading
 * the actual text shows it carves out plain leaf and only restricts
 * liquor-license retail of synthetics).
 *
 * This script:
 *   1. Pulls bills missing deep_analyzed_at
 *   2. For each: fetches the latest version PDF from OpenStates
 *   3. Extracts text via pdf-parse
 *   4. Feeds the text + bill metadata to Ollama with a system prompt
 *      that asks specifically about plain-leaf vs synthetic targeting
 *   5. Persists targets_natural_leaf + targets_synthetic_only +
 *      a refined summary_ai + advocacy_callout
 *
 * Run with:
 *   npm run enrich:bills:deep                                 # all unanalyzed
 *   npm run enrich:bills:deep -- --limit 5
 *   npm run enrich:bills:deep -- --refresh                    # re-analyze
 *   npm run enrich:bills:deep -- --bill <uuid>                # single bill
 *   npm run enrich:bills:deep -- --model llama3.3:70b         # bigger model
 *
 * Requires Ollama running locally + OPENSTATES_API_KEY (free tier).
 */

import { createClient } from "@supabase/supabase-js";
import pdf from "pdf-parse";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const args = process.argv.slice(2);
function arg(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; }
const MODEL = arg("--model") || "llama3.1:8b";
const LIMIT = parseInt(arg("--limit") ?? "20");
const REFRESH = args.includes("--refresh");
const SPECIFIC_BILL = arg("--bill");

const apiKey = process.env.OPENSTATES_API_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!apiKey) { console.error("Missing OPENSTATES_API_KEY"); process.exit(1); }
if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const SYSTEM = `You are a kratom-policy analyst reading the actual statutory text of a U.S. state bill.

Given the full text of one bill, you must answer four specific questions and return strictly-shaped JSON. Read the text carefully — bills often look anti-kratom in their title but carve out plain leaf in the operative sections (e.g. NH SB 557 only restricts liquor-license retailers from selling SYNTHETIC kratom while explicitly allowing natural leaf).

Return JSON with these EXACT fields:

1. summary_ai — exactly 2 short sentences. What does this bill DO operationally? Cite the specific mechanism (Schedule II classification, retail license restriction, age limit, lab-testing requirement, etc.).

2. advocacy_callout — exactly 1 sentence. What should kratom advocates DO about this bill? Examples:
   - "Advocates should oppose — would criminalize all kratom possession statewide."
   - "Advocates can support — bans synthetic 7-OH but explicitly preserves natural leaf access."
   - "Advocates should engage — bill is procedural; comment now to shape the framework."

3. targets_natural_leaf — boolean. TRUE if the bill restricts, bans, criminalizes, or schedules ANY product that includes natural kratom leaf or traditionally-extracted natural alkaloids (mitragynine without elevated 7-OH). FALSE if the bill explicitly carves out natural leaf and only targets:
   - Synthetic / semi-synthetic alkaloids
   - Chemically-altered alkaloids
   - 7-OH-enhanced or purified concentrates
   - Specific isomers not present in natural leaf

4. targets_synthetic_only — boolean. TRUE if the bill ONLY targets synthetics / 7-OH / chemically-altered products and explicitly preserves natural leaf. FALSE otherwise.

5. stance — exactly one string: "pro" | "anti" | "neutral"
   - "pro" — actively protects natural leaf access (KCPA-style consumer protections)
   - "anti" — restricts or bans natural leaf (targets_natural_leaf=true)
   - "neutral" — only restricts synthetics, or is procedural / study-only

6. confidence — 0.00 to 1.00 indicating certainty in the targets_natural_leaf classification

Return ONLY the JSON object. Example for a 7-OH-only bill that protects natural leaf:
{"summary_ai":"This bill restricts NH liquor-license retailers from selling kratom products that have been chemically altered, synthesized, or have elevated 7-OH levels not found in natural leaf. Plain leaf and traditional extracts are explicitly allowed.","advocacy_callout":"Advocates can support — narrowly restricts synthetic 7-OH at liquor stores while preserving natural leaf access everywhere else.","targets_natural_leaf":false,"targets_synthetic_only":true,"stance":"neutral","confidence":0.92}`;

async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const models = (data.models ?? []).map((m) => m.name);
    if (!models.some((m) => m === MODEL || m.startsWith(MODEL.split(":")[0]))) {
      console.error(`✗ Model "${MODEL}" not found. Available: ${models.join(", ")}`);
      console.error(`  Pull it: ollama pull ${MODEL}`);
      return false;
    }
    return true;
  } catch {
    console.error(`✗ Can't reach Ollama at ${OLLAMA_URL}.`);
    return false;
  }
}

async function fetchBillVersionPdf(state, billNumber) {
  const url = new URL("https://v3.openstates.org/bills");
  url.searchParams.set("jurisdiction", state.toLowerCase());
  url.searchParams.set("q", billNumber);
  url.searchParams.append("include", "versions");
  url.searchParams.set("per_page", "5");
  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const norm = (s) => s.replace(/\s+/g, "").toUpperCase();
  const want = norm(billNumber);
  const match = data.results?.find((b) => norm(b.identifier) === want);
  if (!match || !match.versions) return null;

  // Pick the LATEST PDF version (last in list)
  for (let i = match.versions.length - 1; i >= 0; i--) {
    const v = match.versions[i];
    const pdfLink = v.links?.find((l) => l.media_type === "application/pdf");
    if (pdfLink) return { url: pdfLink.url, note: v.note ?? "(latest)", date: v.date };
  }
  return null;
}

async function downloadPdfText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`PDF fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const data = await pdf(buf);
  return data.text || "";
}

async function analyzeWithOllama(bill, pdfText) {
  // Truncate to keep within context — most state bills are <30K chars
  const trimmed = pdfText.slice(0, 12_000);
  const userPrompt =
    `Bill: ${bill.state} ${bill.bill_number}\n` +
    `Title: ${bill.title ?? "(none)"}\n` +
    `Status: ${bill.status ?? "(unknown)"}\n` +
    `Last action: ${bill.last_action ?? "(none)"}\n\n` +
    `--- FULL BILL TEXT (truncated to 12K chars) ---\n${trimmed}`;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      format: "json",
      stream: false,
      options: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return JSON.parse(data.message?.content ?? "{}");
}

// ---------- main ----------
console.log(`\nDeep-analyzing bills with Ollama (${MODEL} @ ${OLLAMA_URL})…\n`);
if (!(await checkOllama())) process.exit(1);

let q = supabase
  .from("bills")
  .select("id, state, bill_number, title, status, last_action, deep_analyzed_at")
  .eq("active", true)
  .eq("scope", "state")
  .limit(LIMIT);

if (SPECIFIC_BILL) q = q.eq("id", SPECIFIC_BILL);
else if (!REFRESH) q = q.is("deep_analyzed_at", null);

const { data: bills, error } = await q;
if (error) { console.error(error.message); process.exit(1); }
if (!bills || bills.length === 0) {
  console.log("Nothing to analyze. Pass --refresh to re-process.");
  process.exit(0);
}

console.log(`Found ${bills.length} bill${bills.length === 1 ? "" : "s"} to analyze.\n`);

let done = 0, failed = 0, leafTargets = 0, syntheticOnly = 0;
const t0 = Date.now();

for (const bill of bills) {
  const tag = `${bill.state} ${bill.bill_number}`.padEnd(14);
  process.stdout.write(`  [${done + failed + 1}/${bills.length}] ${tag} `);

  try {
    const versionInfo = await fetchBillVersionPdf(bill.state, bill.bill_number);
    if (!versionInfo) {
      console.log("✗ no PDF version available");
      failed++;
      continue;
    }
    process.stdout.write(`(${versionInfo.note}) `);

    const text = await downloadPdfText(versionInfo.url);
    if (text.length < 200) {
      console.log("✗ PDF text too short");
      failed++;
      continue;
    }
    process.stdout.write(`${(text.length / 1000).toFixed(1)}KB → `);

    const r = await analyzeWithOllama(bill, text);
    if (typeof r.targets_natural_leaf !== "boolean") {
      console.log("✗ bad JSON shape");
      failed++;
      continue;
    }

    const update = {
      summary_ai: typeof r.summary_ai === "string" ? r.summary_ai.slice(0, 1000) : null,
      advocacy_callout: typeof r.advocacy_callout === "string" ? r.advocacy_callout.slice(0, 500) : null,
      targets_natural_leaf: !!r.targets_natural_leaf,
      targets_synthetic_only: !!r.targets_synthetic_only,
      kratom_relevance: ["pro", "anti", "neutral"].includes(r.stance) ? r.stance : "neutral",
      relevance_confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.5,
      deep_analyzed_at: new Date().toISOString(),
      enriched_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabase.from("bills").update(update).eq("id", bill.id);
    if (upErr) {
      console.log(`DB ✗ ${upErr.message}`);
      failed++;
    } else {
      const conf = (update.relevance_confidence * 100).toFixed(0);
      const tags = [
        update.targets_natural_leaf ? "🚨leaf" : "✓no-leaf",
        update.targets_synthetic_only ? "syn-only" : "",
      ].filter(Boolean).join(" ");
      console.log(`✓ ${update.kratom_relevance} ${conf}% · ${tags}`);
      done++;
      if (update.targets_natural_leaf) leafTargets++;
      if (update.targets_synthetic_only) syntheticOnly++;
    }

    // Be polite to OpenStates rate limit (250/day on free tier)
    await new Promise((r) => setTimeout(r, 1500));
  } catch (e) {
    console.log(`✗ ${(e.message ?? e).toString().slice(0, 150)}`);
    failed++;
  }
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${done} analyzed, ${failed} failed.`);
console.log(`  Targets natural leaf: ${leafTargets}`);
console.log(`  Synthetic-only (protective of leaf): ${syntheticOnly}`);
process.exit(failed > bills.length / 2 ? 1 : 0);
