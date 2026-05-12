#!/usr/bin/env node
/**
 * Proactively scan major-city Granicus tenants for upcoming meetings
 * with kratom-relevant agenda items. Complements Gemini-grounded
 * discovery — Gemini covers anywhere on the web but with limited recall;
 * this directly hits each tenant's ViewPublisher and is exhaustive.
 *
 * Strategy per tenant:
 *   1. Fetch /ViewPublisher.php?view_id=N → list of upcoming clip_ids/event_ids
 *   2. For each item with an agenda link, fetch GeneratedAgendaViewer.php
 *   3. Run kratom keyword check on the text body
 *   4. If hit, insert into municipal_meetings as pending_review
 *
 * Free: just static HTTP fetches. Rate-limited at ~1 req/sec per tenant
 * to be polite. Skips tenants that 404 (deprecated subdomains).
 *
 * Tenants list is small (top 25 highest-leverage US cities/counties).
 * Owner can edit GRANICUS_TENANTS in scripts/lib/granicus-tenants.mjs.
 *
 * Run:
 *   node --env-file=.env.local scripts/scan-granicus-tenants.mjs
 *   node --env-file=.env.local scripts/scan-granicus-tenants.mjs --dry-run
 *   node --env-file=.env.local scripts/scan-granicus-tenants.mjs --tenant lacity
 */
import { createClient } from "@supabase/supabase-js";
import { hasKratomKeyword } from "./lib/kratom-keywords.mjs";
import { GRANICUS_TENANTS } from "./lib/granicus-tenants.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const TENANT_FILTER = arg("--tenant");
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripHtml(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// Extract upcoming agenda links from ViewPublisher.php
// Granicus list pages use rows like:
//   <a href="AgendaViewer.php?view_id=2&event_id=1234">Agenda</a>
//   <a href="GeneratedAgendaViewer.php?view_id=2&clip_id=5678">Agenda</a>
function extractAgendaLinks(html, base) {
  const links = new Set();
  const rx = /href=["']([^"']*(?:AgendaViewer|GeneratedAgendaViewer|MetaViewer)\.php\?[^"']+)["']/gi;
  let m;
  while ((m = rx.exec(html))) {
    let href = m[1];
    if (!/^https?:/.test(href)) {
      href = href.startsWith("/") ? `${base}${href}` : `${base}/${href}`;
    }
    links.add(href);
  }
  return [...links];
}

// Extract title/date around an agenda link by walking surrounding row text
function extractRowContext(html, agendaUrl) {
  // Find the row containing this href, take ~500 chars of surrounding text
  const escaped = agendaUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`<tr[^>]*>([\\s\\S]{0,3000}?${escaped}[\\s\\S]{0,1000}?)<\\/tr>`, "i");
  const m = html.match(rx);
  if (m) return stripHtml(m[1]);
  return null;
}

