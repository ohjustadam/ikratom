#!/usr/bin/env node
/**
 * align-bills-to-research.mjs — populates bill_research_alignment.
 *
 * For each active bill, finds the research papers in our library that
 * are most relevant, scores the relevance, and tags the alignment
 * direction (aligned / contradictory / context).
 *
 * Algorithm v1 (no embeddings yet; pure topic + cluster + keyword):
 *   1. Map each detected cluster slug to a topic profile (which
 *      research topics + relevance flags matter for that operation).
 *   2. For bills in clusters: pull all papers matching that profile,
 *      score by topic-overlap + evidence-strength + relevance flag.
 *   3. For bills NOT in clusters: keyword-overlap on bill.summary
 *      against paper.topics + paper.ai_key_findings_md.
 *   4. Score alignment direction: bill kratom_relevance + paper
 *      findings → aligned (paper supports premise) / contradictory
 *      (paper refutes) / context (relevant but neither).
 *
 * Idempotent via UPSERT on the (bill_id, paper_id) unique constraint.
 * Re-runs replace stale scores without duplicating rows.
 *
 * Usage:
 *   node --env-file=.env.local scripts/align-bills-to-research.mjs
 *   node --env-file=.env.local scripts/align-bills-to-research.mjs --bill <bill_id>
 *   node --env-file=.env.local scripts/align-bills-to-research.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const ONLY_BILL = arg("--bill");
const DRY = args.includes("--dry-run");
const TOP_N_PER_BILL = 8;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Cluster → research-topic profile. What topics + relevance flags
// matter when evaluating a bill in this cluster. Hand-curated based
// on each cluster's actual legal substance.
const CLUSTER_TOPIC_MAP = {
  kcpa: {
    relevant_topics: ["safety", "adulteration", "contamination", "consumer_protection", "natural_leaf", "labeling", "age"],
    require_natural_leaf: true,
    require_7oh: false,
    description: "KCPA regulates natural-leaf safety + labeling + age",
  },
  synthetic_ban_only: {
    relevant_topics: ["7-oh", "7-hydroxymitragynine", "synthetic", "adulteration", "potency"],
    require_natural_leaf: false,
    require_7oh: true,
    description: "Synthetic-only carve-out targets 7-OH enriched products",
  },
  schedule_i_total_ban: {
    relevant_topics: ["addiction", "harm", "abuse_potential", "opioid", "scheduling", "safety"],
    require_natural_leaf: true,
    require_7oh: false,
    description: "Schedule I bans treat kratom as full Schedule I substance",
  },
  age_21_only: {
    relevant_topics: ["age", "adolescent", "youth", "minors"],
    require_natural_leaf: true,
    require_7oh: false,
    description: "Age-21 restrictions",
  },
  labeling_lab_testing: {
    relevant_topics: ["labeling", "adulteration", "contamination", "lab_testing", "quality_control"],
    require_natural_leaf: true,
    require_7oh: false,
    description: "Labeling + lab-testing requirements",
  },
  municipal_prohibition: {
    relevant_topics: ["safety", "harm", "regulation", "prohibition"],
    require_natural_leaf: true,
    require_7oh: false,
    description: "City/county-level kratom bans",
  },
  retail_license: {
    relevant_topics: ["retail", "licensing", "regulation", "consumer_protection"],
    require_natural_leaf: true,
    require_7oh: false,
    description: "Retailer-licensing requirements",
  },
  ice_out: {
    relevant_topics: ["intoxication", "delta-8", "psychoactive", "novel_psychoactive"],
    require_natural_leaf: true,
    require_7oh: false,
    description: "Intoxicating-substance carve-outs",
  },
};

// Token-normalize a string for keyword overlap matching.
function tokens(s) {
  if (!s) return new Set();
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4)
  );
}

function scorePaperForClusterProfile(paper, profile) {
  let score = 0;
  const reasons = [];

  // Topic overlap
  const paperTopics = new Set((paper.topics ?? []).map((t) => String(t).toLowerCase()));
  const profileTopics = new Set(profile.relevant_topics.map((t) => t.toLowerCase()));
  const overlap = [...paperTopics].filter((t) => {
    for (const pt of profileTopics) if (t.includes(pt) || pt.includes(t)) return true;
    return false;
  });
  if (overlap.length > 0) {
    score += 0.3 * Math.min(1, overlap.length / 3);
    reasons.push(`topics:${overlap.slice(0, 3).join(",")}`);
  }

  // Relevance flag match (natural-leaf or 7-OH)
  const nlRel = Number(paper.ai_relevance_natural_leaf) || 0;
  const ohRel = Number(paper.ai_relevance_7oh) || 0;
  if (profile.require_natural_leaf && nlRel >= 5) {
    score += 0.25 * (nlRel / 10);
    reasons.push(`natural-leaf:${nlRel}/10`);
  }
  if (profile.require_7oh && ohRel >= 5) {
    score += 0.25 * (ohRel / 10);
    reasons.push(`7-OH:${ohRel}/10`);
  }

  // Evidence strength bonus
  const strength = paper.ai_evidence_strength;
  if (strength === "strong") {
    score += 0.2;
    reasons.push("strong-evidence");
  } else if (strength === "moderate") {
    score += 0.1;
    reasons.push("moderate-evidence");
  }

  // Distinguishes natural vs synthetic — important credibility signal
  if (paper.ai_distinguishes_natural_vs_synthetic) {
    score += 0.1;
    reasons.push("nat-vs-syn distinguishing");
  }

  // Retracted papers get score=0 always — drop entirely
  if (paper.retracted) return { score: 0, reasons: ["retracted"] };

  return { score: Math.min(1, score), reasons };
}

function scorePaperByTextMatch(paper, bill) {
  const billText = `${bill.title ?? ""} ${bill.summary ?? ""}`;
  const paperText = `${paper.title ?? ""} ${(paper.topics ?? []).join(" ")} ${(paper.ai_key_findings_md ?? "").slice(0, 1000)}`;
  const billToks = tokens(billText);
  const paperToks = tokens(paperText);
  if (billToks.size === 0 || paperToks.size === 0) return { score: 0, reasons: [] };
  const overlap = [...billToks].filter((t) => paperToks.has(t)).length;
  const score = Math.min(1, overlap / Math.min(billToks.size, 20));
  if (overlap < 3) return { score: 0, reasons: [] };
  return { score: score * 0.6, reasons: [`text-overlap:${overlap}-shared-terms`] };
}

function classifyAlignment(paper, bill) {
  // Heuristic. Bill kratom_relevance is 'anti' | 'pro' | 'neutral' | 'unknown'.
  // Strong evidence supporting safety + bill is anti = contradictory.
  // Strong evidence of harm + bill is anti = aligned.
  // Default = context.
  const findings = (paper.ai_key_findings_md ?? "").toLowerCase();
  const strength = paper.ai_evidence_strength;
  const isStrong = strength === "strong" || strength === "moderate";

  // Crude sentiment cue
  const supportsSafety =
    /\b(safe|low\s*risk|no\s*harm|effective|therapeutic|opioid\s*alternative|withdrawal\s*management)\b/.test(findings);
  const indicatesHarm =
    /\b(toxic|harmful|fatal|overdose|seizure|liver\s*injury|hepatotoxic|dependence|addict)/.test(findings);

  if (!isStrong) return "context";
  if (bill.kratom_relevance === "anti") {
    if (supportsSafety && !indicatesHarm) return "contradictory";
    if (indicatesHarm && !supportsSafety) return "aligned";
  }
  if (bill.kratom_relevance === "pro") {
    if (supportsSafety && !indicatesHarm) return "aligned";
    if (indicatesHarm && !supportsSafety) return "contradictory";
  }
  return "context";
}

async function alignBill(bill, papers, billToClusters, cluster_id_to_slug) {
  // 1. Try cluster-based scoring
  const billClusterIds = billToClusters.get(bill.id) ?? new Set();
  const matchedProfiles = [];
  for (const cid of billClusterIds) {
    const slug = cluster_id_to_slug.get(cid);
    if (slug && CLUSTER_TOPIC_MAP[slug]) matchedProfiles.push({ slug, profile: CLUSTER_TOPIC_MAP[slug] });
  }

  const candidates = [];
  if (matchedProfiles.length > 0) {
    // Score every paper against each matched profile, take best score per paper
    for (const paper of papers) {
      let best = { score: 0, reasons: [], slug: null };
      for (const { slug, profile } of matchedProfiles) {
        const { score, reasons } = scorePaperForClusterProfile(paper, profile);
        if (score > best.score) best = { score, reasons, slug };
      }
      if (best.score >= 0.25) {
        candidates.push({
          paper, score: best.score,
          reason: `cluster:${best.slug} · ${best.reasons.join(" · ")}`,
          source: "cluster_mapping",
        });
      }
    }
  } else {
    // Fallback: text-keyword matching
    for (const paper of papers) {
      const { score, reasons } = scorePaperByTextMatch(paper, bill);
      if (score >= 0.15) {
        candidates.push({
          paper, score,
          reason: reasons.join(" · ") || "text-keyword",
          source: "topic_keyword",
        });
      }
    }
  }

  // Take top N
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, TOP_N_PER_BILL);

  // Classify alignment per top paper
  const rows = top.map((c) => ({
    bill_id: bill.id,
    paper_id: c.paper.id,
    relevance_score: c.score,
    match_reason: c.reason.slice(0, 200),
    alignment: classifyAlignment(c.paper, bill),
    source: c.source,
  }));
  return rows;
}

async function main() {
  const t0 = Date.now();
  console.log("Loading bills, papers, clusters…");

  let billQuery = sb.from("bills")
    .select("id, title, summary, kratom_relevance, active")
    .eq("active", true);
  if (ONLY_BILL) billQuery = billQuery.eq("id", ONLY_BILL);

  const [billsRes, papersRes, clustersRes, clusterMembersRes] = await Promise.all([
    billQuery,
    sb.from("research_papers")
      .select("id, title, topics, study_type, ai_evidence_strength, ai_relevance_natural_leaf, ai_relevance_7oh, ai_distinguishes_natural_vs_synthetic, ai_key_findings_md, retracted")
      .not("ai_evaluated_at", "is", null)
      .eq("is_active", true),
    sb.from("bill_clusters").select("id, slug"),
    sb.from("bill_cluster_members").select("bill_id, cluster_id"),
  ]);

  const bills = billsRes.data ?? [];
  const papers = papersRes.data ?? [];
  const clusters = clustersRes.data ?? [];
  const members = clusterMembersRes.data ?? [];

  const cluster_id_to_slug = new Map(clusters.map((c) => [c.id, c.slug]));
  const billToClusters = new Map();
  for (const m of members) {
    if (!billToClusters.has(m.bill_id)) billToClusters.set(m.bill_id, new Set());
    billToClusters.get(m.bill_id).add(m.cluster_id);
  }

  console.log(`  ${bills.length} bills · ${papers.length} evaluated papers · ${members.length} cluster memberships`);

  let totalRows = 0;
  let billsWithMatches = 0;
  let allRows = [];

  for (const bill of bills) {
    const rows = await alignBill(bill, papers, billToClusters, cluster_id_to_slug);
    if (rows.length > 0) {
      billsWithMatches += 1;
      totalRows += rows.length;
      allRows.push(...rows);
    }
  }

  console.log(`Computed ${totalRows} alignment rows across ${billsWithMatches} bills.`);

  if (DRY) {
    console.log("DRY RUN — first 5 rows:");
    for (const r of allRows.slice(0, 5)) console.log(" ", r);
  } else if (allRows.length > 0) {
    // Batch upsert in chunks of 500 to stay well under Postgres limits
    const CHUNK = 500;
    for (let i = 0; i < allRows.length; i += CHUNK) {
      const slice = allRows.slice(i, i + CHUNK);
      const { error } = await sb.from("bill_research_alignment").upsert(slice, {
        onConflict: "bill_id,paper_id",
        ignoreDuplicates: false,
      });
      if (error) {
        console.error("Upsert error:", error.message);
        break;
      }
      process.stdout.write(`  upserted ${Math.min(i + CHUNK, allRows.length)} / ${allRows.length}\r`);
    }
    console.log();
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Done in ${elapsed}s.`);

  try {
    await sb.from("scraper_runs").insert({
      source: "align_bills_to_research",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: DRY ? "empty" : "success",
      rows_updated: totalRows,
      notes: `${billsWithMatches} bills aligned · ${papers.length} papers in pool`,
    });
  } catch { /* best-effort */ }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
