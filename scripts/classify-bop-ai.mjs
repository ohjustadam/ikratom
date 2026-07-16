#!/usr/bin/env node
/**
 * Layer 2 of the BoP classifier pipeline. The regex pass (Layer 1)
 * runs inside the daily scraper and flags candidates by title patterns.
 * This script picks up those candidates and runs Gemini Flash 2.5 with
 * Google Search grounding to:
 *
 *   - Read the linked PDF / agenda page (not just the title)
 *   - Cross-reference with related state pages
 *   - Output a structured verdict: relevance + severity + confidence +
 *     reasoning + sources
 *
 * Free-tier cost: Gemini Flash 2.5 gives 1,500 grounded requests/day.
 * We classify ~30 findings/run = well within quota.
 *
 * Runs daily on GitHub Actions (cron-daily.yml: classify-bop-ai job).
 * Also runnable locally:
 *
 *   node --env-file=.env.local scripts/classify-bop-ai.mjs --limit 30
 *   node --env-file=.env.local scripts/classify-bop-ai.mjs --finding <uuid>
 *
 * Idempotent: only picks up findings where ai_classified_at IS NULL.
 * Run again to re-classify if you bump the prompt.
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) {
  console.error("GEMINI_API_KEY required.");
  process.exit(1);
}

const MODEL = "gemini-2.5-flash";
const args = process.argv.slice(2);
const arg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const SPECIFIC = arg("--finding");
const LIMIT = parseInt(arg("--limit") ?? "30", 10);

const SYS = `You are a kratom-policy fact-checker analyzing state Board of Pharmacy (BoP) agenda items, rule proposals, and news posts. The user is the iKratom advocacy platform; your verdict drives whether the kratom advocacy community gets a push notification.

You will be given: a finding's title, snippet, source URL, and the state's BoP context. Use Google Search to:
  1. Fetch the linked URL (often a PDF agenda or rule-proposal packet)
  2. Cross-reference with that state's prior kratom-related actions
  3. Determine if the item is actually about kratom (Mitragyna speciosa, mitragynine, 7-hydroxymitragynine, 7-OH)

Return STRICT JSON inside <result>...</result>:

<result>
{
  "relevance": "kratom_direct" | "kratom_adjacent" | "unrelated",
  "severity": "hostile_proposal" | "discussion_only" | "supportive" | "neutral" | "unknown",
  "confidence": 0.0..1.0,
  "reasoning": "single sentence — what you found and why you chose this classification",
  "sources": ["url1", "url2"]
}
</result>

Classification rules:
- "kratom_direct" = the finding explicitly mentions kratom / mitragynine / 7-OH OR you found the linked content does (e.g. PDF agenda item says "petition to schedule kratom").
- "kratom_adjacent" = clearly about kratom-class substances ("novel psychoactive plant supplement scheduling petition") but doesn't name kratom directly. Reserve for high-confidence proximity.
- "unrelated" = title or content has no real kratom connection (e.g. a generic "Controlled Substance Diversion Workgroup" or a "Schedule II Pseudoephedrine" notice).
- Confidence: 0.9+ when you read the linked content and it's explicit; 0.6-0.8 when the title is clear but you couldn't open the link; <0.6 when you're inferring.

Severity rules:
- "hostile_proposal" = state is considering scheduling, banning, prohibiting, or restricting kratom (or a kratom-class substance). Includes emergency rules.
- "supportive" = state is considering consumer-protection-style regulation (labeling, age limits, KCPA-style framework). Better than nothing.
- "discussion_only" = informational, panel update, no rule-making action.
- "neutral" = administrative housekeeping with no policy posture.

Be conservative: when in doubt between direct and adjacent, prefer adjacent. When in doubt about severity, prefer the lower urgency. False positives waste advocate attention.

Output ONLY the <result> block, no prose.`;

async function classifyFinding(finding) {
  const userPrompt = [
    `State: ${finding.state}`,
    `Board: ${finding.board_name}`,
    `Surface: ${finding.surface}`,
    `Finding title: ${(finding.title ?? "").slice(0, 400)}`,
    finding.snippet ? `Snippet: ${finding.snippet.slice(0, 800)}` : null,
    finding.url ? `Source URL: ${finding.url}` : "Source URL: (none)",
    finding.pdf_text
      ? `\nExtracted PDF text (first ${Math.min(finding.pdf_text.length, 8000)}c of the linked agenda packet):\n---\n${finding.pdf_text.slice(0, 8000)}\n---`
      : null,
    "",
    finding.pdf_text
      ? "We already extracted text from the linked PDF (above). Verify whether it's actually about kratom and output your <result>. You can still search Google for additional context if helpful."
      : "Fetch the URL above (if any) and search Google to verify whether this is actually about kratom. Output your <result>.",
  ].filter(Boolean).join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: SYS }] },
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 200);
    throw new Error(`Gemini ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  const m = text.match(/<result>([\s\S]*?)<\/result>/);
  if (!m) throw new Error(`No <result> block: ${text.slice(0, 200)}`);
  return JSON.parse(m[1]);
}

function clampConfidence(c) {
  const n = typeof c === "number" ? c : parseFloat(c);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

const VALID_RELEVANCE = new Set(["kratom_direct", "kratom_adjacent", "unrelated"]);
const VALID_SEVERITY = new Set([
  "hostile_proposal", "discussion_only", "supportive", "neutral", "unknown",
]);

async function persist(finding, ai) {
  const relevance = VALID_RELEVANCE.has(ai.relevance) ? ai.relevance : null;
  const severity = VALID_SEVERITY.has(ai.severity) ? ai.severity : "unknown";
  const confidence = clampConfidence(ai.confidence);

  await sb
    .from("bop_findings")
    .update({
      ai_relevance: relevance,
      ai_severity: severity,
      ai_confidence: confidence,
      ai_reasoning: (ai.reasoning ?? "").slice(0, 2000),
      ai_sources: Array.isArray(ai.sources) ? ai.sources.slice(0, 8) : null,
      ai_classified_at: new Date().toISOString(),
      ai_model: MODEL,
    })
    .eq("id", finding.id);
}

// ---- main ----
let findings;
if (SPECIFIC) {
  const { data } = await sb
    .from("bop_findings")
    .select(`
      id, state, title, snippet, url, pdf_text, classified_relevance, classified_severity,
      ai_classified_at, reviewed_at,
      bop_sources!inner ( board_name, surface )
    `)
    .eq("id", SPECIFIC)
    .single();
  if (!data) { console.error("Finding not found."); process.exit(1); }
  findings = [
    {
      id: data.id,
      state: data.state,
      title: data.title,
      snippet: data.snippet,
      url: data.url,
      pdf_text: data.pdf_text,
      board_name: data.bop_sources.board_name,
      surface: data.bop_sources.surface,
    },
  ];
} else {
  const { data } = await sb
    .from("bop_findings")
    .select(`
      id, state, title, snippet, url, pdf_text, classified_relevance,
      bop_sources!inner ( board_name, surface )
    `)
    .is("ai_classified_at", null)
    .is("reviewed_at", null)
    .in("classified_relevance", ["kratom_direct", "kratom_adjacent"])
    .order("found_at", { ascending: false })
    .limit(LIMIT);
  findings = (data ?? []).map((d) => ({
    id: d.id,
    state: d.state,
    title: d.title,
    snippet: d.snippet,
    url: d.url,
    pdf_text: d.pdf_text,
    board_name: d.bop_sources.board_name,
    surface: d.bop_sources.surface,
  }));
}

if (findings.length === 0) {
  console.log("Nothing to classify.");
  process.exit(0);
}
console.log(`Classifying ${findings.length} finding(s) via Gemini ${MODEL} with grounding…`);

let ok = 0, fail = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const f of findings) {
  console.log(`\n--- ${f.state} | ${(f.title ?? "").slice(0, 80)}`);
  try {
    const ai = await classifyFinding(f);
    console.log(
      `  AI: relevance=${ai.relevance} severity=${ai.severity} conf=${ai.confidence}`
    );
    console.log(`  reason: ${(ai.reasoning ?? "").slice(0, 140)}`);
    await persist(f, ai);
    ok++;
  } catch (e) {
    console.log(`  ✗ ${(e?.message ?? e).slice(0, 200)}`);
    fail++;
  }
  // Modest pacing to stay polite + under any per-second rate limits.
  await sleep(750);
}

console.log(`\nDone. ${ok} classified, ${fail} failed.`);
// Telemetry (audit 2026-07-16: registered in cron-registry.ts but never wrote).
try {
  await sb.from("scraper_runs").insert({
    source: "classify_bop_findings_ai",
    started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    status: ok > 0 ? "success" : fail > 0 ? "error" : "empty",
    rows_updated: ok, notes: `${ok} classified · ${fail} failed`,
  });
} catch { /* best-effort */ }
process.exit(fail > 0 ? 0 : 0); // never non-zero — partial failures are fine