// Try to parse a "month dd, yyyy [hh:mm]" style date out of a row
function parseDateFromRow(rowText) {
  if (!rowText) return null;
  // "May 12, 2026 6:00 PM"
  const longRx = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i;
  const m = rowText.match(longRx);
  if (m) {
    const months = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
    const monthIdx = months[m[1].toLowerCase()];
    const dd = parseInt(m[2], 10);
    const yyyy = parseInt(m[3], 10);
    let hour = m[4] ? parseInt(m[4], 10) : 18;  // default 6 PM
    const mm = m[5] ? parseInt(m[5], 10) : 0;
    if (m[6]?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (m[6]?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return new Date(yyyy, monthIdx, dd, hour, mm);
  }
  // "5/12/2026"
  const shortRx = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i;
  const sm = rowText.match(shortRx);
  if (sm) {
    let hour = sm[4] ? parseInt(sm[4], 10) : 18;
    const mm = sm[5] ? parseInt(sm[5], 10) : 0;
    if (sm[6]?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (sm[6]?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return new Date(parseInt(sm[3]), parseInt(sm[1]) - 1, parseInt(sm[2]), hour, mm);
  }
  return null;
}

// Returns the kratom-relevant excerpt or null
function findKratomExcerpt(html) {
  const stripped = stripHtml(html);
  if (!hasKratomKeyword(stripped)) return null;
  const idx = stripped.toLowerCase().search(/(kratom|mitragyn|7[- ]?oh|gas[- ]?station\s+(?:drug|heroin|opioid)|tianeptine)/i);
  return stripped.slice(Math.max(0, idx - 200), idx + 600);
}

async function scanTenant(tenant) {
  const base = `https://${tenant.subdomain}.granicus.com`;
  const listUrl = `${base}/ViewPublisher.php?view_id=${tenant.viewId ?? 1}`;
  process.stdout.write(`  ${tenant.subdomain.padEnd(18)} `);

  const listHtml = await fetchText(listUrl);
  if (!listHtml) {
    console.log(`✗ list 404/timeout`);
    return { tenant: tenant.subdomain, status: "list_404" };
  }
  const links = extractAgendaLinks(listHtml, base).slice(0, 40);  // cap per tenant
  if (links.length === 0) {
    console.log(`· no agenda links found`);
    return { tenant: tenant.subdomain, status: "no_links" };
  }

  let scanned = 0, hits = 0, inserted = 0;
  for (const agendaUrl of links) {
    // GeneratedAgendaViewer is the static-text version
    const viewerUrl = agendaUrl.replace(/AgendaViewer\.php/i, "GeneratedAgendaViewer.php");
    const html = await fetchText(viewerUrl);
    scanned++;
    if (!html) { await sleep(800); continue; }

    const excerpt = findKratomExcerpt(html);
    if (!excerpt) { await sleep(800); continue; }

    hits++;
    const rowText = extractRowContext(listHtml, agendaUrl);
    const meetingAt = parseDateFromRow(rowText);

    if (!meetingAt || meetingAt.getTime() < Date.now() - 86_400_000) {
      // skip past or undated meetings
      await sleep(800);
      continue;
    }

    if (DRY_RUN) {
      console.log(`\n    🎯 HIT (dry-run): ${tenant.locality} · ${meetingAt.toISOString()}`);
      console.log(`        ${excerpt.slice(0, 200)}…`);
      await sleep(800);
      continue;
    }

    const { error } = await sb.from("municipal_meetings").insert({
      state: tenant.state,
      locality: tenant.locality,
      body_name: tenant.body ?? null,
      meeting_at: meetingAt.toISOString(),
      format: "hybrid",
      agenda_url: agendaUrl,
      agenda_text: excerpt.slice(0, 4000),
      discovered_via: "granicus_scan",
      source_url: agendaUrl,
      ai_confidence: 0.9,
      kratom_relevance: "confirmed",
      moderation_status: "pending_review",
    });
    if (error && error.code !== "23505") {
      console.log(`\n    ✗ DB: ${error.message?.slice(0, 100)}`);
    } else if (!error) {
      inserted++;
    }
    await sleep(800);
  }
  console.log(`✓ ${scanned} scanned, ${hits} hits, ${inserted} new`);
  return { tenant: tenant.subdomain, status: "ok", scanned, hits, inserted };
}

// ---------- main ----------
const targets = TENANT_FILTER
  ? GRANICUS_TENANTS.filter((t) => t.subdomain === TENANT_FILTER)
  : GRANICUS_TENANTS;

if (targets.length === 0) {
  console.error(`No matching tenant: ${TENANT_FILTER}`);
  process.exit(1);
}

console.log(`Scanning ${targets.length} Granicus tenant(s)${DRY_RUN ? " [DRY RUN]" : ""}…\n`);
const t0 = Date.now();
let totalInserted = 0;
let totalHits = 0;
const results = [];
for (const tenant of targets) {
  const r = await scanTenant(tenant);
  results.push(r);
  if (r.status === "ok") {
    totalHits += r.hits ?? 0;
    totalInserted += r.inserted ?? 0;
  }
  await sleep(1500);  // gentle pacing between tenants
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${totalHits} kratom mentions across ${targets.length} tenants, ${totalInserted} new meetings.`);

try {
  await sb.from("scraper_runs").insert({
    source: "scan_granicus_tenants",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: totalInserted > 0 ? "success" : "empty",
    rows_added: totalInserted,
    notes: `${targets.length} tenants · ${totalHits} hits · ${totalInserted} new`,
  });
} catch { /* best-effort */ }
process.exit(0);
