#!/usr/bin/env node
/**
 * Scrape NY Assembly + Senate committee assignments.
 *
 * NY Assembly (nyassembly.gov/comm) is plain HTML — no Cloudflare.
 *   Index: /comm/ lists every committee with ?id=N
 *   Detail: /comm/?id=N has chair (.comm-chair-name) + members list
 *
 * NY Senate (nysenate.gov/committees) is Cloudflare-protected.
 *   Uses Playwright with CONSENT cookie (same pattern as resolve-news-urls.mjs).
 *
 * For each committee → row(s) in legislator_committees:
 *   - chair role flagged
 *   - is_kratom_relevant=true for committees in KRATOM_RELEVANT_NAMES
 *
 * Matches members to legislators table by full_name fuzzy match.
 *
 * Run:
 *   node --env-file=.env.local scripts/scrape-ny-committees.mjs
 *   node --env-file=.env.local scripts/scrape-ny-committees.mjs --chamber assembly
 *   node --env-file=.env.local scripts/scrape-ny-committees.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const DRY_RUN = args.includes("--dry-run");
const CHAMBER = arg("--chamber"); // 'assembly' | 'senate' | null = both

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Committees that handle kratom-relevant legislation. These produce chairs
// who matter. Edit as we learn the specific battlegrounds per state.
const KRATOM_RELEVANT_NAMES = new Set([
  "health", "mental health", "codes", "consumer affairs and protection",
  "consumer affairs", "alcoholism and substance abuse", "judiciary",
  "agriculture", "small business", "labor", "racing and wagering",
  // Senate equivalents (may differ in capitalization)
  "consumer protection", "investigations and government operations",
  "rules", "finance",
]);

function normalizeName(s) {
  return (s ?? "").toLowerCase()
    .replace(/\b(senator|assemblymember|assembly\s*member|representative|rep|sen|mr|mrs|ms|dr|hon)\.?\b/gi, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadStateLegislators(state) {
  let all = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data } = await sb.from("legislators")
      .select("id, full_name, role, district")
      .eq("state", state)
      .eq("active", true)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
  }
  const byNorm = new Map();
  for (const r of all) {
    const n = normalizeName(r.full_name);
    if (n) {
      // Prefer last-name + first-name lookup, but also store full match
      byNorm.set(n, r);
    }
  }
  return { all, byNorm };
}

function matchLegislator(rawName, legIndex) {
  const norm = normalizeName(rawName);
  if (!norm) return null;
  if (legIndex.byNorm.has(norm)) return legIndex.byNorm.get(norm);
  // Fuzzy: try last word + first word
  const parts = norm.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
    if (legIndex.byNorm.has(firstLast)) return legIndex.byNorm.get(firstLast);
    // Try last name only — best effort, may have collisions
    for (const r of legIndex.all) {
      const ln = normalizeName(r.full_name).split(" ").pop();
      if (ln && ln === parts[parts.length - 1] && parts[0].length >= 3) {
        // Verify first name initial matches at least
        const fn = normalizeName(r.full_name).split(" ")[0];
        if (fn && fn[0] === parts[0][0]) return r;
      }
    }
  }
  return null;
}

// ---------- NY Assembly scraper ----------
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseAssemblyIndex(html) {
  // <div class="comm-title"><a href="?id=19">Health</a></div>
  const rx = /<div\s+class="comm-title">\s*<a\s+href="\?id=(\d+)"[^>]*>([^<]+)<\/a>\s*<\/div>/g;
  const out = [];
  let m;
  while ((m = rx.exec(html))) {
    const id = m[1];
    const name = m[2].trim();
    out.push({ id, name });
  }
  return out;
}

function parseAssemblyDetail(html) {
  // Chair: <a class="comm-chair-name" href="/mem/X-Y"> Name</a>
  const chairMatch = html.match(/class="comm-chair-name"[^>]*>\s*([^<]+)<\/a>/);
  const chairName = chairMatch ? chairMatch[1].trim() : null;
  // Members list — within <ul class="comm-membership-list">
  const membersBlock = html.match(/<ul\s+class="comm-membership-list">([\s\S]*?)<\/ul>/);
  const memberNames = [];
  if (membersBlock) {
    const memberRx = /<a[^>]+href="\/mem\/[^"]+"[^>]*>\s*([^<]+)<\/a>/g;
    let mm;
    while ((mm = memberRx.exec(membersBlock[1]))) {
      const name = mm[1].trim();
      if (name) memberNames.push(name);
    }
  }
  return { chairName, memberNames };
}

async function scrapeAssembly(legIndex) {
  console.log("Scraping NY Assembly committees…");
  const indexHtml = await fetchHtml("https://nyassembly.gov/comm/");
  const committees = parseAssemblyIndex(indexHtml);
  console.log(`  found ${committees.length} committees on Assembly index`);

  const rows = [];
  let unmatched = 0;
  for (const c of committees) {
    process.stdout.write(`  ${c.name.padEnd(50)} `);
    let detailHtml;
    try {
      detailHtml = await fetchHtml(`https://nyassembly.gov/comm/?id=${c.id}`);
    } catch (e) {
      console.log(`✗ ${e.message?.slice(0, 40)}`);
      continue;
    }
    const { chairName, memberNames } = parseAssemblyDetail(detailHtml);
    const allNames = new Set();
    if (chairName) allNames.add(chairName);
    for (const n of memberNames) allNames.add(n);

    const committeeName = `Assembly ${c.name}`;
    const isKratomRelevant = KRATOM_RELEVANT_NAMES.has(c.name.toLowerCase());
    let chairMatched = 0, memberMatched = 0;

    for (const name of allNames) {
      const leg = matchLegislator(name, legIndex);
      if (!leg) { unmatched++; continue; }
      const role = chairName && normalizeName(chairName) === normalizeName(name) ? "chair" : "member";
      if (role === "chair") chairMatched++; else memberMatched++;
      rows.push({
        legislator_id: leg.id,
        committee_name: committeeName,
        chamber: "house",
        role,
        is_kratom_relevant: isKratomRelevant,
        session_id: "2025-2026",
      });
    }
    console.log(`✓ ${chairMatched}c+${memberMatched}m${isKratomRelevant ? " · KRATOM-RELEVANT" : ""}`);
    await sleep(300);
  }
  return { rows, unmatched };
}

// ---------- NY Senate scraper (Playwright, Cloudflare-protected) ----------
async function scrapeSenate(legIndex) {
  console.log("\nScraping NY Senate committees (via Playwright)…");
  let chromium;
  try {
    const pw = await import("playwright-chromium");
    chromium = pw.chromium;
  } catch {
    console.log("  ✗ playwright-chromium not installed; skipping Senate");
    return { rows: [], unmatched: 0 };
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ userAgent: UA });
  await ctx.addCookies([{
    name: "CONSENT", value: "YES+", domain: ".nysenate.gov",
    path: "/", expires: Math.floor(Date.now() / 1000) + 365 * 86400,
    httpOnly: false, secure: true, sameSite: "Lax",
  }]);
  const page = await ctx.newPage();

  // Index: nysenate.gov/committees
  await page.goto("https://www.nysenate.gov/committees", { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Wait for Cloudflare challenge to settle
  await sleep(5000);
  const committeeLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/committees/"]'))
      .map(a => ({ name: (a.textContent || "").trim(), url: a.href }))
      .filter(c => c.name && c.url && !/\/committees\/?$/.test(c.url))
  );
  console.log(`  found ${committeeLinks.length} committee links on Senate index`);
  if (committeeLinks.length === 0) {
    await browser.close();
    return { rows: [], unmatched: 0 };
  }

  // De-dup by URL
  const seenUrls = new Set();
  const committees = [];
  for (const c of committeeLinks) {
    if (seenUrls.has(c.url)) continue;
    seenUrls.add(c.url);
    committees.push(c);
  }
  console.log(`  ${committees.length} unique committees`);

  const rows = [];
  let unmatched = 0;
  for (const c of committees) {
    process.stdout.write(`  ${c.name.padEnd(50)} `);
    try {
      await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await sleep(1500);
      const detail = await page.evaluate(() => {
        // Senate page typically has Chair listed at top + members below.
        // Heuristic extraction.
        const text = document.body.innerText;
        const chairMatch = text.match(/(?:Chair|Chairperson)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
        const chair = chairMatch ? chairMatch[1] : null;
        const memberNames = Array.from(document.querySelectorAll('a[href*="/senators/"]'))
          .map(a => (a.textContent || "").trim())
          .filter(n => n && n.length > 4 && n.length < 60 && /\s/.test(n));
        return { chair, memberNames: [...new Set(memberNames)] };
      });
      const allNames = new Set();
      if (detail.chair) allNames.add(detail.chair);
      for (const n of detail.memberNames) allNames.add(n);
      const committeeName = `Senate ${c.name}`;
      const isKratomRelevant = KRATOM_RELEVANT_NAMES.has(c.name.toLowerCase());
      let chairMatched = 0, memberMatched = 0;
      for (const name of allNames) {
        const leg = matchLegislator(name, legIndex);
        if (!leg) { unmatched++; continue; }
        const role = detail.chair && normalizeName(detail.chair) === normalizeName(name) ? "chair" : "member";
        if (role === "chair") chairMatched++; else memberMatched++;
        rows.push({
          legislator_id: leg.id,
          committee_name: committeeName,
          chamber: "senate",
          role,
          is_kratom_relevant: isKratomRelevant,
          session_id: "2025-2026",
        });
      }
      console.log(`✓ ${chairMatched}c+${memberMatched}m${isKratomRelevant ? " · KRATOM-RELEVANT" : ""}`);
    } catch (e) {
      console.log(`✗ ${e.message?.slice(0, 40)}`);
    }
    await sleep(1500);
  }
  await browser.close();
  return { rows, unmatched };
}

// ---------- main ----------
const t0 = Date.now();
const legIndex = await loadStateLegislators("NY");
console.log(`Loaded ${legIndex.all.length} NY legislators for fuzzy matching\n`);

let allRows = [];
let totalUnmatched = 0;

if (!CHAMBER || CHAMBER === "assembly") {
  const a = await scrapeAssembly(legIndex);
  allRows.push(...a.rows);
  totalUnmatched += a.unmatched;
}

if (!CHAMBER || CHAMBER === "senate") {
  const s = await scrapeSenate(legIndex);
  allRows.push(...s.rows);
  totalUnmatched += s.unmatched;
}

console.log(`\nTotal rows: ${allRows.length} (matched), ${totalUnmatched} unmatched`);
console.log(`Kratom-relevant rows: ${allRows.filter(r => r.is_kratom_relevant).length}`);

if (!DRY_RUN && allRows.length > 0) {
  // Clear NY's existing rows for the current session, re-insert
  const { data: nyLegs } = await sb.from("legislators").select("id").eq("state", "NY").eq("active", true);
  const nyIds = (nyLegs ?? []).map(r => r.id);
  if (nyIds.length > 0) {
    const { error: delErr } = await sb.from("legislator_committees")
      .delete()
      .in("legislator_id", nyIds)
      .eq("session_id", "2025-2026");
    if (delErr) console.log("⚠ delete prior rows:", delErr.message);
  }
  // Insert in chunks
  for (let i = 0; i < allRows.length; i += 100) {
    const chunk = allRows.slice(i, i + 100);
    const { error } = await sb.from("legislator_committees").insert(chunk);
    if (error) {
      console.log(`✗ insert ${i}-${i+chunk.length}: ${error.message}`);
      break;
    }
  }
  console.log(`✓ wrote ${allRows.length} rows`);
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`Done in ${elapsed} min`);

try {
  await sb.from("scraper_runs").insert({
    source: "scrape_ny_committees",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: allRows.length === 0 ? "empty" : "success",
    rows_added: allRows.length,
    notes: `Assembly+Senate, ${totalUnmatched} unmatched names`,
  });
} catch { /* best-effort */ }

process.exit(0);
