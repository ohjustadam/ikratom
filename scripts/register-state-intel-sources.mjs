#!/usr/bin/env node
/**
 * Intel step 1, every state (private/plans/INTEL_DEEPER_PLAN.md): verify and
 * register each state's agency newsrooms (health department, attorney
 * general) and its state register / notice-of-intent page as bop_sources, so
 * the existing BoP chain (scrape -> PDF parse -> AI classify -> alert) watches
 * them. Oklahoma got this by hand on 2026-10-21; this does the other 50.
 *
 * Candidates live in scripts/data/state-intel-sources.json. For each one:
 *   1. fetch the URL the way generic_html does; it passes when the page is
 *      HTML and yields >= MIN_CANDIDATES findings-to-be;
 *   2. otherwise, fetch the agency homepage and try the links whose text reads
 *      like a newsroom ("press releases") or a register ("notice of intent");
 *   3. otherwise, with --browser, retry both through Playwright, and register
 *      a pass with adapter playwright_browser.
 * Only official state domains are accepted (.gov, or a state .us domain).
 *
 * Verify from GitHub Actions, not the owner's PC: several state WAFs answer a
 * home IP and 403 a datacenter one, and GHA is where the daily scrape runs.
 * .github/workflows/intel-sources-verify.yml does that and uploads the report.
 *
 *   node --env-file=.env.local scripts/register-state-intel-sources.mjs                  # dry run, all
 *   node --env-file=.env.local scripts/register-state-intel-sources.mjs --states LA,MS   # subset
 *   node --env-file=.env.local scripts/register-state-intel-sources.mjs --browser --apply --report out.json
 *
 * --apply inserts passing sources (skipping any state+URL already present)
 * with last_finding_count NULL, which tells the engine the first walk is a
 * baseline (backlog), so nothing on it auto-publishes (migration 0279).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { extractFindingsFromHtml } from "./lib/bop-adapters/_html_extract.mjs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const APPLY = has("--apply");
const BROWSER = has("--browser");
const ONLY = arg("--states")?.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const REPORT = arg("--report");
const MIN_CANDIDATES = 8;

const CANDIDATES = JSON.parse(readFileSync(new URL("./data/state-intel-sources.json", import.meta.url), "utf8"));

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

function isOfficialStateHost(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (new URL(url).protocol !== "https:" && new URL(url).protocol !== "http:") return false;
    return h.endsWith(".gov") || /(^|\.)(state\.)?[a-z]{2}\.us$/.test(h);
  } catch {
    return false;
  }
}

// Link text that reads like the page we want, per source kind.
const DISCOVER_RE = {
  news: /\b(press\s+releases?|news\s+releases?|newsroom|news\s*(?:&|and)\s*(?:media|announcements|events|updates)|media\s+(?:center|room|releases)|^news$|latest\s+news)\b/i,
  rule_proposal: /\b([a-z]+\s+register(?!\s+(?:a|an|your|to|for)\b)|register\s+of\s+(?:regulations|rules|administrative)|(?:administrative|state)\s+(?:bulletin|monthly)|notices?\s+of\s+(?:intent|proposed|rulemaking)|proposed\s+(?:rules?|regulations)|rulemaking\s+notices?|emergency\s+rules?)\b/i,
};
// "State Register", "register of regulations", but not "register a business"
// or "voter register". A single article (a year in its path) is never a feed.
const DISCOVER_SKIP_RE = /\b(vote|voter|election|ballot|business|vehicle|auto|motorcycle|boat|trademark|lobbyist|notary)\b/i;
const ARTICLE_PATH_RE = /\/20\d\d\/|\d{4}-\d{2}-\d{2}|[-_]20\d\d[-_./]/;

async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!/text\/html|xhtml|application\/xml/i.test(ct)) throw new Error(`content-type ${ct || "none"}`);
  return { html: await res.text(), finalUrl: res.url || url };
}

let browser = null;
async function fetchHtmlBrowser(url) {
  if (!browser) {
    const { chromium } = await import("playwright-chromium");
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  }
  const ctx = await browser.newContext({ userAgent: HEADERS["User-Agent"], locale: "en-US" });
  try {
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (resp && resp.status() >= 400) throw new Error(`HTTP ${resp.status()}`);
    await page.waitForTimeout(1500);
    return { html: await page.content(), finalUrl: page.url() };
  } finally {
    await ctx.close();
  }
}

const SOFT_404_URL_RE = /(?:^|[/_-])(?:404|error|not[-_]?found|pagenotfound)(?:[/_.-]|$)|aspxerrorpath/i;
const SOFT_404_TITLE_RE = /\b(?:404|page not found|not found|error)\b/i;

// A deep link that lands on the site root is a moved page, not a newsroom.
const isHomePath = (u) => /^\/(?:(?:pages\/)?(?:home|default|index)\.(?:aspx?|html?|php))?$/i.test(new URL(u).pathname);

async function probe(url, viaBrowser) {
  try {
    const { html, finalUrl } = viaBrowser ? await fetchHtmlBrowser(url) : await fetchHtml(url);
    if (!isOfficialStateHost(finalUrl)) return { ok: false, error: `redirected off a state domain: ${finalUrl}` };
    if (!isHomePath(url) && isHomePath(finalUrl)) return { ok: false, error: `redirected to the homepage: ${finalUrl}`, html, url: finalUrl };
    // A soft 404: HTTP 200 on an error page that still has a full site menu
    // (AK law.alaska.gov/404error.html, NV ag.nv.gov/error.aspx, 2026-10-24).
    const pageTitle = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
    if (SOFT_404_URL_RE.test(finalUrl) || SOFT_404_TITLE_RE.test(pageTitle)) {
      return { ok: false, error: `error page: ${finalUrl} "${pageTitle.slice(0, 60)}"` };
    }
    const n = extractFindingsFromHtml(html, finalUrl).length;
    return n >= MIN_CANDIDATES
      ? { ok: true, url: finalUrl, candidates: n, html }
      : { ok: false, error: `only ${n} links/headings`, html };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}

// Discovery reads raw anchors: the findings extractor drops <nav> and
// <footer>, which is exactly where a site links its newsroom.
function rawAnchors(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    if (!title || title.length > 80) continue;
    try { out.push({ title, url: new URL(m[1], baseUrl).href }); } catch { /* skip */ }
  }
  return out;
}

