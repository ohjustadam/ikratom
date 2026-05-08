#!/usr/bin/env node
/**
 * Cumulative bill-journey enrichment.
 *
 * Existing scripts (enrich-bills.mjs, enrich-bills-deep.mjs) only
 * summarize the LATEST version of each bill. That hides amendment
 * history — a bill introduced as a total kratom ban and later amended
 * down to a 7-OH-only restriction shows up here only as the final form.
 *
 * This script reads ALL versions + the full action timeline for a
 * single bill, then asks the AI to write a 4-paragraph trajectory:
 *   1. What was originally introduced
 *   2. How each major amendment changed it
 *   3. Where it stands now operationally
 *   4. Cumulative impact on advocates
 *
 * Routing: Groq first (fast, free tier 14,400/day, 128K context which
 * fits multi-version bills easily). Falls back to local Ollama if
 * GROQ_API_KEY isn't set.
 *
 * Run:
 *   node --env-file=.env.local scripts/enrich-bill-journey.mjs --bill <uuid>
 *   node --env-file=.env.local scripts/enrich-bill-journey.mjs --all-stale
 *   node --env-file=.env.local scripts/enrich-bill-journey.mjs --bill <uuid> --refresh
 *   node --env-file=.env.local scripts/enrich-bill-journey.mjs --bill <uuid> --provider ollama
 */

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
const requireCjs = createRequire(import.meta.url);
const { PDFParse } = requireCjs("pdf-parse");

// ---------- args ----------
const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const SPECIFIC_BILL = arg("--bill");
const ALL_STALE = args.includes("--all-stale");
const REFRESH = args.includes("--refresh");
const LIMIT = parseInt(arg("--limit") ?? "20");
const PROVIDER_OVERRIDE = arg("--provider"); // "groq" | "ollama" — auto if not set
const MODEL_OVERRIDE = arg("--model");
const FASTDEMOCRACY_URL = arg("--fastdemocracy"); // optional: scrape FD for full-fidelity NH (etc.) version + amendment PDFs

if (!SPECIFIC_BILL && !ALL_STALE) {
  console.error("Usage: --bill <uuid>  OR  --all-stale  (optionally --refresh, --provider, --model)");
  process.exit(1);
}

// ---------- env ----------
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OS_KEY = process.env.OPENSTATES_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
if (!OS_KEY) { console.error("Missing OPENSTATES_API_KEY"); process.exit(1); }

