#!/usr/bin/env node
/**
 * One-time (re-runnable) cleanup: deactivate news_items that are NOT actually
 * about kratom — the false positives that polluted /news, /states and the
 * briefings (an NBA player's kratom possession charge, a redistricting story
 * with a kratom link in its trending rail, a plane crash, college-hoops
 * scheduling, etc.).
 *
 * Two passes:
 *   PASS A (no network): re-screen active rows where body_has_kratom_keyword
 *     =false against the CURRENT scorer. The stored flag can be stale (set
 *     before a keyword like "gas station heroin" was added to the regex), so
 *     we do NOT trust it blindly. If kratom still isn't the subject → deactivate
 *     (these were still surfacing on `active`-only feeds: /states, bill and
 *     legislator pages). If the title/summary now DO make kratom the subject →
 *     rescue: flip the flag back to true so the article stops being hidden.
 *
 *   PASS B (--fetch): active rows where body_has_kratom_keyword=true but the
 *     title/summary/excerpt carry NO kratom-subject signal. The keyword likely
 *     leaked from a recirc widget the OLD extractor missed. Re-fetch the body
 *     with the hardened extractor and re-score with kratomRelevance; if kratom
 *     still isn't the subject, set body_has_kratom_keyword=false + deactivate.
 *
 * Dry-run by default. Nothing is written unless you pass --apply.
 *
 *   node --env-file=.env.local scripts/cleanup-news-relevance.mjs            # dry-run, PASS A report + PASS B candidate count
 *   node --env-file=.env.local scripts/cleanup-news-relevance.mjs --fetch    # dry-run, also re-checks PASS B bodies
 *   node --env-file=.env.local scripts/cleanup-news-relevance.mjs --fetch --apply   # write
 */
import { createClient } from "@supabase/supabase-js";
import { kratomRelevance, extractArticleBody } from "./lib/kratom-keywords.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes("--apply");
const FETCH = args.includes("--fetch");
const LIMIT = parseInt(arg("--limit") ?? "10000");
const PAGE = 500;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchAndExtract(url) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) throw new Error(`non-HTML`);
  const html = (await res.text()).slice(0, 1_048_576);
  return extractArticleBody(html);
}

console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN"}  fetch=${FETCH}\n`);

// ---------- PASS A: re-screen body=false rows ----------
let deactA = 0, rescueA = 0;
const sampleDeactA = [], sampleRescueA = [];
const deactIds = [], rescueIds = [];
{
  const { data, error } = await sb.from("news_items")
    .select("id, title, summary, state, body_extract_excerpt")
    .eq("active", true)
    .eq("body_has_kratom_keyword", false)
    // Never deactivate rows already curated into a bill or alert — that's
    // genuine linked coverage even if the keyword sits below our threshold.
    .is("policy_alert_id", null)
    .is("bill_id", null)
    .limit(LIMIT);
  if (error) { console.error("PASS A query:", error.message); process.exit(1); }
  for (const n of (data ?? [])) {
    const rel = kratomRelevance({ title: n.title, summary: n.summary, body: n.body_extract_excerpt ?? "" });
    if (rel.subject) {
      rescueA++; rescueIds.push(n.id);
      if (sampleRescueA.length < 12) sampleRescueA.push(`[${n.state ?? "?"}] ${n.title} — ${rel.reason}`);
    } else {
      deactA++; deactIds.push(n.id);
      if (sampleDeactA.length < 12) sampleDeactA.push(`[${n.state ?? "?"}] ${n.title}`);
    }
  }
  if (APPLY) {
    for (let i = 0; i < deactIds.length; i += 200) {
      const { error: uerr } = await sb.from("news_items").update({ active: false }).in("id", deactIds.slice(i, i + 200));
      if (uerr) console.error("PASS A deactivate:", uerr.message);
    }
    for (let i = 0; i < rescueIds.length; i += 200) {
      const { error: uerr } = await sb.from("news_items").update({ body_has_kratom_keyword: true }).in("id", rescueIds.slice(i, i + 200));
      if (uerr) console.error("PASS A rescue:", uerr.message);
    }
  }
}
console.log(`PASS A — body=false active rows re-screened:`);
console.log(`   deactivate (still not kratom): ${deactA}${APPLY ? " → deactivated" : " (would deactivate)"}`);
for (const s of sampleDeactA) console.log(`   · ${s}`);
if (deactA > 12) console.log(`   …and ${deactA - 12} more`);
console.log(`   rescue (stale-false, now subject): ${rescueA}${APPLY ? " → flag flipped true" : " (would rescue)"}`);
for (const s of sampleRescueA) console.log(`   ↑ ${s}`);
if (rescueA > 12) console.log(`   …and ${rescueA - 12} more`);

// ---------- PASS B: body=true but no subject signal ----------
console.log(`\nPASS B — body_has_kratom_keyword=true rows lacking a subject signal in title/summary/excerpt:`);
let bCandidates = 0, bDeactivated = 0, bKept = 0, bErrored = 0;
const sampleB = [];
let from = 0;
while (from < LIMIT) {
  const { data, error } = await sb.from("news_items")
    .select("id, title, summary, state, resolved_url, body_extract_excerpt")
    .eq("active", true)
    .eq("body_has_kratom_keyword", true)
    .is("policy_alert_id", null)
    .is("bill_id", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(from, from + PAGE - 1);
  if (error) { console.error("PASS B query:", error.message); break; }
  if (!data || data.length === 0) break;

  for (const n of data) {
    // Cheap pre-screen on what we already have. If kratom is clearly the
    // subject from title/summary/excerpt, leave it alone (no fetch).
    const relCheap = kratomRelevance({ title: n.title, summary: n.summary, body: n.body_extract_excerpt ?? "" });
    if (relCheap.subject) continue;

    bCandidates++;
    if (!FETCH) { if (sampleB.length < 15) sampleB.push(`[${n.state ?? "?"}] ${n.title}`); continue; }
    if (!n.resolved_url) { bErrored++; continue; }

    try {
      const body = await fetchAndExtract(n.resolved_url);
      const rel = kratomRelevance({ title: n.title, summary: n.summary, body });
      if (rel.subject) {
        bKept++;
        if (APPLY) {
          await sb.from("news_items").update({
            body_verified_at: new Date().toISOString(),
            body_extract_excerpt: body.slice(0, 500),
          }).eq("id", n.id);
        }
      } else {
        bDeactivated++;
        if (sampleB.length < 15) sampleB.push(`[${n.state ?? "?"}] ${n.title} — ${rel.reason}`);
        if (APPLY) {
          await sb.from("news_items").update({
            body_verified_at: new Date().toISOString(),
            body_has_kratom_keyword: false,
            active: false,
            body_extract_excerpt: body.slice(0, 500),
          }).eq("id", n.id);
        }
      }
      await sleep(1200);
    } catch (e) {
      bErrored++;
      if (process.env.DEBUG) console.log(`   ✗ ${n.title?.slice(0, 50)} — ${e.message}`);
    }
  }
  from += data.length;
  if (data.length < PAGE) break;
}

if (FETCH) {
  console.log(`   candidates re-fetched: ${bCandidates}  → deactivated=${bDeactivated} kept=${bKept} errored=${bErrored}${APPLY ? "" : " (dry-run, no writes)"}`);
} else {
  console.log(`   candidates needing a body re-check: ${bCandidates}  (re-run with --fetch to resolve)`);
}
for (const s of sampleB) console.log(`   · ${s}`);

console.log(`\n${APPLY ? "Applied." : "Dry-run complete — re-run with --apply (and --fetch) to write."}`);
process.exit(0);
