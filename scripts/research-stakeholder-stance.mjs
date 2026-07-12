#!/usr/bin/env node
/**
 * research-stakeholder-stance.mjs — fill the neutral two-axis stance on
 * bill_stakeholders (migration 0243, PR-A #813).
 *
 * Owner directive 2026-07-11: the /people directory + bill "People of interest"
 * sections must show each named figure's DOCUMENTED position as FACTS on two
 * INDEPENDENT axes — the natural leaf, and concentrated 7-OH — never a tribal
 * "ally"/"opponent" verdict. The classic failure this prevents: 7-HOPE Alliance
 * (pro-7-OH AND pro-plant) and the AKA (pro-leaf, anti-concentrated-7-OH) were
 * BOTH tagged "opponent," for opposite reasons.
 *
 * Method (precision over recall, free-tier only — AGENTS.md):
 *   1. Build context from the row (name/title/org/reasoning) + the bill it's
 *      tied to (state/number/title/official_url/substance_targeting).
 *   2. SearXNG finds external sources; fetch a couple of pages for excerpts.
 *   3. Free-tier AI router EXTRACTS a strict-JSON stance on each axis, with an
 *      evidence URL + a neutral sourced summary. Unstated axis => null.
 *   4. A SKEPTICAL second pass (adversarial verify) nulls out anything the
 *      evidence doesn't clearly support (same-name confusion, axis conflation).
 *   5. Write only what survives, with confidence gating. Idempotent; telemetry.
 *
 * Usage:
 *   node --env-file=.env.local scripts/research-stakeholder-stance.mjs --dry-run
 *   node --env-file=.env.local scripts/research-stakeholder-stance.mjs --only-missing --max-minutes 20
 *   node --env-file=.env.local scripts/research-stakeholder-stance.mjs --id <uuid>
 */
import { createClient } from "@supabase/supabase-js";
import { searxngSearch, searxngConfigured } from "./lib/searxng.mjs";
import { fetchPageText } from "./lib/page-text.mjs";
import { aiRouter } from "./lib/ai-router.mjs";

const t0 = Date.now();
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = has("--dry-run");
const VERIFY = has("--verify");
const INCLUDE_ALLY = has("--include-ally"); // publish ally-side stances too (owner-reviewed)
const ONLY_MISSING = has("--only-missing");
const ONLY_ID = val("--id");
const LIMIT = parseInt(val("--limit") ?? "0", 10) || 0;
const MAX_MINUTES = parseInt(val("--max-minutes") ?? "0", 10) || 0;
const PROVIDER = val("--provider") || process.env.STANCE_RESEARCH_PROVIDER || "groq";
const MIN_CONFIDENCE = 0.5;
const APP_URL = "https://www.ikratom.org"; // canonical public URL for bill-record evidence fallback

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STANCES = new Set(["supportive", "restrictive", "neutral"]);

// Coerce aiRouter's return (object or JSON-ish string) into an object.
function asJson(parsed) {
  if (parsed && typeof parsed === "object") return parsed;
  if (typeof parsed !== "string") return null;
  const s = parsed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(s); } catch { /* find first {...} */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}
function cleanStance(v) { return STANCES.has(v) ? v : null; }
function cleanUrl(u) { try { return u ? new URL(u).toString() : null; } catch { return null; } }