const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ---------- prompt ----------
const SYSTEM = `You are a kratom-policy analyst writing the journey of a U.S. state bill across its full life — from introduction through every amendment to its current form.

CRITICAL: never use "kratom" as a blanket term. The legitimate industry, the FDA, and most modern bills distinguish between distinct substances under the kratom umbrella. Always disambiguate when describing what a bill targets.

ALKALOID TAXONOMY (use this vocabulary precisely):
  - "natural leaf kratom" or "plain leaf kratom": whole-leaf or traditional preparation (heating, water/ethanol extraction). The plant in its natural form.
  - "mitragynine" (MGM): the dominant natural alkaloid (~1-2% of leaf). Sometimes purified or isolated.
  - "7-hydroxymitragynine" (7-OH): a natural trace alkaloid (~0.04% in fresh leaf). Distinct from semi-synthetic 7-OH-enhanced concentrates which exceed natural levels.
  - "mitragynine pseudoindoxyl" or "pseudo": an oxidation metabolite, much higher opioid affinity than MGM. Often produced semi-synthetically.
  - "synthetic" or "semisynthetic" kratom: any lab-synthesized or biosynthesized alkaloid (recombinant, fermentation, yeast-driven, enzymatic).

When describing a bill, ALWAYS specify which substance class is targeted. "Bans kratom" is wrong unless the bill literally bans the plant. The right phrasing is e.g. "bans semisynthetic 7-OH-enriched products while preserving natural leaf" or "schedules synthetic kratom alkaloids as Schedule II."

You will receive: the bill metadata (state, number, title), every version's text snapshot in chronological order, and the full action timeline.

Return JSON with these EXACT fields:

1. journey_narrative — markdown text, 4 short paragraphs separated by blank lines. NO heading prefixes. Use the alkaloid taxonomy above precisely throughout.

   Paragraph 1 — ORIGINAL FORM. What did the bill propose when first introduced? Cite the operative mechanism (Schedule II classification, age limit, retail ban, etc.) AND specify which substances it targets. 2-3 sentences.

   Paragraph 2 — AMENDMENT TRAJECTORY. Each major amendment that changed scope. If 2+ versions: describe what each amendment CHANGED relative to the prior, including any shifts in which substances are targeted. If only 1 version: "No amendments yet — see Paragraph 1." 2-4 sentences.

   Paragraph 3 — CURRENT STATE. As of the most recent action, what does the bill ACTUALLY do now? Be specific about substances and scope (e.g. "restricts liquor commission licensees only" vs "statewide ban"). What's its procedural posture? 2-3 sentences.

   Paragraph 4 — CUMULATIVE IMPACT. Why this matters for advocates. Use concrete substance language: "natural leaf preserved, 7-OH-enriched products banned at liquor stores" rather than "restricts kratom." 1-2 sentences.

2. amendments_count — integer. Distinct version snapshots in the inputs.

3. stance_changed — boolean. TRUE if the bill's effective stance toward natural leaf changed at any point.

4. key_amendment_dates — array of "YYYY-MM-DD" strings for amendments that materially changed substance scope.

5. summary_long — markdown text, 2-3 paragraphs, 200-300 words. This is the substantive briefing-grade summary at the top of the bill page (FastDemocracy-style). Structure:

   Paragraph 1 (5-7 sentences): WHAT THE BILL DOES. The mechanism in detail — what statute it amends or creates, what definitions it introduces, what it prohibits/requires/restricts, who it applies to, what penalties/scheduling/fees apply. Use the alkaloid taxonomy precisely. Reference THE LATEST version's content, not the introduced version.

   Paragraph 2 (3-5 sentences): EFFECTIVE DATE + FISCAL IMPACT + OPERATIONAL CHANGES. When does it take effect (specific date or "upon passage")? What's the projected fiscal impact (cite the bill's own fiscal note if present)? What does this change operationally for vendors, retailers, consumers, or the state?

   Paragraph 3 (1-2 sentences, OPTIONAL): UNCERTAINTY / WHAT'S DISPUTED. Only include if there are competing committee reports, party-line splits, or procedural questions. Skip otherwise.

   This summary should read like a policy analyst's standalone briefing — substantive enough that a reader who only reads it still understands what's happening.

6. substance_targeting — object keyed by substance class. Include ALL FIVE keys: natural_leaf, mitragynine, seven_oh, pseudoindoxyl, synthetic. Each value MUST be:
   {
     "stance": "bans" | "restricts" | "schedules" | "preserves" | "neutral" | "unaddressed",
     "scope": "statewide" | "retail_only" | "specific_retailer" | "research_exempt" | null,
     "schedule": "I" | "II" | "III" | "IV" | "V" | null,
     "confidence": 0.00 - 1.00,
     "notes": "one short clause"
   }
   - Use "preserves" when the bill explicitly carves out / protects that substance class
   - Use "unaddressed" when the bill simply doesn't touch that class
   - Use "bans" for outright prohibition, "restricts" for partial limits, "schedules" when added to controlled-substance schedule
   - When the latest version differs from earlier versions, reflect THE LATEST VERSION'S targeting

Return ONLY the JSON object. Do NOT wrap in markdown code blocks.`;

// ---------- OpenStates ----------
async function fetchBillFull(state, billNumber) {
  const url = new URL("https://v3.openstates.org/bills");
  url.searchParams.set("jurisdiction", state.toLowerCase());
  url.searchParams.set("q", billNumber);
  // OpenStates v3 wants `include` as REPEATED query params, not comma-
  // separated. Comma-separated returns 422.
  for (const inc of ["abstracts", "sources", "actions", "sponsorships", "versions"]) {
    url.searchParams.append("include", inc);
  }
  url.searchParams.set("per_page", "5");
  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": OS_KEY },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`OpenStates ${res.status}`);
  const data = await res.json();
  const norm = (s) => s.replace(/\s+/g, "").toUpperCase();
  const want = norm(billNumber);
  const match = data.results?.find((b) => norm(b.identifier) === want);
  if (!match) return null;
  return {
    title: match.title,
    abstracts: match.abstracts ?? [],
    actions: match.actions ?? [],
    versions: match.versions ?? [],
  };
}

