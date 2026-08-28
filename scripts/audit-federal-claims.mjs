#!/usr/bin/env node
/**
 * audit-federal-claims.mjs — find (and optionally correct) published content
 * that claims a substance is federally scheduled when the Federal Register
 * says it is not.
 *
 * The backstop to lib/federal-scheduling.mjs. That library stops the writers
 * PUBLISHING a false scheduling claim; this sweeps what is already in the
 * database. On 2026-08-28 a reader had to email us because a KATU article
 * (which itself got it wrong) was summarized straight into a federal policy
 * alert and pushed to 44 people. This is the sweep that should have caught it.
 *
 * Owner rule, 2026-08-28: "even if it is the source's mistake, we should not
 * share their mistake, we should only represent the truth." So --fix does not
 * merely flag — it puts the verified record FIRST, and frames the rest as the
 * source's claim rather than as established fact. It never deletes an article,
 * never rewrites the publisher's own words, and never touches a campaign.
 *
 *   node --env-file=.env.local scripts/audit-federal-claims.mjs            # report
 *   node --env-file=.env.local scripts/audit-federal-claims.mjs --days 400 # wider
 *   node --env-file=.env.local scripts/audit-federal-claims.mjs --fix      # correct
 */
import { createClient } from "@supabase/supabase-js";
import { getFederalSchedulingFacts, findFalseClaims, correctionSentence } from "./lib/federal-scheduling.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const FIX = args.includes("--fix");
const FLAG_ONLY = args.includes("--apply");
const DAYS = parseInt(arg("--days") ?? "45", 10);
const PAGE = 1000; // PostgREST hard-caps a single request at 1000 rows.

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const t0 = Date.now();

/** Page through a table — a single .limit() silently truncates at 1000. */
async function fetchAll(table, columns, apply) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).range(from, from + PAGE - 1);
    q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const facts = await getFederalSchedulingFacts();
if (!facts.ok) {
  console.error(`Federal Register lookup failed: ${facts.error}`);
  console.error("Refusing to audit without ground truth — nothing changed.");
  process.exit(1);
}

console.log(`Ground truth (${facts.checkedAt.slice(0, 10)}):`);
for (const s of facts.substances) {
  console.log(`  ${s.status === "scheduled" ? "SCHEDULED" : s.status.padEnd(9)} ${s.label}`);
}
const truth = correctionSentence(facts);
console.log(`\nVerified statement: ${truth}\n`);

const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
const findings = [];

const news = await fetchAll(
  "news_items",
  "id, title, source_name, published_at, summary, digest_paragraphs, flag_reason",
  (q) => q.eq("active", true).gte("scraped_at", since),
);
for (const n of news) {
  const summaryHits = findFalseClaims(n.summary, facts);
  const digestHits = findFalseClaims((n.digest_paragraphs ?? []).join("\n"), facts);
  if (summaryHits.length || digestHits.length) {
    findings.push({
      kind: "news_items", id: n.id, row: n,
      label: `${n.source_name ?? "?"} — ${n.title}`,
      hits: [...summaryHits, ...digestHits],
      summaryHits, digestHits,
    });
  }
}

const alerts = await fetchAll(
  "policy_alerts",
  "id, title, body, locality, severity, action_required, created_at",
  (q) => q.eq("moderation_status", "approved").gte("created_at", since),
);
for (const a of alerts) {
  const hits = findFalseClaims([a.title, a.body].filter(Boolean).join("\n"), facts);
  if (hits.length) findings.push({ kind: "policy_alerts", id: a.id, row: a, label: `[${a.locality ?? "?"}] ${a.title}`, hits });
}

console.log(`Scanned ${news.length} news item(s) and ${alerts.length} approved alert(s) over ${DAYS} days.`);
if (!findings.length) {
  console.log("\n✓ Nothing published contradicts the federal record.");
} else {
  console.log(`\n⚠ ${findings.length} item(s) contradict the federal record:\n`);
  for (const f of findings) {
    console.log(`  ${f.kind} ${f.id}`);
    console.log(`    ${f.label}`);
    for (const h of f.hits) console.log(`    → claims ${h.substance}: "${h.sentence.slice(0, 150)}"`);
    console.log("");
  }
}

// ── correction ─────────────────────────────────────────────────────────────
// Lead with the verified record, then mark what follows as the source's claim.
// Prefixing (rather than deleting) keeps us honest: the reader is about to
// click through to an article that says the wrong thing, and hiding that
// mismatch would leave them more confused, not less.
const banner = (dateStr) =>
  `CORRECTION (${dateStr}): ${truth} The summary below reflects the source article's reporting, ` +
  `which conflicts with the federal record on this point.`;

let fixed = 0, flagged = 0;
const today = new Date().toISOString().slice(0, 10);

if (FIX && findings.length) {
  for (const f of findings) {
    if (f.kind === "news_items") {
      const patch = { flag_reason: `federal-claim-audit: corrected ${today}`.slice(0, 200) };
      if (f.summaryHits.length && f.row.summary) {
        patch.summary = `${banner(today)}\n\n${f.row.summary}`.slice(0, 4000);
      }
      if (f.digestHits.length && Array.isArray(f.row.digest_paragraphs)) {
        patch.digest_paragraphs = [banner(today), ...f.row.digest_paragraphs];
      }
      const { error } = await sb.from("news_items").update(patch).eq("id", f.id);
      if (error) console.log(`  ⚠ fix failed ${f.id}: ${error.message.slice(0, 70)}`);
      else { fixed++; console.log(`  ✓ corrected news_items ${f.id}`); }
    } else {
      // A false alert is the worst case — it pushes. Neutralise the call to
      // action and downgrade it, on top of the correction banner.
      const { error } = await sb.from("policy_alerts").update({
        body: `${banner(today)}\n\n${f.row.body ?? ""}`.slice(0, 8000),
        severity: "watch",
        action_required: false,
        moderation_note: `federal-claim-audit: asserted federal scheduling contradicted by the Federal Register; corrected ${today}.`,
      }).eq("id", f.id);
      if (error) console.log(`  ⚠ fix failed ${f.id}: ${error.message.slice(0, 70)}`);
      else { fixed++; console.log(`  ✓ corrected + downgraded policy_alerts ${f.id}`); }
    }
  }
  console.log(`\nCorrected ${fixed} item(s).`);
} else if (FLAG_ONLY && findings.length) {
  for (const f of findings.filter((x) => x.kind === "news_items" && !x.row.flag_reason)) {
    const reason = `federal-claim-audit: asserts federal scheduling of ${[...new Set(f.hits.map((h) => h.substance))].join(", ")} not supported by the Federal Register`;
    const { error } = await sb.from("news_items").update({ flag_reason: reason.slice(0, 200) }).eq("id", f.id);
    if (!error) flagged++;
  }
  console.log(`Flagged ${flagged} news item(s) for review.`);
} else if (findings.length) {
  console.log("[report only] --fix corrects them, --apply only flags for review.");
}

try {
  await sb.from("scraper_runs").insert({
    source: "audit_federal_claims",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: findings.length && !FIX ? "partial" : "ok",
    rows_updated: fixed + flagged,
    error_message: findings.length && !FIX ? `${findings.length} item(s) contradict the federal record` : null,
    notes: `scanned ${news.length} news, ${alerts.length} alerts over ${DAYS}d; fixed ${fixed}, flagged ${flagged}`,
  });
} catch { /* best-effort */ }

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
