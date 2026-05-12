#!/usr/bin/env node
/**
 * AI-assisted draft for legislator_kratom_stance.
 *
 * For each NY legislator who has either:
 *   - Sponsored a kratom bill (any anti/pro/neutral)
 *   - Is on a kratom-relevant committee (Health, Codes, Consumer Affairs, etc.)
 *
 * …feed their name, role, district, sponsorship history, and committee
 * memberships to the AI router (Gemini grounded preferred for fact
 * checking). Ask for a draft stance + rationale + evidence URL.
 *
 * Drafts are written with stance='unknown' initially BUT with full
 * rationale_md populated. Admin reviews + flips to
 * champion/sympathetic/neutral/hostile via /admin/legislators (TODO).
 *
 * Skips legislators who already have a manually-set stance.
 *
 * Run:
 *   node --env-file=.env.local scripts/draft-legislator-stance.mjs --state NY
 *   node --env-file=.env.local scripts/draft-legislator-stance.mjs --state NY --dry-run
 *   node --env-file=.env.local scripts/draft-legislator-stance.mjs --state NY --refresh
 */
import { createClient } from "@supabase/supabase-js";
import { aiRouter, listAvailableProviders } from "./lib/ai-router.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const STATE = arg("--state") ?? "NY";
const DRY_RUN = args.includes("--dry-run");
const REFRESH = args.includes("--refresh");
const PROVIDER_OVERRIDE = arg("--provider");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYSTEM = `You analyze a U.S. state legislator's relationship to kratom policy.
Given their name, role, district, bills they've sponsored, and committee
memberships, produce a STANCE DRAFT for admin review.

Return JSON:
{
  "stance": "champion" | "sympathetic" | "neutral" | "hostile" | "unknown",
  "rationale_md": "2-4 sentences in plain markdown. Cite concrete evidence:
                   bills sponsored, votes if known, public statements, committee chairmanship.
                   ALWAYS distinguish natural-leaf kratom from 7-OH-enriched / synthetic
                   products — many legislators target only the latter. Quote bill titles
                   verbatim where helpful.",
  "last_evidence_url": "single URL pointing to the most relevant piece of evidence
                        (a bill page, news article, official statement). If you don't
                        know one, return null."
}

Stance rubric:
  champion       = primary sponsor of pro-kratom (KCPA-style) legislation,
                   public statements supporting kratom access, votes consistently FOR access
  sympathetic    = cosponsor of pro bills OR public statements distinguishing
                   natural-leaf from 7-OH, but not lead advocate
  neutral        = no clear position OR sponsored neutral / dual-purpose bills
                   that regulate AND restrict equally
  hostile        = primary sponsor of bans / scheduling, public statements
                   conflating natural-leaf with synthetics, votes against access
  unknown        = insufficient signal in the inputs

BE HONEST. If the inputs don't justify a strong stance, say unknown.
The admin will review your draft — false confidence wastes their time.`;

function buildUserPrompt(leg) {
  const sponsorLines = leg.sponsorships.length === 0
    ? "  (no kratom bills sponsored)"
    : leg.sponsorships.map(s => `  - ${s.classification === "primary" ? "PRIMARY" : "cosponsor"}: ${s.bill_number} (${s.kratom_relevance ?? "?"}) "${s.title?.slice(0, 110)}"`).join("\n");
  const committeeLines = leg.committees.length === 0
    ? "  (no kratom-relevant committee memberships)"
    : leg.committees.map(c => `  - ${c.role.toUpperCase()}: ${c.committee_name}`).join("\n");
  return `LEGISLATOR: ${leg.full_name}
  Role: ${leg.role}
  District: ${leg.district ?? "(unset)"}
  State: ${leg.state}
  Party: ${leg.party ?? "(unset)"}

KRATOM BILL SPONSORSHIPS (${leg.sponsorships.length}):
${sponsorLines}

KRATOM-RELEVANT COMMITTEE MEMBERSHIPS (${leg.committees.length}):
${committeeLines}

Synthesize stance + rationale.`;
}

// ---------- main ----------
console.log(`Providers: ${listAvailableProviders().join(", ")}\n`);

// 1. Load state legislators
const { data: legs } = await sb.from("legislators")
  .select("id, full_name, role, district, state, party")
  .eq("state", STATE)
  .eq("active", true)
  .limit(2000);

// 2. Load their kratom bill sponsorships (any kratom bill in the state)
const { data: bills } = await sb.from("bills")
  .select("id, bill_number, title, kratom_relevance")
  .eq("state", STATE)
  .eq("active", true)
  .in("kratom_relevance", ["anti", "pro", "neutral"]);
