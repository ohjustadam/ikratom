#!/usr/bin/env node
/**
 * extract-news-content.mjs — in-app news reading.
 *
 * Fetches the resolved publisher article for each classified kratom news
 * item and extracts a FAIR-USE lead excerpt (first few paragraphs) plus
 * embedded media (YouTube/Vimeo players, article images). Stores them on
 * news_items so /news/[id] can render the story in-app — letting users
 * read the lead + watch the video without leaving iKratom, with a clear
 * link out to the source for the full article.
 *
 * Copyright: we keep only a capped lead excerpt, never the full body,
 * and always attribute + link to the source. Media uses the publishers'
 * own embed URLs (shared as intended, not rehosted).
 *
 * Requires news_items.resolved_url (the real publisher URL after the
 * Playwright Google-News resolver runs). Items without it are skipped
 * until resolve-news-urls.mjs populates one.
 *
 * Cost: $0 — plain HTTP fetch + regex extraction, no AI.
 *
 * Run:
 *   node --env-file=.env.local scripts/extract-news-content.mjs
 *   node --env-file=.env.local scripts/extract-news-content.mjs --limit 40 --days 14
 *   node --env-file=.env.local scripts/extract-news-content.mjs --dry-run
 *   node --env-file=.env.local scripts/extract-news-content.mjs --refresh
 */
import { createClient } from "@supabase/supabase-js";
import { extractArticleContent } from "./lib/article-content.mjs";
import { renderPage, closeHeadless } from "./lib/headless-render.mjs";
import { fetchMsnArticleHtml } from "./lib/msn-content.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const REFRESH = args.includes("--refresh");
const LIMIT = parseInt(arg("--limit") ?? "40", 10);
const DAYS = parseInt(arg("--days") ?? "21", 10);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; iKratom-reader/1.0; +https://www.ikratom.org)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!/text\/html|xhtml/i.test(ct)) throw new Error(`non-HTML (${ct.slice(0, 40)})`);
  // Cap body read — articles are well under 2MB; avoids pathological pages.
  const text = await res.text();
  return text.slice(0, 2_000_000);
}

const t0 = Date.now();
console.log(`Extract-news-content${DRY ? " [DRY]" : ""}${REFRESH ? " [REFRESH]" : ""} — last ${DAYS}d, limit ${LIMIT}`);

const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
let q = sb
  .from("news_items")
  .select("id, title, resolved_url, url, source_name")
  .not("policy_classified_at", "is", null)
  .not("resolved_url", "is", null)
  .is("duplicate_of", null)
  .eq("active", true)
  .not("body_has_kratom_keyword", "is", false)
  .gte("scraped_at", since)
  .order("published_at", { ascending: false, nullsFirst: false })
  .limit(LIMIT);
if (!REFRESH) q = q.is("body_extracted_at", null);
const { data: items, error } = await q;
if (error) { console.error("query failed:", error.message); process.exit(1); }
console.log(`  ${items.length} article(s) to extract`);

let processed = 0, withBody = 0, withMedia = 0, failed = 0;

for (const item of items) {
  const target = item.resolved_url || item.url;
  let html = null;
  let fetchErr = null;
  // MSN pages defeat fetch AND headless render, but their content API is
  // public + keyless (lib/msn-content.mjs) — try it first for msn.com URLs.
  html = await fetchMsnArticleHtml(target);
  if (!html) {
    try {
      html = await fetchHtml(target);
    } catch (e) {
      fetchErr = e;
    }
  }

  let { paragraphs, media } = html ? extractArticleContent(html, target) : { paragraphs: [], media: [] };

  // Headless fallback (PR-B): MSN-class pages serve a JS shell to plain
  // fetch — zero paragraphs. Real Chromium renders the article; degrades to
  // null where Chromium isn't available.
  let rendered = false;
  if (paragraphs.length === 0) {
    const r = await renderPage(target);
    if (r?.html) {
      ({ paragraphs, media } = extractArticleContent(r.html, target));
      rendered = paragraphs.length > 0;
    }
  }

  if (!html && !rendered) {
    console.log(`  ✗ ${item.id.slice(0, 8)} fetch failed (${fetchErr?.message?.slice(0, 50)}) — retry next run`);
    failed++;
    continue; // don't stamp — transient; retry
  }
  const nVideos = media.filter((m) => m.type !== "image").length;
  const nImages = media.filter((m) => m.type === "image").length;
  if (paragraphs.length > 0) withBody++;
  if (media.length > 0) withMedia++;
  console.log(`  ${item.id.slice(0, 8)} "${(item.title ?? "").slice(0, 48)}" → ${paragraphs.length}¶ · ${nVideos} video · ${nImages} img${rendered ? " · ⚙ rendered" : ""}`);

  if (DRY) { processed++; continue; }

  const { error: upErr } = await sb.from("news_items").update({
    body_paragraphs: paragraphs.length > 0 ? paragraphs : null,
    media_urls: media.length > 0 ? media : null,
    body_extracted_at: new Date().toISOString(),
  }).eq("id", item.id);
  if (upErr) { console.log(`     ⚠ update failed: ${upErr.message?.slice(0, 80)}`); failed++; continue; }
  processed++;

  // polite pacing between publisher fetches
  await new Promise((r) => setTimeout(r, 800));
}

await closeHeadless();
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — processed ${processed}, with-excerpt ${withBody}, with-media ${withMedia}, failed ${failed}.`);

if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "extract_news_content",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: failed > 0 && processed === 0 ? "error" : processed === 0 ? "empty" : "success",
      rows_updated: processed,
      notes: `processed ${processed} · excerpt ${withBody} · media ${withMedia} · failed ${failed}`,
    });
  } catch { /* best-effort */ }
}
