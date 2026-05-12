#!/usr/bin/env node
/**
 * AI-evaluate research papers for methodology quality + bias + evidence
 * strength. Uses the existing AI router (Gemini/Groq/Cerebras/etc.).
 *
 * Conservative on purpose — the goal is to give a USER a fast read on
 * whether to trust a paper, not to replace reading it. The original
 * abstract is always shown alongside the AI rating.
 *
 * Run:
 *   node --env-file=.env.local scripts/evaluate-research-papers.mjs
 *   node --env-file=.env.local scripts/evaluate-research-papers.mjs --limit 10
 *   node --env-file=.env.local scripts/evaluate-research-papers.mjs --refresh
 */
import { createClient } from "@supabase/supabase-js";
import { aiRouter } from "./lib/ai-router.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const LIMIT = parseInt(arg("--limit") ?? "30");
const REFRESH = args.includes("--refresh");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYSTEM = `You are a methodologist evaluating a single peer-reviewed paper
about kratom or 7-hydroxymitragynine (7-OH).

You will get the title, journal, study type (if detected), and abstract.
Produce a CONSERVATIVE JSON evaluation:

{
  "methodology_quality": 1 to 5 integer.
    1 = case report, anecdotal, or fundamental design flaws.
    2 = small observational, single-site, no controls, or substantial bias risk.
    3 = decent observational study, in-vitro with proper controls, or animal model.
    4 = well-designed multi-site observational, large survey with good methodology.
    5 = randomized controlled trial, systematic review with meta-analysis, or
        gold-standard preclinical with replication.
    Be HONEST. Most papers in this field are 2-3. A 5 is rare.
  "sample_size_adequate": true if the study's N is appropriate for its claims, false otherwise.
  "sample_size_notes": one sentence — what was N, was it powered correctly?
  "bias_indicators": array of specific concerns (e.g. ["industry-funded",
    "self-selection", "no blinding", "convenience sample", "no controls"]). Empty
    array if none apparent.
  "evidence_strength": "strong" | "moderate" | "weak" | "preliminary" | "inconclusive".
    Be conservative. Single in-vitro studies are usually preliminary, not strong.
  "key_findings_md": 2-4 sentence neutral plain-language summary of what the
    paper actually concluded. ALWAYS distinguish natural-leaf kratom from
    7-OH-enriched or synthetic products if the paper does. NEVER editorialize.
  "relevance_natural_leaf": 0.0 to 1.0 — how much does this paper inform
    decisions about natural-leaf kratom?
  "relevance_7oh": 0.0 to 1.0 — how much does this paper inform decisions
    about 7-OH-enriched or synthetic products?
}

Return ONLY the JSON object.`;

function buildPrompt(p) {
  return `TITLE: ${p.title}
JOURNAL: ${p.journal ?? "(unknown)"}
YEAR: ${p.publication_year ?? "?"}
DETECTED STUDY TYPE: ${p.study_type ?? "(unknown)"}
DETECTED TOPICS: ${(p.topics ?? []).join(", ") || "(none)"}

ABSTRACT:
${p.abstract ?? "(no abstract available)"}`;
}

console.log("Evaluating research papers via AI router…\n");

let q = sb.from("research_papers")
  .select("id, pubmed_id, title, journal, publication_year, study_type, topics, abstract")
  .eq("is_active", true)
  .not("abstract", "is", null)
  .order("publication_year", { ascending: false, nullsFirst: false })
  .limit(LIMIT);
if (!REFRESH) q = q.is("ai_evaluated_at", null);

const { data: papers, error } = await q;
if (error) { console.error(error.message); process.exit(1); }
if (!papers || papers.length === 0) {
  console.log("Nothing to evaluate.");
  process.exit(0);
}
console.log(`To process: ${papers.length}\n`);

const t0 = Date.now();
let ok = 0, errored = 0;
for (const p of papers) {
  process.stdout.write(`  ${(p.title ?? "").slice(0, 70).padEnd(70)} `);
  try {
    const r = await aiRouter({
      systemPrompt: SYSTEM,
      userPrompt: buildPrompt(p),
      maxTokens: 800,
      verbose: false,
    });
    const parsed = r.parsed ?? {};
    const mq = Number.isInteger(parsed.methodology_quality) && parsed.methodology_quality >= 1 && parsed.methodology_quality <= 5
      ? parsed.methodology_quality : null;
    const validStrength = ["strong", "moderate", "weak", "preliminary", "inconclusive"];
    const evs = validStrength.includes(parsed.evidence_strength) ? parsed.evidence_strength : null;
    const findings = typeof parsed.key_findings_md === "string" ? parsed.key_findings_md.slice(0, 2000) : null;
    const biasArr = Array.isArray(parsed.bias_indicators)
      ? parsed.bias_indicators.filter((x) => typeof x === "string").slice(0, 20).map((s) => s.slice(0, 120))
      : null;
    const rNat = Number.isFinite(parsed.relevance_natural_leaf)
      ? Math.max(0, Math.min(1, parsed.relevance_natural_leaf)) : null;
    const r7oh = Number.isFinite(parsed.relevance_7oh)
      ? Math.max(0, Math.min(1, parsed.relevance_7oh)) : null;

    await sb.from("research_papers").update({
      ai_methodology_quality: mq,
      ai_sample_size_adequate: typeof parsed.sample_size_adequate === "boolean" ? parsed.sample_size_adequate : null,
      ai_sample_size_notes: typeof parsed.sample_size_notes === "string" ? parsed.sample_size_notes.slice(0, 500) : null,
      ai_bias_indicators: biasArr,
      ai_evidence_strength: evs,
      ai_key_findings_md: findings,
      ai_relevance_natural_leaf: rNat,
      ai_relevance_7oh: r7oh,
      ai_evaluated_at: new Date().toISOString(),
      ai_evaluated_by_provider: r.provider,
    }).eq("id", p.id);
    console.log(`✓ q=${mq ?? "?"} ev=${evs ?? "?"} via ${r.provider}`);
    ok++;
  } catch (e) {
    console.log(`✗ ${e.message?.slice(0, 50)}`);
    errored++;
  }
  await sleep(1200);
}
const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${ok} evaluated, ${errored} errored.`);
process.exit(0);