function discoveryLinks(html, baseUrl, kind) {
  const re = DISCOVER_RE[kind] ?? DISCOVER_RE.news;
  const base = new URL(baseUrl);
  const out = [];
  for (const f of rawAnchors(html, baseUrl)) {
    if (!re.test(f.title) || DISCOVER_SKIP_RE.test(f.title)) continue;
    try {
      const u = new URL(f.url);
      if (ARTICLE_PATH_RE.test(u.pathname)) continue;
      if (!isOfficialStateHost(u.href) || /\.pdf$/i.test(u.pathname)) continue;
      // same organization: share the registrable tail (e.g. *.texas.gov)
      const tail = (h) => h.split(".").slice(-2).join(".");
      if (tail(u.hostname) !== tail(base.hostname)) continue;
      u.hash = "";
      if (!out.includes(u.href)) out.push(u.href);
    } catch { /* skip */ }
  }
  return out.slice(0, 4);
}

async function verify(c) {
  const tries = [];
  const attempt = async (url, via) => {
    const r = await probe(url, via === "browser");
    tries.push(`${via}:${url} → ${r.ok ? `ok (${r.candidates})` : r.error}`);
    return r.ok ? { ...r, via } : null;
  };
  const lanes = BROWSER ? ["fetch", "browser"] : ["fetch"];
  for (const lane of lanes) {
    if (c.url && isOfficialStateHost(c.url)) {
      const r = await attempt(c.url, lane);
      if (r) return { status: lane === "fetch" ? "verified" : "verified-browser", ...r, tries };
    }
    if (c.homepage && isOfficialStateHost(c.homepage)) {
      const home = await probe(c.homepage, lane === "browser");
      if (home.html) {
        for (const link of discoveryLinks(home.html, home.url ?? c.homepage, c.kind)) {
          const r = await attempt(link, lane);
          if (r) return { status: lane === "fetch" ? "discovered" : "discovered-browser", ...r, tries };
        }
      } else {
        tries.push(`${lane}:home ${c.homepage} → ${home.error}`);
      }
    }
  }
  return { status: "failed", tries };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const todo = CANDIDATES.filter((c) => !ONLY || ONLY.includes(c.state));
console.log(`Verifying ${todo.length} candidate source(s)${BROWSER ? " (browser fallback on)" : ""}…`);
const results = await pool(todo, BROWSER ? 3 : 6, async (c) => {
  const r = await verify(c);
  const line = r.status === "failed" ? `✗ ${c.state} ${c.board_name} · ${c.surface}` : `✓ ${c.state} ${c.board_name} · ${c.surface} [${r.status}, ${r.candidates}] ${r.url}`;
  console.log(line);
  if (r.status === "failed") for (const t of r.tries) console.log(`    ${t}`);
  return { ...c, result: { status: r.status, url: r.url ?? null, via: r.via ?? null, candidates: r.candidates ?? 0, tries: r.tries } };
});
if (browser) await browser.close();

const passed = results.filter((r) => r.result.status !== "failed");
const byState = {};
for (const r of results) {
  byState[r.state] ??= { ok: 0, failed: 0 };
  byState[r.state][r.result.status === "failed" ? "failed" : "ok"]++;
}
console.log(`\n${passed.length}/${results.length} passed.`);
console.log(Object.entries(byState).map(([s, v]) => `${s} ${v.ok}/${v.ok + v.failed}`).join(" · "));

let inserted = 0;
if (APPLY && passed.length) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: existing, error } = await sb.from("bop_sources").select("state, agenda_url, board_name, surface");
  if (error) throw new Error(`bop_sources read failed: ${error.message}`);
  const seen = new Set((existing ?? []).flatMap((s) => [`${s.state}|${s.agenda_url}`, `${s.state}|${s.board_name}|${s.surface}`]));
  const today = new Date().toISOString().slice(0, 10);
  const runner = process.env.GITHUB_ACTIONS ? "GitHub Actions" : "a local run";
  const rows = passed
    .filter((r) => !seen.has(`${r.state}|${r.result.url}`) && !seen.has(`${r.state}|${r.board_name}|${r.surface}`))
    .map((r) => ({
      state: r.state,
      board_name: r.board_name,
      surface: r.surface,
      kind: r.kind,
      agenda_url: r.result.url,
      adapter: r.result.via === "browser" ? "playwright_browser" : "generic_html",
      enabled: true,
      last_finding_count: null, // first walk = baseline (0279)
      notes: `Intel step 1 (${today}): ${r.result.status} from ${runner}, ${r.result.candidates} links.${r.notes ? ` ${r.notes}` : ""}`,
    }));
  if (rows.length) {
    const { data, error: insErr } = await sb.from("bop_sources").insert(rows).select("id");
    if (insErr) throw new Error(`bop_sources insert failed: ${insErr.message}`);
    inserted = data?.length ?? 0;
  }
  console.log(`Inserted ${inserted} new source(s); ${passed.length - rows.length} already present.`);
}

if (REPORT) {
  writeFileSync(REPORT, JSON.stringify({ at: new Date().toISOString(), apply: APPLY, inserted, byState, results }, null, 2));
  console.log(`Report → ${REPORT}`);
}