async function downloadPdfText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`PDF ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  return result.text || "";
}

/**
 * Extract version + amendment PDF links from a FastDemocracy bill page.
 *
 * FastDemocracy aggregates state legislature data including PDF URLs
 * that some states (notably NH) hide behind JS bot challenges on the
 * official portal. The official PDF endpoints themselves serve raw
 * PDFs without challenge — we just need to discover the IDs.
 *
 * Returns an ordered array of { label, kind, url } where kind is
 * "version" (cumulative snapshot) or "amendment" (the patch text
 * itself). Versions come first in chronological order, then amendments.
 *
 * Generalized over any state — looks for `bill_Status/pdf.aspx?id=…`
 * NH-specific URLs in the FD page. Future: add patterns for other
 * state portals as we discover them.
 */
async function fetchFastDemocracyVersions(fdUrl) {
  const res = await fetch(fdUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`FastDemocracy ${res.status}`);
  const html = await res.text();

  // FastDemocracy renders the bill texts list as alternating HTML+PDF
  // <li> pairs inside a <ul class="bill-version-list">. Each <li>:
  //   <li><a href="…billinfo.aspx?…&version-id=22209" …><i class="uil"></i>Introduced<span class="version-mimetype">HTML</a></span></li>
  //   <li><a href="…pdf.aspx?id=22209…" …><i class="uil"></i>Introduced<span class="version-mimetype">PDF</a></span></li>
  //
  // We walk all <li> blocks in the version list. For each, capture
  // (href, label) — the label is the text between the closing </i> and
  // the opening <span class="version-mimetype">. Then dedupe by version
  // ID (the numeric `id=` param) keeping only the PDF variant, and
  // classify version vs amendment based on which kind of HTML page the
  // sibling link pointed at.
  const out = [];
  const liRx = /<li[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(?:\s*<i[^>]*><\/i>)?\s*([^<]+?)<span[^>]*version-mimetype[^>]*>([^<]+)<\/a>/g;
  let m;
  // First pass: collect every (href, label, mimeLabel)
  const rows = [];
  while ((m = liRx.exec(html)) !== null) {
    rows.push({ href: m[1], label: m[2].trim(), mime: m[3].trim() });
  }

  // Group by numeric ID. The HTML link uses `version-id=NNN` or
  // `amendment-id=NNN`; the PDF link uses `pdf.aspx?id=NNN`. Same NNN
  // across the pair.
  const groups = new Map(); // id -> { label, kind, htmlUrl, pdfUrl }
  for (const r of rows) {
    const verMatch = r.href.match(/version-id=(\d+)/);
    const amdMatch = r.href.match(/amendment-id=(\d+)/);
    const pdfMatch = r.href.match(/pdf\.aspx\?id=(\d+)/);
    const id = verMatch?.[1] ?? amdMatch?.[1] ?? pdfMatch?.[1];
    if (!id) continue;
    const kind = amdMatch ? "amendment" : (verMatch ? "version" : null); // null = PDF row, kind comes from its sibling
    let g = groups.get(id);
    if (!g) {
      g = { id, label: r.label, kind: kind ?? "version", htmlUrl: null, pdfUrl: null };
      groups.set(id, g);
    }
    if (kind) g.kind = kind;
    if (r.mime === "PDF" || pdfMatch) g.pdfUrl = r.href;
    if (r.mime === "HTML" || verMatch || amdMatch) g.htmlUrl = r.href;
    if (!g.label) g.label = r.label;
  }

  // Output ordered: versions first (in markup order), then amendments.
  // Filter out attachments that aren't bill text — FastDemocracy lists
  // committee reports (e.g. "Sen Hearing Rpt", "Sen Comm Rpt") in the
  // same UL but they're meeting docs, not the operative bill text and
  // shouldn't be analyzed as if they were a version.
  const SUPPORTING_DOC_RX = /\b(hearing|committee report|comm rpt|fiscal note|fiscal report)\b/i;
  for (const g of groups.values()) {
    if (!g.pdfUrl) continue;
    if (SUPPORTING_DOC_RX.test(g.label)) continue;
    out.push({ label: g.label, kind: g.kind, url: g.pdfUrl });
  }
  return out;
}

// ---------- AI router ----------
import { aiRouter, listAvailableProviders } from "./lib/ai-router.mjs";

async function analyzeWithFallback(system, user, _model) {
  const r = await aiRouter({
    systemPrompt: system,
    userPrompt: user,
    maxTokens: 2048,
    providerOverride: PROVIDER_OVERRIDE,
    verbose: true,
  });
  return { provider: r.provider, result: r.parsed };
}

function availableProviders() { return listAvailableProviders(); }

// (legacy provider implementations preserved below for reference;
//  not called now that we route through scripts/lib/ai-router.mjs)
async function _legacy_callGroq_unused(systemPrompt, userPrompt, model) {
  const m = model || "llama-3.3-70b-versatile";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: m,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      temperature: 0.1,
      max_tokens: 2048,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(text);
}

async function callGemini(systemPrompt, userPrompt, model) {
  const m = model || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "{}";
  return JSON.parse(text);
}

async function callCerebras(systemPrompt, userPrompt, model) {
  const m = model || "llama-3.3-70b";
  const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${CEREBRAS_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: m,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      temperature: 0.1,
      max_tokens: 2048,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Cerebras ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(text);
}

async function callOllama(systemPrompt, userPrompt, model) {
  const m = model || "llama3.3:70b";
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: m,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      format: "json",
      stream: false,
      options: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return JSON.parse(data.message?.content ?? "{}");
}

// availableProviders is now exported from scripts/lib/ai-router.mjs
// and aliased earlier in this file. The legacy local copy below is
// removed to avoid a duplicate-identifier error.
// Legacy chooseProvider/callProvider/analyzeWithFallback removed —
// all routing now flows through the shared scripts/lib/ai-router.mjs
// (cooldown-aware + JSON repair). The wrapper analyzeWithFallback() at
// the top of the file delegates to aiRouter() preserving the same
// callsite interface the rest of this script uses.

// ---------- main ----------
async function processBill(bill) {
  console.log(`\n=== ${bill.state} ${bill.bill_number} (${bill.id}) ===`);
  console.log(`  fetching OpenStates detail…`);
  const detail = await fetchBillFull(bill.state, bill.bill_number);
  if (!detail) { console.log("  ✗ not found in OpenStates"); return false; }

  let versions = detail.versions ?? [];

  // If the user supplied a FastDemocracy URL, prefer those PDFs — FD
  // surfaces version + amendment text for states that OpenStates doesn't
  // expose (NH being the canonical example).
  let fdVersions = [];
  if (FASTDEMOCRACY_URL) {
    try {
      console.log(`  scraping FastDemocracy: ${FASTDEMOCRACY_URL}`);
      fdVersions = await fetchFastDemocracyVersions(FASTDEMOCRACY_URL);
      console.log(`  FD returned ${fdVersions.length} PDF link(s) (${fdVersions.filter(v => v.kind === "version").length} versions, ${fdVersions.filter(v => v.kind === "amendment").length} amendments)`);
      // Synthesize OpenStates-shaped version objects so the rest of the
      // pipeline doesn't need to branch.
      versions = fdVersions.map((v) => ({
        note: `${v.kind === "amendment" ? "Amendment: " : ""}${v.label}`,
        date: null,
        links: [{ media_type: "application/pdf", url: v.url }],
      }));
    } catch (e) {
      console.log(`  ⚠ FastDemocracy scrape failed: ${e.message} — falling back to OpenStates`);
    }
  }

  console.log(`  ${versions.length} version(s) to analyze, ${detail.actions.length} action(s)`);

  // Fall back gracefully when OpenStates has no version PDFs (some
  // states like NH only expose the action timeline). The AI can still
  // produce a useful journey narrative from actions + title alone —
  // amendment numbers are usually in the action descriptions.
  const versionsAbsent = versions.length === 0;
  if (versionsAbsent && detail.actions.length === 0) {
    console.log("  ✗ no versions AND no actions — nothing to analyze");
    return false;
  }
  if (versionsAbsent) {
    console.log("  ⚠ no version PDFs available — using action timeline only");
  }

  // Pull each version's PDF text. We need TWO copies:
  //   - versionTexts: capped at 4K chars per version, fed to AI (rate-limit friendly)
  //   - versionTextsFull: uncapped, persisted to bills.bill_text_versions
  //     for on-site rendering. We're the intel agency now — bill text
  //     lives on iKratom, not behind a redirect.
  const versionTexts = [];
  const versionTextsFull = [];
  for (const v of versions) {
    const pdfLink = v.links?.find((l) => l.media_type === "application/pdf");
    if (!pdfLink) {
      versionTexts.push({ note: v.note ?? "", date: v.date ?? "", text: "(no PDF available)" });
      continue;
    }
    try {
      const text = await downloadPdfText(pdfLink.url);
      versionTexts.push({ note: v.note ?? "", date: v.date ?? "", text: text.slice(0, 4_000) });
      versionTextsFull.push({
        label: v.note ?? "Version",
        date: v.date ?? null,
        source_url: pdfLink.url,
        // 200K char cap per version = ~50 pages of dense legalese.
        // Trims pathological cases without losing real bill content.
        text: text.slice(0, 200_000),
      });
      console.log(`    ✓ ${v.note ?? "(unnamed)"} — ${text.length} chars`);
    } catch (e) {
      versionTexts.push({ note: v.note ?? "", date: v.date ?? "", text: `(PDF fetch failed: ${e.message})` });
    }
  }

  // Compose the user prompt.
  const actionsTimeline = detail.actions
    .map((a) => `  ${a.date}  ${a.classification?.join(",") ?? ""}  ${a.description}`)
    .join("\n");
  const abstractsBlock = (detail.abstracts ?? [])
    .map((a) => `[${a.note ?? "?"}] ${a.abstract ?? ""}`)
    .join("\n\n") || "(none)";
  const versionsBlock = versionsAbsent
    ? "(OpenStates does not expose version PDFs for this jurisdiction. Reason about amendment scope from the action descriptions — amendment numbers like '2026-1052s' or '2026-1473h' indicate distinct rewrites; their position in the chamber sequence often hints at scope.)"
    : versionTexts
        .map((v, i) => `--- VERSION ${i + 1}/${versionTexts.length}: ${v.note} (${v.date}) ---\n${v.text}`)
        .join("\n\n");

  const userPrompt =
    `Bill: ${bill.state} ${bill.bill_number}\n` +
    `Title: ${detail.title ?? bill.title ?? "(none)"}\n\n` +
    `=== FULL ACTION TIMELINE ===\n${actionsTimeline || "(no actions)"}\n\n` +
    `=== OFFICIAL ABSTRACTS ===\n${abstractsBlock}\n\n` +
    `=== ALL VERSIONS, IN ORDER ===\n${versionsBlock}`;

  // Pick provider — round-robin across configured cloud free tiers
  // (Groq, Gemini, Cerebras), with Ollama as the rate-limit fallback.
  const t0 = Date.now();
  let parsed, providerUsed;
  try {
    const r = await analyzeWithFallback(SYSTEM, userPrompt, MODEL_OVERRIDE);
    parsed = r.result;
    providerUsed = r.provider;
  } catch (e) {
    console.log(`  ✗ AI call failed across all providers: ${e.message}`);
    return false;
  }
  console.log(`  ✓ analysis via ${providerUsed} in ${Date.now() - t0}ms`);

  const journey = typeof parsed.journey_narrative === "string" ? parsed.journey_narrative.slice(0, 4000) : null;
  const ac = Number.isInteger(parsed.amendments_count) ? parsed.amendments_count : versions.length;
  if (!journey) {
    console.log(`  ✗ AI returned no journey_narrative; parsed=${JSON.stringify(parsed).slice(0, 300)}`);
    return false;
  }

  // Refresh last_action / last_action_at from the freshest action
  // OpenStates returned, so the bill row reflects current activity.
  const sortedActions = [...detail.actions].sort((a, b) => (a.date < b.date ? 1 : -1));
  const newest = sortedActions[0];
  const updatePatch = {
    journey_narrative: journey,
    amendments_count: ac,
    journey_analyzed_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
  };
  if (newest) {
    updatePatch.last_action = newest.description?.slice(0, 500) ?? null;
    updatePatch.last_action_at = newest.date;
  }

  // Persist the substantive 200-300 word summary alongside the journey.
  if (typeof parsed.summary_long === "string" && parsed.summary_long.trim().length > 60) {
    updatePatch.summary_long = parsed.summary_long.slice(0, 4000);
  }

  // Persist the full bill text versions so /bills/[id] can render them
  // on-site instead of redirecting to the state portal. Skipped when
  // OpenStates returned no PDFs (FastDemocracy fallback may still have
  // populated versionTextsFull).
  if (versionTextsFull.length > 0) {
    updatePatch.bill_text_versions = versionTextsFull;
    updatePatch.text_synced_at = new Date().toISOString();
  }
  // Persist the per-substance targeting map. Validate that all five
  // expected keys are present and shaped correctly; missing or
  // malformed payloads fall back to null rather than corrupting the
  // jsonb.
  const SUB_KEYS = ["natural_leaf", "mitragynine", "seven_oh", "pseudoindoxyl", "synthetic"];
  const ST = parsed.substance_targeting;
  if (ST && typeof ST === "object" && SUB_KEYS.every((k) => ST[k] && typeof ST[k] === "object")) {
    // Drop unknown keys, coerce confidence to a number, slice notes.
    const clean = {};
    for (const k of SUB_KEYS) {
      const v = ST[k];
      clean[k] = {
        stance: typeof v.stance === "string" ? v.stance : "unaddressed",
        scope: typeof v.scope === "string" ? v.scope : null,
        schedule: typeof v.schedule === "string" ? v.schedule : null,
        confidence: Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, Number(v.confidence))) : 0.5,
        notes: typeof v.notes === "string" ? v.notes.slice(0, 240) : "",
      };
    }
    updatePatch.substance_targeting = clean;
    updatePatch.substance_targeting_analyzed_at = new Date().toISOString();
  }
  const { error: upErr } = await supabase
    .from("bills")
    .update(updatePatch)
    .eq("id", bill.id);
  if (upErr) {
    console.log(`  ✗ DB update failed: ${upErr.message}`);
    return false;
  }
  console.log(`  ✓ saved (${journey.length} chars, ${ac} versions, stance_changed=${!!parsed.stance_changed})`);
  if (Array.isArray(parsed.key_amendment_dates) && parsed.key_amendment_dates.length > 0) {
    console.log(`  key amendment dates: ${parsed.key_amendment_dates.join(", ")}`);
  }
  return true;
}

async function selectBills() {
  if (SPECIFIC_BILL) {
    const { data } = await supabase
      .from("bills")
      .select("id, state, bill_number, title")
      .eq("id", SPECIFIC_BILL)
      .single();
    return data ? [data] : [];
  }
  // --all-stale: bills with active=true, scope=state, where journey
  // is missing OR last_synced_at > journey_analyzed_at.
  let q = supabase
    .from("bills")
    .select("id, state, bill_number, title, journey_analyzed_at, last_synced_at")
    .eq("active", true)
    .eq("scope", "state")
    .limit(LIMIT);
  if (!REFRESH) q = q.is("journey_analyzed_at", null);
  const { data } = await q;
  return data ?? [];
}

const bills = await selectBills();
if (bills.length === 0) { console.log("No bills to process."); process.exit(0); }
console.log(`Processing ${bills.length} bill(s).`);

// Show available providers up front so the operator knows what's wired.
console.log(`Providers available: ${availableProviders().join(", ")}`);

let ok = 0, fail = 0;
for (let i = 0; i < bills.length; i++) {
  const result = await processBill(bills[i]);
  if (result) ok++; else fail++;
  // Polite delay between bills so we don't burst the same provider's
  // TPM cap when the rotation cycles back. 2s × 62 bills = ~2 extra
  // minutes total, negligible against rate-limit retries.
  if (i < bills.length - 1) await new Promise((r) => setTimeout(r, 2000));
}
console.log(`\nDone. ok=${ok}, fail=${fail}`);