const EXTRACT_SYSTEM = `You determine a public figure's DOCUMENTED position on kratom policy, on TWO SEPARATE axes:
  (A) NATURAL LEAF — the whole kratom plant / traditional leaf products.
  (B) 7-OH — concentrated 7-hydroxymitragynine products (semi-synthetic / above natural trace levels).
These axes are INDEPENDENT. Many figures SUPPORT the natural leaf yet want 7-OH RESTRICTED (e.g. the American Kratom Association pushed to ban concentrated 7-OH while keeping leaf legal). 7-OH industry groups (e.g. 7-HOPE Alliance) support BOTH.

Work ONLY from the CONTEXT and SOURCE EXCERPTS provided. Do NOT use outside knowledge and do NOT guess. If an axis is not documented in the material, return null for it.

Return STRICT JSON only (no prose, no fences):
{
  "leaf_stance": "supportive" | "restrictive" | "neutral" | null,
  "leaf_evidence_url": "https://..." | null,
  "seven_oh_stance": "supportive" | "restrictive" | "neutral" | null,
  "seven_oh_evidence_url": "https://..." | null,
  "summary": "1-2 NEUTRAL factual sentences stating what they did/said, no adjectives of praise/blame" | null,
  "confidence": 0.0
}

Definitions & rules:
- leaf_stance "supportive" = backs legal access to natural-leaf kratom (opposed a ban, sponsors/supports a Kratom Consumer Protection Act that keeps leaf legal, advocates for consumers).
- leaf_stance "restrictive" = backs banning/scheduling/restricting natural-leaf kratom (sponsored/carried a ban bill, agency gave testimony or a scheduling recommendation to restrict).
- A legislator who SPONSORED or CARRIED a bill that BANS or SCHEDULES the natural leaf => leaf_stance "restrictive", and use that bill's URL as leaf_evidence_url.
- A legislator who OPPOSED a leaf ban or sponsors a KCPA keeping leaf legal => leaf_stance "supportive".
- Only set seven_oh_stance if the figure has a DOCUMENTED position specifically about 7-OH / 7-hydroxymitragynine / concentrated products. A leaf ban that never mentions 7-OH tells you NOTHING about their 7-OH stance => null.
- NEVER conflate the axes. Supporting a 7-OH ban is NOT a natural-leaf position, and vice-versa.
- Provide an evidence_url when you have a clean one from the CONTEXT or SOURCE EXCERPTS; if you don't, leave it null — a citation to the linked bill or the org's site is attached automatically afterward. NEVER null a well-founded STANCE just because you lack a URL; decide the stance from the editorial note + bill facts, and let the URL be filled in.
- When an AUTHORITATIVE ORG CLASSIFICATION block is present, treat it as strong evidence and map it: pro_7oh => seven_oh "supportive" (and, being pro-whole-plant, usually leaf "supportive"); anti_7oh => seven_oh "restrictive"; pro_kratom => leaf "supportive"; anti_kratom => leaf "restrictive" (usually seven_oh "restrictive" too); mixed/unclear => read the summary, else null. Use the org's website as the evidence_url. Apply the org's stance to the FIGURE only when their role makes them a founder / officer / lobbyist / official spokesperson for that org.
- Precision over recall: if unsure, use null and a low confidence.
- Output ONLY the JSON object.`;

const VERIFY_SYSTEM = `You are checking a proposed kratom-stance classification for OVER-REACH only. The EDITORIAL NOTE about the figure and the LINKED BILL's substance targeting ARE valid evidence — do NOT demand an external quote.

Null an axis (set it to null) ONLY when one of these is clearly true:
- the classification is really about a DIFFERENT person who shares the name;
- it asserts a stance on an alkaloid axis that the linked bill AND the editorial note do NOT support (e.g. calling someone leaf-restrictive over a synthetics-only bill that never touches the leaf);
- it attributes a bill's stance to a mere OBSERVER — an academic, journalist, or agency that was only cited or merely operates in the state — who did not themselves take that position;
- there is genuinely no basis at all for the stance in the note or sources.

Otherwise KEEP the proposed stance (a bill sponsor / carrier / testifying agency named in the editorial note is a real policy actor — keep it). Return the corrected classification as STRICT JSON, same shape plus a "notes" field:
{ "leaf_stance": ..., "leaf_evidence_url": ..., "seven_oh_stance": ..., "seven_oh_evidence_url": ..., "summary": ..., "confidence": 0.0, "notes": "what you changed and why" }
Output ONLY the JSON object.`;

