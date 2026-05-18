#!/usr/bin/env node
/**
 * Detect coordinated-operation clusters across active kratom-policy bills.
 *
 * The win: kratom-policy adversaries don't operate state-by-state
 * independently. They use model legislation — same operative language
 * pushed in multiple states by lobbyist networks. This script names
 * those operations and binds bills to them with evidence.
 *
 * v1 strategy: keyword/phrase pattern matching against title +
 * summary_long + bill_text_versions. Each pattern below is a curated
 * editorial signature — verbatim phrases or framing that recurs in
 * the operation. New patterns can be added without code changes by
 * extending CLUSTER_PATTERNS.
 *
 * Idempotent. Upserts cluster + member rows on each run. Confidence
 * is heuristic; admins can manually edit cluster summaries via
 * /admin/intel after detection.
 *
 * Usage:
 *   node --env-file=.env.local scripts/detect-bill-clusters.mjs
 *   node --env-file=.env.local scripts/detect-bill-clusters.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================================
// Cluster patterns — curated editorial signatures.
//
// Each pattern has:
//   slug:         stable handle for URLs (/intel/operations/<slug>)
//   name:         display name in UI / headlines
//   posture:      restrictive | protective | regulatory | mixed
//   summary_md:   one-paragraph operator briefing
//   suspected_origin: editorial judgment on who pushes the model
//   include_re:   regex that MUST match for the bill to be in this
//                 cluster
//   exclude_re:   optional regex that disqualifies (avoid overcount)
//   signature_phrases: verbatim text we look for as evidence chips
//
// Patterns are checked against title + summary_long + (first 8K of
// joined bill_text_versions). A bill can be in multiple clusters when
// it spans tactics (e.g. KCPA framework + synthetic-only carve-out).
// =============================================================
const CLUSTER_PATTERNS = [
  {
    slug: "kcpa",
    name: "KCPA (Kratom Consumer Protection Act) framework",
    posture: "regulatory",
    summary_md:
      "Originally an industry-promoted framework: age-21 purchase + product-labeling + lab-testing requirements. Many state versions adopt this scaffolding then add restrictive amendments that ban specific alkaloid concentrations or processed product formats. Advocates need to read each state's KCPA variant carefully — some preserve natural-leaf access, others outlaw most retail formats.",
    suspected_origin:
      "American Kratom Association (AKA) originally drafted the model; subsequent state versions diverge widely based on local lobbyist amendments.",
    include_re: /\bkratom consumer protection act\b|\bkcpa\b/i,
    exclude_re: null,
    signature_phrases: [
      "kratom consumer protection act",
      "person under the age of",
      "kratom product",
      "manufacturer registration",
      "lab testing",
      "label",
    ],
  },
  {
    slug: "ice_out",
    name: "ICE Out (Intoxicating Cannabinoid Extracts) sweep",
    posture: "restrictive",
    summary_md:
      "A regulatory framing that bans 'intoxicating' substances broadly, often sweeping kratom in alongside delta-8 / hemp / synthetic THC. Promoted by anti-hemp coalitions; kratom gets caught in the dragnet without being the primary target. Most damaging when written with imprecise definitions that exempt natural-leaf kratom on paper but include it via the operative definitions.",
    suspected_origin:
      "Hemp / delta-8 industry coalitions + state alcohol distributors lobbying against unregulated psychoactive retail.",
    include_re:
      /\bintoxicat\w+\b.*\b(cannabinoid|extract|product)\b|\bice out\b|\bdelta[ -]?8\b.*\bkratom\b|\bkratom\b.*\bdelta[ -]?8\b/i,
    exclude_re: null,
    signature_phrases: [
      "intoxicating",
      "delta-8",
      "delta 8",
      "synthetic cannabinoid",
      "hemp-derived",
      "ICE Out",
    ],
  },
  {
    slug: "synthetic_ban_only",
    name: "Synthetic-only ban (7-OH carve-out)",
    posture: "protective",
    summary_md:
      "Targets ONLY semisynthetic / 7-OH-enhanced / chemically-altered kratom alkaloids, explicitly preserving natural-leaf access. The advocate-favored version of restriction: addresses the public-health concern (concentrated 7-OH products) without criminalizing the plant. NH SB 557 is the prototype; many states copy or adapt it.",
    suspected_origin:
      "Public-health-aligned legislators advised by harm-reduction researchers; some industry support from natural-leaf vendors who want the synthetic competitor off shelves.",
    include_re:
      /\b7[ -]?hydroxymitragynine\b|\b7[ -]?oh\b|\bsemi[ -]?synthetic\b|\bsynthetic.*kratom\b|\bnatural leaf\b/i,
    exclude_re: /\bschedule i\b|\bcontrolled dangerous\b/i,
    signature_phrases: [
      "7-hydroxymitragynine",
      "7-OH",
      "semisynthetic",
      "natural leaf",
      "naturally occurring",
      "synthetic",
    ],
  },
  {
    slug: "schedule_i_total_ban",
    name: "Schedule I total ban",
    posture: "restrictive",
    summary_md:
      "The hardline tactic: add mitragynine (or Mitragyna speciosa as a plant) to the state's Schedule I controlled substances list. Criminalizes possession statewide regardless of preparation. Most damaging variant — eliminates retail + personal use simultaneously. Often advanced after public-health-incident narratives (overdose deaths, addiction-treatment industry testimony).",
    suspected_origin:
      "Addiction-treatment industry lobbying + law-enforcement associations; occasional alignment with pharma interests when product framing emphasizes opioid-like effects.",
    include_re:
      /\bschedule i\b|\bschedule one\b|\bcontrolled (dangerous )?substance\b.*\bmitragyna\b|\bmitragyna\b.*\bcontrolled (dangerous )?substance\b|\bschedule\b.*\bmitragyn\w+\b/i,
    exclude_re: null,
    signature_phrases: [
      "Schedule I",
      "controlled substance",
      "controlled dangerous substance",
      "Mitragyna speciosa",
      "mitragynine",
      "uniform controlled",
    ],
  },
  {
    slug: "age_21_only",
    name: "Age-21 minimum purchase",
    posture: "regulatory",
    summary_md:
      "Lighter-touch regulation: restrict kratom purchase to adults 21+, sometimes coupled with retail-license requirements. Advocate-tolerable when paired with explicit natural-leaf access; risky when bundled with broader prohibitions. Often a starting point that gets amended in committee toward heavier restriction.",
    suspected_origin:
      "Bipartisan public-health framing; minimal industry opposition because it preserves the consumer market.",
    include_re:
      /\b(under (the age of )?21|twenty[ -]one)\b.*\bkratom\b|\bkratom\b.*\b(under (the age of )?21|twenty[ -]one)\b/i,
    exclude_re: /\bschedule i\b|\bcriminaliz/i,
    signature_phrases: [
      "twenty-one",
      "21 years",
      "minor",
      "person under",
      "age of",
    ],
  },
  {
    slug: "labeling_lab_testing",
    name: "Labeling + lab-testing framework",
    posture: "protective",
    summary_md:
      "Requires kratom products to be lab-tested for alkaloid composition and labeled accurately. Advocate-favorable when standards are achievable; can become de-facto ban when test thresholds are set unreasonably (e.g. zero detectable 7-OH while natural-leaf naturally contains trace amounts).",
    suspected_origin:
      "Hybrid: industry-friendly vendors seeking quality-assurance differentiation + consumer-protection legislators.",
    include_re:
      /\blab(oratory)? test\w*\b|\bcertificate of analysis\b|\blabel\w*\b.*\bkratom\b|\bkratom\b.*\blabel\w*\b/i,
    exclude_re: null,
    signature_phrases: [
      "laboratory testing",
      "certificate of analysis",
      "good manufacturing",
      "alkaloid content",
      "labeled",
    ],
  },
  {
    slug: "municipal_prohibition",
    name: "Municipal-level prohibition cluster",
    posture: "restrictive",
    summary_md:
      "City + county ordinances banning kratom sales / possession within municipal limits. Distinct from state action — these often pass with minimal public debate via council vote, then propagate to neighboring municipalities. Particularly active in Mississippi (multiple counties + cities) and select Southern jurisdictions. The pattern is concerning because it builds a patchwork that pressures state legislatures toward statewide bans.",
    suspected_origin:
      "Local law-enforcement + faith-community coalitions; in MS specifically, organized via county sheriff associations.",
    include_re:
      /\bmunicipal\b.*\bprohibition\b|\bcity\b.*\bban\b.*\bkratom\b|\bkratom\b.*\bcity\b.*\bban\b|\bcounty\b.*\bprohibition\b|\bcounty\s*council\s*vote\b|\bcity\s*ordinance\b.*\bkratom\b|\bkratom\b.*\bcity\s*ordinance\b/i,
    exclude_re: null,
    signature_phrases: [
      "municipal kratom prohibition",
      "county-level kratom prohibition",
      "city ordinance",
      "city council",
      "borough",
      "county council",
    ],
  },
  {
    slug: "retail_license",
    name: "Retail license / registration regime",
    posture: "regulatory",
    summary_md:
      "Requires kratom retailers to register with the state or obtain a license. Captures inventory + sales data, can fund enforcement via license fees. Becomes restrictive when license caps + zoning restrictions effectively block retail; protective when license is procedural with reasonable fees.",
    suspected_origin:
      "State health/agriculture departments seeking inspection authority; aligned with established kratom vendors who can absorb compliance costs but new entrants struggle.",
    include_re:
      /\b(retail|vendor|manufacturer|wholesaler)\b.*\b(license|registration|permit)\b.*\bkratom\b|\bkratom\b.*\b(retail|vendor|manufacturer|wholesaler)\b.*\b(license|registration|permit)\b/i,
    exclude_re: null,
    signature_phrases: [
      "license",
      "registration",
      "permit",
      "manufacturer",
      "vendor",
      "retailer",
    ],
  },
];

// Cap on text we examine per bill (memory + speed). 12K is enough to
// capture the operative sections of typical kratom bills.
const MAX_TEXT_PER_BILL = 12_000;

function normalizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function billCorpus(bill) {
  const parts = [bill.title ?? "", bill.summary_long ?? ""];
  const versions = Array.isArray(bill.bill_text_versions) ? bill.bill_text_versions : [];
  // Concatenate version texts, prioritizing the latest (last)
  const reversed = [...versions].reverse();
  for (const v of reversed) {
    const t = v?.text;
    if (typeof t === "string" && t.length > 0) parts.push(t);
    if (parts.join(" ").length > MAX_TEXT_PER_BILL) break;
  }
  return normalizeText(parts.join("\n")).slice(0, MAX_TEXT_PER_BILL);
}

function findEvidencePhrases(text, phrases) {
  const lower = text.toLowerCase();
  const matches = [];
  for (const p of phrases) {
    const idx = lower.indexOf(p.toLowerCase());
    if (idx >= 0) {
      // Pull a small context window for the chip display
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + p.length + 60);
      matches.push(`"…${text.slice(start, end).trim()}…"`);
    }
  }
  return matches.slice(0, 3); // top 3 evidence chips per bill
}

// ── Main
const t0 = Date.now();
console.log(`Detecting bill clusters${DRY_RUN ? " (DRY RUN)" : ""}…\n`);

// Pull every active anti/pro bill with text
const { data: bills } = await sb
  .from("bills")
  .select("id, state, bill_number, title, summary_long, kratom_relevance, scope, bill_text_versions, last_action_at")
  .eq("active", true)
  .in("kratom_relevance", ["anti", "pro"])
  .limit(2000);

console.log(`Scanning ${bills?.length ?? 0} active anti/pro bills…\n`);

const memberRowsByCluster = new Map(); // slug -> array of member rows

for (const bill of bills ?? []) {
  const corpus = billCorpus(bill);
  if (corpus.length < 50) continue;

  for (const pat of CLUSTER_PATTERNS) {
    if (!pat.include_re.test(corpus)) continue;
    if (pat.exclude_re && pat.exclude_re.test(corpus)) continue;

    const evidence = findEvidencePhrases(corpus, pat.signature_phrases);
    const confidence = Math.min(0.6 + evidence.length * 0.12, 1.0);
    const matchReason = evidence.length > 0
      ? evidence.join(" · ")
      : `Title/text matches "${pat.name}" include pattern.`;

    if (!memberRowsByCluster.has(pat.slug)) memberRowsByCluster.set(pat.slug, []);
    memberRowsByCluster.get(pat.slug).push({
      cluster_slug: pat.slug,
      bill_id: bill.id,
      bill,
      confidence,
      match_reason: matchReason.slice(0, 500),
    });
  }
}

// Persist
let clustersWritten = 0, membersWritten = 0;
for (const pat of CLUSTER_PATTERNS) {
  const members = memberRowsByCluster.get(pat.slug) ?? [];
  if (members.length === 0) {
    console.log(`  ${pat.slug.padEnd(28)} 0 bills matched`);
    continue;
  }
  const states = new Set(members.map((m) => m.bill.state));
  const introDates = members.map((m) => m.bill.last_action_at).filter(Boolean).sort();
  const earliest = introDates[0] ?? null;
  const latest = introDates[introDates.length - 1] ?? null;

  console.log(
    `  ${pat.slug.padEnd(28)} ${String(members.length).padStart(3)} bills, ${String(states.size).padStart(2)} states`,
  );

  if (DRY_RUN) continue;

  // Upsert cluster row
  const clusterRow = {
    slug: pat.slug,
    name: pat.name,
    summary_md: pat.summary_md,
    posture: pat.posture,
    signature_phrases: pat.signature_phrases,
    suspected_origin: pat.suspected_origin,
    bill_count: members.length,
    state_count: states.size,
    earliest_introduced: earliest ? earliest.slice(0, 10) : null,
    latest_introduced: latest ? latest.slice(0, 10) : null,
    updated_at: new Date().toISOString(),
  };
  const { data: clusterUpsert, error: clusterErr } = await sb
    .from("bill_clusters")
    .upsert(clusterRow, { onConflict: "slug" })
    .select("id")
    .single();
  if (clusterErr) {
    console.error(`    ✗ cluster ${pat.slug} upsert failed: ${clusterErr.message}`);
    continue;
  }
  clustersWritten++;
  const cluster_id = clusterUpsert.id;

  // Replace member rows for this cluster (delete + insert is simpler
  // than per-row upsert when the set may shrink as bills go inactive)
  await sb.from("bill_cluster_members").delete().eq("cluster_id", cluster_id);
  const memberInsertRows = members.map((m) => ({
    cluster_id,
    bill_id: m.bill_id,
    confidence: m.confidence,
    match_reason: m.match_reason,
  }));
  const { error: memErr } = await sb
    .from("bill_cluster_members")
    .insert(memberInsertRows);
  if (memErr) {
    console.error(`    ✗ members insert failed: ${memErr.message}`);
    continue;
  }
  membersWritten += memberInsertRows.length;
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${clustersWritten} clusters, ${membersWritten} bill memberships written${DRY_RUN ? " (DRY RUN)" : ""}.`);

try {
  await sb.from("scraper_runs").insert({
    source: "detect_bill_clusters",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: "success",
    rows_updated: clustersWritten,
    notes: `${clustersWritten} clusters · ${membersWritten} memberships across ${bills?.length ?? 0} bills`,
  });
} catch { /* best-effort */ }
