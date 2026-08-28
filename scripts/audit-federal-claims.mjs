#!/usr/bin/env node
/**
 * audit-federal-claims.mjs — find published content that claims a substance is
 * federally scheduled when the Federal Register says it is not.
 *
 * The companion to lib/federal-scheduling.mjs. That library stops us WRITING a
 * false scheduling claim; this one finds the ones already sitting in the
 * database. On 2026-08-28 a reader had to email us because a KATU article
 * (which itself got it wrong) was summarized straight into a federal policy
 * alert and pushed to 44 people. This is the sweep that should have caught it
 * first.
 *
 * Deliberately conservative — it REPORTS, it does not rewrite. A wrong
 * scheduling claim is an editorial problem, and the platform's rule is that AI
 * never auto-publishes a claim about what the government did. --apply only sets
 * a flag_reason so the item surfaces for review; it never edits copy, never
 * deactivates, never touches a campaign.
 *
 *   node --env-file=.env.local scripts/audit-federal-claims.mjs
 *   node --env-file=.env.local scripts/audit-federal-claims.mjs --days 60
 *   node --env-file=.env.local scripts/audit-federal-claims.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { getFederalSchedulingFacts } from "./lib/federal-scheduling.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes("--apply");
const DAYS = parseInt(arg("--days") ?? "45", 10);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const t0 = Date.now();

// A claim only counts as a FEDERAL scheduling assertion if it names a federal
// actor or the federal schedule itself.
const FEDERAL = /\b(DEA|Drug Enforcement|federal(ly)?|HHS|FDA|nationwide|Controlled Substances Act|CSA)\b|\bSchedule\s*(I|One|1)\b/i;

// Completed action — "it happened".
const COMPLETED = /\b(banned|outlaw\w*|made\s+(it\s+)?illegal|is\s+now\s+illegal|became\s+illegal|placed|classified|scheduled|criminaliz\w+|took\s+effect|went\s+into\s+effect|prohibit\w*)\b/i;

// Proposal / future language — if present, the sentence is describing a plan,
// not an accomplished fact, so it is NOT a false claim.
const PROPOSED = /\b(propos\w+|plan(s|ned|ning)?\b|mov(e[sd]?|ing)\s+(to|kratom|it)|intend\w*|would\b|could\b|may\b|will\b|expect\w*|urge[sd]?|recommend\w*|call(s|ed)?\s+for|seek\w*|considering|weigh\w+|pending|deadline|nearing|set\s+to|advanc\w+|oppos\w+|testimony|announce[sd]?\s+(plans|intent)|comment\s+period|if\s+(finalized|approved|enacted))\b/i;

// Negation / correct-reporting language. "traditional kratom is NOT banned under
// federal law" is accurate reporting, not a false claim.
const NEGATED = /\b(not\s+(banned|scheduled|illegal|classified|prohibited)|isn't|is\s+not|are\s+not|aren't|does\s+not|doesn't|has\s+not|hasn't|remains?\s+(legal|unscheduled|available)|still\s+legal|unscheduled|no\s+federal)\b/i;

// State-level bans are real and common (ND, MA, KS…). A sentence about a state
// action is not a false federal claim, so require the absence of state framing.
const STATE_LEVEL = /\b(state|statewide|governor|legislature|lawmakers?|county|city|municipal|executive\s+order|emergency\s+order|Department\s+of\s+Public\s+Health|[A-Z][a-z]+\s+(Senate|House))\b|\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New\s+Hampshire|New\s+Jersey|New\s+Mexico|New\s+York|North\s+Carolina|North\s+Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode\s+Island|South\s+Carolina|South\s+Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West\s+Virginia|Wisconsin|Wyoming)\b/i;

// Our own correction copy names the false claim in order to debunk it — never
// flag an item we have already corrected.
const ALREADY_CORRECTED = /\bCORRECT(ION|ED)\b/i;

const splitSentences = (text) =>
  String(text || "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

function findFalseClaims(text, unscheduled) {
  if (!text || ALREADY_CORRECTED.test(text)) return [];
  const hits = [];
  for (const sentence of splitSentences(text)) {
    if (!FEDERAL.test(sentence)) continue;
    if (!COMPLETED.test(sentence)) continue;
    if (PROPOSED.test(sentence)) continue;
    if (NEGATED.test(sentence)) continue;
    if (STATE_LEVEL.test(sentence)) continue;
    for (const s of unscheduled) {
      if (s.match.test(sentence)) hits.push({ substance: s.label, sentence });
    }
  }
  return hits;
}

const facts = await getFederalSchedulingFacts();
if (!facts.ok) {
  console.error(`Federal Register lookup failed: ${facts.error}`);
  console.error("Refusing to audit without ground truth — nothing changed.");
  process.exit(1);
}

// Rebuild matchers for the substances that are NOT actually scheduled.
//
// Bare "kratom" is deliberately absent. The word appears in nearly every
// sentence we scan — "kratom-related opioids", "the kratom industry", "a kratom
// alkaloid" — so matching it flags accurate reporting about the MP/MGM-15/MGM-16
// order as though it were a claim about natural leaf. A claim that natural leaf
// is federally scheduled is essentially never made without also naming a
// specific alkaloid, which the matchers below already catch. Precision matters
// more than reach here: an auditor that cries wolf gets ignored, and then the
// next KATU slips through exactly the way this one did.
const MATCHERS = {
  "7-oh": /7[-\s]?hydroxy[-\s]?mitragynine|\b7-OH\b/i,
  "mitragynine-pseudoindoxyl": /mitragynine\s+pseudoindoxyl/i,
  "mgm-15": /\bMGM[-\s]?15\b/i,
  "mgm-16": /\bMGM[-\s]?16\b/i,
  mitragynine: /(?<!hydroxy[-\s]?)(?<!7[-\s])\bmitragynine\b(?!\s+pseudoindoxyl)/i,
};
const unscheduled = facts.substances
  .filter((s) => s.status !== "scheduled")
  .map((s) => ({ ...s, match: MATCHERS[s.key] }))
  .filter((s) => s.match);

console.log(`Ground truth (${facts.checkedAt.slice(0, 10)}):`);
for (const s of facts.substances) console.log(`  ${s.status === "scheduled" ? "SCHEDULED" : s.status.padEnd(9)} ${s.label}`);
console.log(`\nAuditing content that claims federal scheduling for: ${unscheduled.map((s) => s.label).join(", ")}\n`);

const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
const findings = [];

// --- news items -----------------------------------------------------------
const { data: news, error: newsErr } = await sb
  .from("news_items")
  .select("id, title, source_name, published_at, summary, digest_paragraphs, flag_reason")
  .eq("active", true)
  .gte("scraped_at", since)
  .limit(1000);
if (newsErr) { console.error("news query failed:", newsErr.message); process.exit(1); }

for (const n of news ?? []) {
  const body = [n.summary, ...(n.digest_paragraphs ?? [])].filter(Boolean).join("\n");
  const hits = findFalseClaims(body, unscheduled);
  if (hits.length) findings.push({ kind: "news_items", id: n.id, label: `${n.source_name ?? "?"} — ${n.title}`, hits, flagged: !!n.flag_reason });
}

// --- policy alerts --------------------------------------------------------
const { data: alerts, error: alertErr } = await sb
  .from("policy_alerts")
  .select("id, title, body, locality, moderation_status, created_at")
  .eq("moderation_status", "approved")
  .gte("created_at", since)
  .limit(1000);
if (alertErr) { console.error("alerts query failed:", alertErr.message); process.exit(1); }

for (const a of alerts ?? []) {
  const hits = findFalseClaims([a.title, a.body].filter(Boolean).join("\n"), unscheduled);
  if (hits.length) findings.push({ kind: "policy_alerts", id: a.id, label: `[${a.locality ?? "?"}] ${a.title}`, hits });
}

// --- report ---------------------------------------------------------------
console.log(`Scanned ${news?.length ?? 0} news item(s) and ${alerts?.length ?? 0} approved alert(s) over ${DAYS} days.`);
if (!findings.length) {
  console.log("\n✓ No content asserts federal scheduling that the Federal Register contradicts.");
} else {
  console.log(`\n⚠ ${findings.length} item(s) contradict the federal record:\n`);
  for (const f of findings) {
    console.log(`  ${f.kind} ${f.id}${f.flagged ? " [already flagged]" : ""}`);
    console.log(`    ${f.label}`);
    for (const h of f.hits) console.log(`    → claims ${h.substance}: "${h.sentence.slice(0, 160)}"`);
    console.log("");
  }
}

let flagged = 0;
if (APPLY && findings.length) {
  for (const f of findings.filter((x) => x.kind === "news_items" && !x.flagged)) {
    const reason = `federal-claim-audit: asserts federal scheduling of ${[...new Set(f.hits.map((h) => h.substance))].join(", ")} not supported by the Federal Register`;
    const { error } = await sb.from("news_items").update({ flag_reason: reason.slice(0, 200) }).eq("id", f.id);
    if (error) console.log(`  ⚠ flag failed ${f.id}: ${error.message.slice(0, 60)}`);
    else flagged++;
  }
  console.log(`Flagged ${flagged} news item(s) for review. Alerts are reported only — correct those by hand.`);
} else if (findings.length) {
  console.log("[report only] pass --apply to flag the news items for review.");
}

// Telemetry so the cron watchdog can see this ran (standing rule 6).
try {
  await sb.from("scraper_runs").insert({
    source: "audit_federal_claims",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: findings.length ? "partial" : "ok",
    rows_updated: flagged,
    error_message: findings.length ? `${findings.length} item(s) contradict the federal record` : null,
    notes: `scanned ${news?.length ?? 0} news, ${alerts?.length ?? 0} alerts over ${DAYS}d`,
  });
} catch { /* best-effort */ }

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
