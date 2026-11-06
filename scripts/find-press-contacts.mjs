#!/usr/bin/env node
/**
 * Find the address a story's writer or a paper's author printed, so members can
 * answer them (Media Persuasion). Only what's printed: see lib/press-contacts.mjs.
 *
 * Stories: reads the publisher's page once, falling back to the stored body when
 * the page refuses. Papers: PubMed's record, keyless, 100 per request.
 * writer_checked_at / author_checked_at mean nothing is read twice.
 *
 * Run:
 *   node --env-file=.env.local scripts/find-press-contacts.mjs --dry-run
 *   node --env-file=.env.local scripts/find-press-contacts.mjs --limit 150 --max-minutes 8
 */
import { createClient } from "@supabase/supabase-js";
import { findPaperAuthor, findWriter } from "./lib/press-contacts.mjs";

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const DRY = args.includes("--dry-run");
const LIMIT = arg("--limit", 150);
const DEADLINE = Date.now() + arg("--max-minutes", 8) * 60_000;
const RECENT_DAYS = 120;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; iKratomBot/1.0; +https://www.ikratom.org)" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? (await res.text()).slice(0, 2_000_000) : "";
  } catch {
    return "";
  }
}

async function save(row) {
  const { error } = await sb.from("press_contacts").insert(row);
  // 23505: the story already has one.
  if (error && error.code !== "23505") throw new Error(error.message);
}

let found = 0;
let checked = 0;
let failed = 0;

const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
const { data: stories, error: storyError } = await sb
  .from("news_items")
  .select("id, url, resolved_url, source_name, body_paragraphs")
  .eq("active", true)
  .is("writer_checked_at", null)
  .is("duplicate_of", null)
  .not("resolved_url", "is", null)
  .gte("published_at", since)
  .order("published_at", { ascending: false })
  .limit(LIMIT);
if (storyError) {
  console.error("Stories:", storyError.message);
  process.exit(1);
}

for (const story of stories ?? []) {
  if (Date.now() > DEADLINE) break;
  checked++;
  try {
    const html = await fetchPage(story.resolved_url);
    const writer = findWriter({
      html,
      paragraphs: story.body_paragraphs,
      url: story.resolved_url,
      sourceName: story.source_name,
    });
    if (writer) {
      found++;
      console.log(`  ${story.source_name}: ${writer.name ?? "(no name)"}`);
    }
    if (DRY) continue;
    if (writer) {
      await save({ kind: "reporter", news_item_id: story.id, outlet: story.source_name, ...writer });
    }
    await sb.from("news_items").update({ writer_checked_at: new Date().toISOString() }).eq("id", story.id);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${story.id}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}

const { data: papers } = await sb
  .from("research_papers")
  .select("id, pubmed_id, journal")
  .eq("is_active", true)
  .is("author_checked_at", null)
  .not("pubmed_id", "is", null)
  .order("publication_year", { ascending: false, nullsFirst: false })
  .limit(LIMIT);

for (let i = 0; i < (papers ?? []).length && Date.now() < DEADLINE; i += 100) {
  const batch = papers.slice(i, i + 100);
  const ids = batch.map((p) => p.pubmed_id).join(",");
  try {
    const res = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${ids}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok) throw new Error(`PubMed ${res.status}`);
    const xml = await res.text();
    const records = new Map(
      [...xml.matchAll(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g)].map((m) => [
        m[0].match(/<PMID[^>]*>(\d+)</)?.[1],
        m[0],
      ]),
    );
    for (const paper of batch) {
      const record = records.get(String(paper.pubmed_id));
      if (!record) continue; // Not returned this time, so it stays unchecked.
      checked++;
      const author = findPaperAuthor(record);
      if (author) {
        found++;
        console.log(`  ${paper.journal}: ${author.name ?? "(no name)"}`);
      }
      if (DRY) continue;
      if (author) await save({ kind: "researcher", paper_id: paper.id, outlet: paper.journal, ...author });
      await sb.from("research_papers").update({ author_checked_at: new Date().toISOString() }).eq("id", paper.id);
    }
  } catch (e) {
    failed++;
    console.log(`  ✗ PubMed batch: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1_000));
}

console.log(`Done. checked=${checked}, found=${found}, failed=${failed}${DRY ? " (DRY RUN)" : ""}`);

if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "find_press_contacts",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: checked === 0 ? "empty" : failed > checked / 2 ? "error" : "success",
      rows_added: found,
      notes: `${checked} checked, ${found} found, ${failed} failed`,
    });
  } catch { /* best-effort */ }
}

process.exit(0);