const billsById = new Map((bills ?? []).map(b => [b.id, b]));
const billIds = (bills ?? []).map(b => b.id);

const { data: sponsorships } = billIds.length > 0
  ? await sb.from("bill_sponsors").select("bill_id, legislator_id, classification").in("bill_id", billIds)
  : { data: [] };
const sponsorshipsByLeg = new Map();
for (const s of sponsorships ?? []) {
  if (!s.legislator_id) continue;
  if (!sponsorshipsByLeg.has(s.legislator_id)) sponsorshipsByLeg.set(s.legislator_id, []);
  const bill = billsById.get(s.bill_id);
  if (bill) sponsorshipsByLeg.get(s.legislator_id).push({
    bill_number: bill.bill_number,
    title: bill.title,
    kratom_relevance: bill.kratom_relevance,
    classification: s.classification,
  });
}

// 3. Load their kratom-relevant committee memberships
const legIds = (legs ?? []).map(l => l.id);
const { data: committees } = legIds.length > 0
  ? await sb.from("legislator_committees")
      .select("legislator_id, committee_name, role")
      .in("legislator_id", legIds)
      .eq("is_kratom_relevant", true)
  : { data: [] };
const committeesByLeg = new Map();
for (const c of committees ?? []) {
  if (!committeesByLeg.has(c.legislator_id)) committeesByLeg.set(c.legislator_id, []);
  committeesByLeg.get(c.legislator_id).push(c);
}

// 4. Filter to candidates with ANY signal (sponsorship OR kratom committee)
const candidates = (legs ?? []).map(l => ({
  ...l,
  sponsorships: sponsorshipsByLeg.get(l.id) ?? [],
  committees: committeesByLeg.get(l.id) ?? [],
})).filter(l => l.sponsorships.length > 0 || l.committees.length > 0);

console.log(`${STATE}: ${candidates.length} candidate legislators (out of ${legs?.length ?? 0}) with kratom signal\n`);

// 5. Skip those who already have a stance unless --refresh
const { data: existing } = await sb.from("legislator_kratom_stance")
  .select("legislator_id")
  .in("legislator_id", candidates.map(c => c.id));
const haveStance = new Set((existing ?? []).map(r => r.legislator_id));
const toProcess = REFRESH ? candidates : candidates.filter(c => !haveStance.has(c.id));
console.log(`To process: ${toProcess.length} (${haveStance.size} already have a stance)\n`);

if (toProcess.length === 0) {
  console.log("Nothing to draft.");
  process.exit(0);
}

let ok = 0, errored = 0;
const t0 = Date.now();
for (const leg of toProcess) {
  process.stdout.write(`  ${leg.full_name.padEnd(35)} sp=${leg.sponsorships.length} comm=${leg.committees.length}  `);
  try {
    const r = await aiRouter({
      systemPrompt: SYSTEM,
      userPrompt: buildUserPrompt(leg),
      maxTokens: 800,
      providerOverride: PROVIDER_OVERRIDE,
      verbose: false,
    });
    const parsed = r.parsed ?? {};
    const stance = ["champion", "sympathetic", "neutral", "hostile", "unknown"].includes(parsed.stance) ? parsed.stance : "unknown";
    const rationale = (parsed.rationale_md ?? "").slice(0, 2000) || null;
    const evidenceUrl = (parsed.last_evidence_url ?? "").startsWith("http") ? parsed.last_evidence_url.slice(0, 500) : null;
    if (!DRY_RUN) {
      const { error } = await sb.from("legislator_kratom_stance").upsert({
        legislator_id: leg.id,
        stance,
        rationale_md: rationale,
        last_evidence_url: evidenceUrl,
      });
      if (error) { console.log(`✗ db: ${error.message}`); errored++; continue; }
    }
    console.log(`✓ ${stance} via ${r.provider}`);
    ok++;
  } catch (e) {
    console.log(`✗ ${e.message?.slice(0, 60)}`);
    errored++;
  }
  await sleep(1500);
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${ok} drafted, ${errored} errored`);

try {
  await sb.from("scraper_runs").insert({
    source: "draft_legislator_stance",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: errored > toProcess.length / 2 ? "error" : "success",
    rows_added: ok,
    notes: `${STATE}: ${ok} drafted, ${errored} errored`,
  });
} catch { /* best-effort */ }
process.exit(0);
