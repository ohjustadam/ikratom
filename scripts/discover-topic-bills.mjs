#!/usr/bin/env node
/**
 * discover-topic-bills.mjs — phase-2 multi-topic discovery.
 *
 * Finds NON-kratom substance-policy bills (cannabis, hemp/CBD, psychedelics,
 * dietary supplements, tobacco/vaping, alcohol) via LegiScan getSearch (national,
 * relevance-ranked) and upserts them into public.topic_bills (migration 0224) —
 * a table kept SEPARATE from public.bills so kratom surfaces stay clean.
 *
 * Free-tier: LegiScan key (LEGISCAN_API_KEY) allows ~30k queries/month; this
 * does ~maxPages calls per topic. Polite ~1.2s pacing. Self-heals (bad page
 * skipped). Telemetry: scraper_runs `topic_bill_discovery`.
 *
 *   node --env-file=.env.local scripts/discover-topic-bills.mjs --dry-run
 *   node --env-file=.env.local scripts/discover-topic-bills.mjs --topic=cannabis
 *   node --env-file=.env.local scripts/discover-topic-bills.mjs --force --max-pages=8
 */
import { createClient } from "@supabase/supabase-js";
import { runWithLogging } from "./lib/scraper-run.mjs";
import { TOPIC_SEARCH_QUERY, coarseStance } from "./lib/bill-topic-keywords.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : null; };
const DRY = flag("dry-run");
const FORCE = flag("force");
const ONLY_TOPIC = opt("topic");
const MAX_PAGES = parseInt(opt("max-pages") || "5", 10);
const MIN_RELEVANCE = parseInt(opt("min-relevance") || "50", 10);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LEGISCAN_KEY = process.env.LEGISCAN_API_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing Supabase env"); process.exit(1); }
if (!LEGISCAN_KEY) { console.error("Missing LEGISCAN_API_KEY"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function legiscanSearch(query, page) {
  const url = `https://api.legiscan.com/?key=${LEGISCAN_KEY}&op=getSearch&state=ALL&query=${encodeURIComponent(query)}&page=${page}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const json = await res.json();
  if (json.status !== "OK" || !json.searchresult) throw new Error(`legiscan status ${json.status}`);
  return json.searchresult;
}

async function recentlyRan() {
  if (FORCE) return false;
  const { data } = await sb.from("scraper_runs").select("finished_at").eq("source", "topic_bill_discovery").eq("status", "success").order("finished_at", { ascending: false }).limit(1);
  const last = data?.[0]?.finished_at;
  if (!last) return false;
  return (Date.now() - new Date(last).getTime()) / 86400000 < 6;
}

async function main() {
  if (await recentlyRan()) { log("topic_bill_discovery ran <6d ago — skipping (use --force)."); return; }
  const topics = ONLY_TOPIC ? [ONLY_TOPIC] : Object.keys(TOPIC_SEARCH_QUERY);
  log(`topic-bill discovery — ${DRY ? "DRY-RUN" : "LIVE"}; topics=${topics.join(",")}; maxPages=${MAX_PAGES}; minRel=${MIN_RELEVANCE}`);

  await runWithLogging({ source: "topic_bill_discovery", supabase: sb }, async () => {
    let upserted = 0, scanned = 0, lowRel = 0, failed = 0;
    const perTopic = {};
    for (const topic of topics) {
      const query = TOPIC_SEARCH_QUERY[topic];
      if (!query) { log(`  ! no search query for topic ${topic} — skipping`); continue; }
      let topicUp = 0;
      for (let page = 1; page <= MAX_PAGES; page++) {
        let sr;
        try { sr = await legiscanSearch(query, page); }
        catch (e) { log(`  ! ${topic} p${page}: ${String(e?.message ?? e).slice(0, 80)}`); failed++; break; }
        const pageTotal = sr.summary?.page_total ?? 1;
        const rows = Object.entries(sr).filter(([k]) => k !== "summary").map(([, v]) => v);
        const batch = [];
        for (const r of rows) {
          scanned++;
          if ((r.relevance ?? 0) < MIN_RELEVANCE) { lowRel++; continue; }
          if (!r.bill_id || !r.state || !r.bill_number) continue;
          batch.push({
            legiscan_bill_id: r.bill_id,
            topic,
            state: r.state,
            bill_number: r.bill_number,
            title: r.title ?? null,
            stance: coarseStance(r.title ?? ""),
            relevance: r.relevance ?? null,
            last_action: r.last_action ?? null,
            // LegiScan sometimes returns "0000-00-00" (no action yet); require a
            // real month/day so Postgres doesn't reject the batch.
            last_action_date: r.last_action_date && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(r.last_action_date) ? r.last_action_date : null,
            url: r.url ?? null,
            change_hash: r.change_hash ?? null,
            discovered_at: new Date().toISOString(),
          });
        }
        if (!DRY && batch.length > 0) {
          const { error } = await sb.from("topic_bills").upsert(batch, { onConflict: "legiscan_bill_id,topic" });
          if (error) { log(`  ! ${topic} p${page} upsert: ${error.message}`); failed++; }
          else { upserted += batch.length; topicUp += batch.length; }
        } else if (DRY) {
          upserted += batch.length; topicUp += batch.length;
        }
        if (page >= pageTotal) break;
        await sleep(1200); // polite LegiScan pacing
      }
      perTopic[topic] = topicUp;
      log(`  ${topic}: ${topicUp} bills (query "${query}")`);
      await sleep(1200);
    }
    const notes = `${DRY ? "dry-run " : ""}${upserted} upserted, ${scanned} scanned, ${lowRel} below-relevance, ${failed} failed | ${JSON.stringify(perTopic)}`;
    log(`\n${notes}`);
    return { rowsAdded: DRY ? 0 : upserted, rowsUpdated: 0, notes };
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
