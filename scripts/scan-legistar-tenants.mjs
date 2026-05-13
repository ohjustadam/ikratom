#!/usr/bin/env node
/**
 * Proactive scan of major-city Legistar tenants for kratom-relevant
 * agenda items. Parallel to scan-granicus-tenants.mjs.
 *
 * Strategy per tenant:
 *   1. Fetch Calendar.aspx → list of upcoming meetings
 *   2. Extract MeetingDetail.aspx links
 *   3. For each meeting, fetch detail page + check kratom keywords
 *   4. Hits land in municipal_meetings as pending_review
 *
 * Legistar pages are ASP.NET WebForms with __VIEWSTATE — but the
 * Calendar.aspx default view is static HTML accessible to plain GET.
 *
 * Rate-limited at ~1 req/sec per tenant to be polite.
 *
 * Run:
 *   node --env-file=.env.local scripts/scan-legistar-tenants.mjs
 *   node --env-file=.env.local scripts/scan-legistar-tenants.mjs --dry-run
 *   node --env-file=.env.local scripts/scan-legistar-tenants.mjs --tenant chicago
 */
import { createClient } from "@supabase/supabase-js";
import { hasKratomKeyword } from "./lib/kratom-keywords.mjs";
import { LEGISTAR_TENANTS } from "./lib/legistar-tenants.mjs";

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

// Extract MeetingDetail.aspx links from a Legistar Calendar.aspx page.
// Legistar lists meetings in a Telerik RadGrid; agenda links look like:
//   <a href="MeetingDetail.aspx?ID=12345&GUID=...&...">Meeting details</a>
// or as absolute URLs.
function extractMeetingLinks(html, base) {
  const links = new Set();
  const rx = /href=["']([^"']*MeetingDetail\.aspx\?[^"']+)["']/gi;
  let m;
  while ((m = rx.exec(html))) {
    let href = m[1].replace(/&amp;/g, "&");
    if (!/^https?:/.test(href)) {
      href = href.startsWith("/") ? `${base}${href}` : `${base}/${href}`;
    }
    links.add(href);
  }
  return [...links];
}

// Extract row context near a MeetingDetail.aspx href so we can read
// the meeting date from the row.
function extractRowContext(html, agendaUrl) {
  const escaped = agendaUrl.replace(/&/g, "&amp;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`<tr[^>]*>([\\s\\S]{0,4000}?${escaped}[\\s\\S]{0,1500}?)<\\/tr>`, "i");
  const m = html.match(rx);
  return m ? stripHtml(m[1]) : null;
}

function parseDateFromRow(rowText) {
  if (!rowText) return null;
  // "5/12/2026 6:00 PM"
  const shortRx = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i;
  const sm = rowText.match(shortRx);
  if (sm) {
    let hour = sm[4] ? parseInt(sm[4], 10) : 18;
    const mm = sm[5] ? parseInt(sm[5], 10) : 0;
    if (sm[6]?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (sm[6]?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return new Date(parseInt(sm[3]), parseInt(sm[1]) - 1, parseInt(sm[2]), hour, mm);
  }
  // "May 12, 2026"
  const longRx = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i;
  const lm = rowText.match(longRx);
  if (lm) {
    const months = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
    const monthIdx = months[lm[1].toLowerCase()];
    let hour = lm[4] ? parseInt(lm[4], 10) : 18;
    const mm = lm[5] ? parseInt(lm[5], 10) : 0;
    if (lm[6]?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (lm[6]?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return new Date(parseInt(lm[3]), monthIdx, parseInt(lm[2]), hour, mm);
  }
  return null;
}

function findKratomExcerpt(html) {
  const stripped = stripHtml(html);
  if (!hasKratomKeyword(stripped)) return null;
  const idx = stripped.toLowerCase().search(/(kratom|mitragyn|7[- ]?oh|gas[- ]?station\s+(?:drug|heroin|opioid)|tianeptine)/i);
  return stripped.slice(Math.max(0, idx - 200), idx + 600);
}

async function scanTenant(tenant) {
  process.stdout.write(`  ${tenant.locality.padEnd(28)} `);

  const listHtml = await fetchText(tenant.calendarUrl);
  if (!listHtml) {
    console.log(`✗ calendar 404/timeout`);
    return { tenant: tenant.subdomain, status: "list_404" };
  }
  // Derive base host
  const baseMatch = tenant.calendarUrl.match(/^(https?:\/\/[^/]+)/i);
  const base = baseMatch ? baseMatch[1] : tenant.calendarUrl;

  const links = extractMeetingLinks(listHtml, base).slice(0, 30);
  if (links.length === 0) {
    console.log(`· no meeting links found`);
    return { tenant: tenant.subdomain, status: "no_links" };
  }

  let scanned = 0, hits = 0, inserted = 0;
  for (const meetingUrl of links) {
    const html = await fetchText(meetingUrl);
    scanned++;
    if (!html) { await sleep(800); continue; }

    const excerpt = findKratomExcerpt(html);
    if (!excerpt) { await sleep(800); continue; }

    hits++;
    const rowText = extractRowContext(listHtml, meetingUrl);
    const meetingAt = parseDateFromRow(rowText);

    if (!meetingAt || meetingAt.getTime() < Date.now() - 86_400_000) {
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
      agenda_url: meetingUrl,
      agenda_text: excerpt.slice(0, 4000),
      discovered_via: "legistar_scan",
      source_url: meetingUrl,
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
  ? LEGISTAR_TENANTS.filter((t) => t.subdomain === TENANT_FILTER)
  : LEGISTAR_TENANTS;

if (targets.length === 0) {
  console.error(`No matching tenant: ${TENANT_FILTER}`);
  process.exit(1);
}

console.log(`Scanning ${targets.length} Legistar tenant(s)${DRY_RUN ? " [DRY RUN]" : ""}…\n`);
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
  await sleep(1500);
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${totalHits} kratom mentions across ${targets.length} tenants, ${totalInserted} new meetings.`);

try {
  await sb.from("scraper_runs").insert({
    source: "scan_legistar_tenants",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: totalInserted > 0 ? "success" : "empty",
    rows_added: totalInserted,
    notes: `${targets.length} tenants · ${totalHits} hits · ${totalInserted} new`,
  });
} catch { /* best-effort */ }
process.exit(0);