function billContext(bill) {
  if (!bill) return "  (not tied to a specific bill)";
  const st = bill.substance_targeting ? JSON.stringify(bill.substance_targeting) : "unknown";
  return [
    `  Bill: ${bill.state} ${bill.bill_number} — ${bill.title ?? "(untitled)"}`,
    `  Bill status: ${bill.status ?? "?"}`,
    `  Bill URL: ${bill.official_url ?? bill.source_url ?? "(none)"}`,
    `  Bill substance targeting (per-alkaloid map): ${st}`,
  ].join("\n");
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Match a stakeholder to a curated policy_orgs row (authoritative, pre-vetted
// stance + website + evidence). Match on organization first, then the figure's
// own name (an org can appear as a stakeholder directly, e.g. "7-HOPE Alliance").
function matchPolicyOrg(s, policyOrgs) {
  const hay = norm(`${s.organization ?? ""} ${s.name ?? ""}`);
  let best = null;
  for (const po of policyOrgs) {
    const key = norm(po.name).replace(/\(.*?\)/g, "").trim();
    const short = key.split(" ").filter((w) => w.length >= 4);
    // full-name containment, or a distinctive token match (e.g. "hope", "haddow")
    if (key.length >= 4 && hay.includes(key)) return po;
    if (short.length && short.every((w) => hay.includes(w))) best = best ?? po;
  }
  return best;
}

// Gather authoritative source excerpts WITHOUT relying on SearXNG (the box IP is
// throttled by upstream engines → 0 results). Sources, in priority order:
//   1. the figure's own website (bill_stakeholders.website)
//   2. the matched policy_orgs website (curated authoritative org site)
//   3. the bill's official_url / source_url (leaf-axis evidence for sponsors)
//   4. SearXNG, best-effort (used only if it happens to return anything)
async function gatherSources(s, matchedOrg, bill) {
  const urls = [];
  if (s.website) urls.push(s.website);
  if (matchedOrg?.website) urls.push(matchedOrg.website);
  if (bill?.official_url) urls.push(bill.official_url);
  if (bill?.source_url) urls.push(bill.source_url);
  if (searxngConfigured()) {
    try {
      const res = await searxngSearch(`"${s.name}" ${s.organization ?? ""} kratom 7-OH`, { count: 6 });
      for (const r of res ?? []) urls.push(r.url);
    } catch { /* box IP throttled — ignore */ }
  }
  const seen = new Set();
  const excerpts = [];
  for (const u of urls) {
    let key; try { key = new URL(u).toString(); } catch { continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    const text = await fetchPageText(u);
    if (text) excerpts.push({ url: key, text: text.slice(0, 4500) });
    if (excerpts.length >= 3) break;
  }
  return excerpts;
}

const POLICY_ROLES = new Set(["ally", "opponent"]);

async function researchOne(s, policyOrgs) {
  const bill = Array.isArray(s.bills) ? s.bills[0] : s.bills;
  const matchedOrg = matchPolicyOrg(s, policyOrgs);
  // Only score actual POLICY ACTORS (ally/opponent) or org-affiliated figures.
  // Experts, journalists, affected businesses, and community voices are contacts
  // — not policy positions — so we never infer a stance for them from the bill
  // in their state (the UW-Madison-School-of-Pharmacy false-attribution class).
  if (!POLICY_ROLES.has(s.role_type) && !matchedOrg) return { skipRole: true };
  const excerpts = await gatherSources(s, matchedOrg, bill);
  const orgBlock = matchedOrg
    ? [
        "",
        "AUTHORITATIVE ORG CLASSIFICATION (already vetted by editors — treat as strong evidence for this figure's AFFILIATED organization; the figure inherits it only where their role makes them a voice for the org):",
        `  Org: ${matchedOrg.name}`,
        `  Curated stance code: ${matchedOrg.stance}  (pro_7oh=supports 7-OH; anti_7oh=wants 7-OH restricted; pro_kratom=supports natural leaf; anti_kratom=wants leaf restricted; mixed/unclear=read the summary)`,
        matchedOrg.summary ? `  Org summary: ${matchedOrg.summary}` : null,
        matchedOrg.website ? `  Org site (use as evidence_url): ${matchedOrg.website}` : null,
      ].filter(Boolean).join("\n")
    : "";
  const ctx = [
    `FIGURE: ${s.name}`,
    s.title ? `  Title: ${s.title}` : null,
    s.organization ? `  Organization: ${s.organization}` : null,
    `  Why we flagged them (editorial note): ${s.reasoning}`,
    billContext(bill),
    orgBlock,
    "",
    excerpts.length ? "SOURCE EXCERPTS:" : "SOURCE EXCERPTS: (none fetched — rely on the context + org classification above; be conservative)",
    ...excerpts.map((e, i) => `--- source ${i + 1}: ${e.url} ---\n${e.text}`),
  ].filter(Boolean).join("\n");

  // 1) extract
  let extract;
  try {
    const r = await aiRouter({ systemPrompt: EXTRACT_SYSTEM, userPrompt: ctx, maxTokens: 900, providerOverride: PROVIDER, verbose: false });
    extract = asJson(r.parsed);
  } catch (e) { return { error: `extract failed: ${String(e.message ?? e).slice(0, 80)}` }; }
  if (!extract) return { error: "extract returned no JSON" };

  // 2) adversarial verify (opt-in via --verify). Off by default: with stance
  // scoped to policy-actors/org-matched + the substance_targeting guard already
  // catching axis-conflation & false attribution, a second skeptical pass mostly
  // just nulled correct sponsors nondeterministically. Kept available for spot
  // re-checks (a different provider double-reads the same evidence).
  let verified = extract;
  if (VERIFY) {
    const verifyProvider = PROVIDER === "groq" ? "cerebras" : "groq";
    try {
      const vr = await aiRouter({
        systemPrompt: VERIFY_SYSTEM,
        userPrompt: `${ctx}\n\nPROPOSED CLASSIFICATION:\n${JSON.stringify(extract)}`,
        maxTokens: 900, providerOverride: verifyProvider, verbose: false,
      });
      const vj = asJson(vr.parsed);
      if (vj) verified = vj;
    } catch { /* keep extract if verify unavailable */ }
  }

  const out = {
    leaf_stance: cleanStance(verified.leaf_stance),
    leaf_evidence_url: cleanUrl(verified.leaf_evidence_url),
    seven_oh_stance: cleanStance(verified.seven_oh_stance),
    seven_oh_evidence_url: cleanUrl(verified.seven_oh_evidence_url),
    summary: typeof verified.summary === "string" ? verified.summary.slice(0, 400) : null,
    confidence: typeof verified.confidence === "number" ? verified.confidence : 0,
    notes: verified.notes ?? null,
    sources: excerpts.map((e) => e.url),
  };

  // substance_targeting AXIS GUARD (non-org figures): don't assert a stance on
  // an axis the LINKED BILL explicitly doesn't touch — the Indiana HB 1019
  // (synthetics-only) case, where the model over-eagerly said leaf=restrictive.
  // Leaf covers natural_leaf OR mitragynine; only null when BOTH are untouched.
  if (!matchedOrg && bill?.substance_targeting && typeof bill.substance_targeting === "object") {
    const st = bill.substance_targeting;
    const untouched = (k) => { const e = st[k]; return !e || e.stance === "unaddressed" || e.stance === "neutral"; };
    if (out.leaf_stance && untouched("natural_leaf") && untouched("mitragynine")) out.leaf_stance = null;
    if (out.seven_oh_stance && untouched("seven_oh")) out.seven_oh_stance = null;
  }

  // EVIDENCE-URL BACKFILL: a bill-tied figure's position is evidenced by the
  // bill they're tied to; an org-affiliated figure's by the org's site. Only
  // then apply the hard gate (a surviving stance with no citable URL is dropped).
  const billUrl = bill?.official_url || bill?.source_url || (bill?.id ? `${APP_URL}/bills/${bill.id}` : null);
  if (out.leaf_stance && !out.leaf_evidence_url) out.leaf_evidence_url = matchedOrg?.website || billUrl;
  if (out.seven_oh_stance && !out.seven_oh_evidence_url) out.seven_oh_evidence_url = matchedOrg?.website || billUrl;
  if (!out.leaf_evidence_url) out.leaf_stance = null;
  if (!out.seven_oh_evidence_url) out.seven_oh_stance = null;

  // PUBLISH-SAFETY GATE. The extractor reliably reads "sponsored/carried/testified
  // FOR the ban" but CANNOT reliably tell "drove the ban" from "merely tied to the
  // bill" — it hallucinated Rep. Chris England (a documented KCPA-repeal champion,
  // per his own editorial note) into the ban's carrier. So we only auto-publish
  // the trustworthy shapes: org-grounded figures, and 'opponent'-role figures
  // (the curator already confirmed they're on the restricting side). 'ally'-side
  // figures are HELD for owner review — never auto-labeled restrictive by an AI
  // that keeps mis-attributing bills to them. --include-ally overrides post-review.
  out.held = s.role_type === "ally" && !matchedOrg && !INCLUDE_ALLY;
  return out;
}

async function main() {
  let q = sb.from("bill_stakeholders")
    .select("id, name, title, organization, role_type, reasoning, leaf_stance, seven_oh_stance, stance_researched_at, bills(id, state, bill_number, title, status, official_url, source_url, substance_targeting)")
    .order("role_type", { ascending: true });
  if (ONLY_ID) q = q.eq("id", ONLY_ID);
  const { data: rows, error } = await q;
  if (error) { console.error(error.message); process.exit(1); }

  // Curated authoritative org stances (0181) — the source of truth for org-level
  // positions, used to ground affiliated figures' stances.
  const { data: policyOrgs } = await sb.from("policy_orgs")
    .select("name, slug, stance, org_type, website, summary").eq("active", true);

  let work = rows ?? [];
  if (ONLY_MISSING) work = work.filter((r) => !r.stance_researched_at);
  if (LIMIT > 0) work = work.slice(0, LIMIT);
  console.log(`${DRY ? "[DRY-RUN] " : ""}researching ${work.length}/${rows?.length ?? 0} stakeholders · provider=${PROVIDER}\n`);

  let written = 0, skipped = 0, errs = 0, held = 0;
  for (const s of work) {
    if (MAX_MINUTES > 0 && Date.now() - t0 > MAX_MINUTES * 60_000) { console.log("\n⏱ max-minutes reached — stopping."); break; }
    const res = await researchOne(s, policyOrgs ?? []);
    if (res.skipRole) { skipped++; continue; } // not a policy actor — no stance
    process.stdout.write(`• ${s.name}${s.organization ? " ("+s.organization+")" : ""} … `);
    if (res.error) { console.log(`✗ ${res.error}`); errs++; continue; }
    const hasAny = res.leaf_stance || res.seven_oh_stance;
    const passes = hasAny && res.confidence >= MIN_CONFIDENCE;
    const tag = `leaf=${res.leaf_stance ?? "—"} 7oh=${res.seven_oh_stance ?? "—"} conf=${res.confidence.toFixed(2)}`;
    if (!passes) { console.log(`skip (${tag})`); skipped++; if (DRY && res.summary) console.log(`     ↳ ${res.summary}`); continue; }
    if (res.held) { console.log(`⏸ HELD for review — ally-side, AI may misattribute (${tag})`); held++; if (res.summary) console.log(`     ↳ ${res.summary}`); continue; }
    console.log(`✓ ${tag}`);
    console.log(`     ↳ ${res.summary ?? "(no summary)"}`);
    if (res.leaf_evidence_url) console.log(`     ↳ leaf src: ${res.leaf_evidence_url}`);
    if (res.seven_oh_evidence_url) console.log(`     ↳ 7oh src: ${res.seven_oh_evidence_url}`);
    if (!DRY) {
      const { error: upErr } = await sb.from("bill_stakeholders").update({
        leaf_stance: res.leaf_stance,
        seven_oh_stance: res.seven_oh_stance,
        leaf_evidence_url: res.leaf_evidence_url,
        seven_oh_evidence_url: res.seven_oh_evidence_url,
        stance_summary: res.summary,
        stance_source: "ai-research-v1",
        stance_researched_at: new Date().toISOString(),
      }).eq("id", s.id);
      if (upErr) { console.log(`     ✗ write failed: ${upErr.message}`); errs++; continue; }
    }
    written++;
    await sleep(500); // be gentle to providers + the box
  }

  console.log(`\n=== ${DRY ? "DRY-RUN " : ""}done: ${written} ${DRY ? "would-write" : "written"} · ${held} held-for-review · ${skipped} skipped · ${errs} errors ===`);
  if (!DRY) {
    try {
      await sb.from("scraper_runs").insert({
        source: "research_stakeholder_stance",
        started_at: new Date(t0).toISOString(),
        finished_at: new Date().toISOString(),
        status: written > 0 ? "success" : "empty",
        rows_added: written,
        notes: `${written} stances written · ${skipped} skipped · ${errs} errors`.slice(0, 200),
      });
    } catch { /* best-effort */ }
  }
}
main();
