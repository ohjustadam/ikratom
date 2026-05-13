#!/usr/bin/env node
/**
 * Backfill missing abstracts on existing research_papers rows.
 *
 * Some PubMed records arrive without abstracts on the initial ingest
 * (NCBI hasn't received the publisher's text yet, or the record is
 * structured differently). Those rows skip AI evaluation since the
 * evaluator needs abstract text to score methodology / quality.
 *
 * This script re-fetches each abstractless paper by PMID and tries
 * to populate the abstract field if PubMed now has it.
 *
 * Free — uses PubMed E-utilities, no key required (pace 1 req/sec
 * without key, 10/sec with NCBI_API_KEY).
 *
 * Run:
 *   node --env-file=.env.local scripts/backfill-research-abstracts.mjs
 *   node --env-file=.env.local scripts/backfill-research-abstracts.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-research-abstracts.mjs --limit 50
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const LIMIT = parseInt(arg("--limit") ?? "100");
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NCBI_KEY = process.env.NCBI_API_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function efetchOne(pmid) {
  const params = new URLSearchParams({
    db: "pubmed",
    id: pmid,
    retmode: "xml",
  });
  if (NCBI_KEY) params.set("api_key", NCBI_KEY);
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const xml = await res.text();
  // Same extraction logic as sync-research-pubmed.mjs
  const blocks = [...xml.matchAll(/<AbstractText\b[^>]*>([\s\S]*?)<\/AbstractText>/g)];
  const abstract = blocks
    .map((a) => a[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  return abstract || null;
}

// ---------- main ----------
const { data: papers, error } = await sb
  .from("research_papers")
  .select("id, pubmed_id, title")
  .is("abstract", null)
  .not("pubmed_id", "is", null)
  .limit(LIMIT);

if (error) { console.error("DB query failed:", error.message); process.exit(1); }
console.log(`${papers.length} abstractless papers to check${DRY_RUN ? " [DRY RUN]" : ""}\n`);

const t0 = Date.now();
let recovered = 0;
let stillEmpty = 0;
let errored = 0;

for (const p of papers) {
  process.stdout.write(`  PMID ${p.pubmed_id.padEnd(10)} `);
  let abstract;
  try {
    abstract = await efetchOne(p.pubmed_id);
  } catch (e) {
    console.log(`✗ fetch error: ${e.message?.slice(0, 60)}`);
    errored++;
    await sleep(NCBI_KEY ? 100 : 1100);
    continue;
  }

  if (!abstract) {
    console.log(`· still no abstract`);
    stillEmpty++;
  } else if (DRY_RUN) {
    console.log(`✓ would recover ${abstract.length} chars`);
    recovered++;
  } else {
    const { error: upErr } = await sb
      .from("research_papers")
      .update({ abstract })
      .eq("id", p.id);
    if (upErr) {
      console.log(`✗ db: ${upErr.message?.slice(0, 60)}`);
      errored++;
    } else {
      console.log(`✓ recovered ${abstract.length} chars`);
      recovered++;
    }
  }
  // Pace politely
  await sleep(NCBI_KEY ? 100 : 1100);
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${recovered} recovered, ${stillEmpty} still empty, ${errored} errored.`);

try {
  await sb.from("scraper_runs").insert({
    source: "backfill_research_abstracts",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: recovered > 0 ? "success" : "empty",
    rows_added: recovered,
    notes: `${papers.length} checked · ${recovered} recovered · ${stillEmpty} still empty · ${errored} errored`,
  });
} catch { /* */ }
process.exit(0);
