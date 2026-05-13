#!/usr/bin/env node
/**
 * Fetch a Legistar meeting/agenda by URL and extract:
 *   - kratom-relevant agenda items
 *   - meeting datetime
 *   - body name
 *
 * Legistar runs the NYC City Council, SF Board of Supervisors, LA
 * County, Philadelphia, San Antonio, and ~500 other US cities + large
 * counties. Each tenant runs on a city-specific subdomain:
 *   nyc.legistar.com, sfgov.legistar.com, la.legistar.com, etc.
 *
 * URL patterns supported:
 *   {tenant}.legistar.com/MeetingDetail.aspx?ID=N&GUID=...
 *   {tenant}.legistar.com/Calendar.aspx           (list page)
 *   {tenant}.legistar.com/LegislationDetail.aspx?ID=N  (bill/intro)
 *
 * Output: prints structured data OR upserts into municipal_meetings.
 *
 * Run:
 *   node --env-file=.env.local scripts/fetch-legistar-agenda.mjs <url>
 *   node --env-file=.env.local scripts/fetch-legistar-agenda.mjs <url> --dry-run
 *   node --env-file=.env.local scripts/fetch-legistar-agenda.mjs <url> --state NY --locality "New York, NY"
 */
import { createClient } from "@supabase/supabase-js";
import { hasKratomKeyword } from "./lib/kratom-keywords.mjs";

const args = process.argv.slice(2);
const URL_ARG = args.find((a) => /^https?:\/\//.test(a));
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const STATE = arg("--state");
const LOCALITY = arg("--locality");
const DRY_RUN = args.includes("--dry-run");

if (!URL_ARG) {
  console.error("Usage: <legistar-url> [--state XX] [--locality 'City, ST'] [--dry-run]");
  process.exit(1);
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = (SB_URL && SB_KEY)
  ? createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })
  : null;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function stripHtml(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Legistar agenda rows live inside an ASP.NET GridView. The class
// typically is rgRow or rgAltRow (Telerik RadGrid). Item title
// appears in one <td>, file # in another, description in a third.
function extractKratomItems(html) {
  const items = [];

  // Pattern A: Telerik RadGrid rows (the standard Legistar grid)
  const rowRx = /<tr\b[^>]*class="[^"]*\b(?:rgRow|rgAltRow)\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRx.exec(html))) {
    const rowText = stripHtml(m[1]);
    if (hasKratomKeyword(rowText)) {
      // Try to pull the first cell as title (file #) and concat into excerpt
      const cells = [];
      const cellRx = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
      let c;
      while ((c = cellRx.exec(m[1]))) {
        cells.push(stripHtml(c[1]).slice(0, 200));
      }
      const fileNo = cells[1] ?? cells[0] ?? "(item)";
      items.push({
        title: fileNo.slice(0, 100),
        excerpt: rowText.slice(0, 600),
      });
    }
  }

  // Pattern B (fallback): any <tr> containing kratom keywords
  if (items.length === 0) {
    const anyRowRx = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    while ((m = anyRowRx.exec(html))) {
      const rowText = stripHtml(m[1]);
      if (hasKratomKeyword(rowText)) {
        items.push({ title: "(agenda row)", excerpt: rowText.slice(0, 600) });
      }
    }
  }

  // Pattern C (final fallback): page-wide scan
  if (items.length === 0) {
    const stripped = stripHtml(html);
    if (hasKratomKeyword(stripped)) {
      const idx = stripped.toLowerCase().search(/(kratom|mitragyn|7[- ]?oh|gas[- ]?station\s+(?:drug|heroin|opioid)|tianeptine)/i);
      const around = stripped.slice(Math.max(0, idx - 200), idx + 600);
      items.push({ title: "(kratom mention found)", excerpt: around });
    }
  }
  return items;
}

// Legistar puts meeting metadata in a top fieldset/table near the
// page head: "Meeting Name", "Meeting Date/Time", "Meeting Location"
function extractMeetingDate(html) {
  // Look for: <span id="ctl00_ContentPlaceHolder1_lblDate">...</span>
  const labeled = html.match(/lblDate[^>]*>([^<]+)</i)
    ?? html.match(/Meeting\s+Date(?:\/Time)?<\/[^>]+>\s*<[^>]+>([^<]+)/i);
  const dateStr = labeled?.[1]?.trim();
  if (!dateStr) return null;
  // Legistar dates: "5/12/2026 6:00 PM" or "May 12, 2026 6:00 PM"
  const shortRx = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i;
  const sm = dateStr.match(shortRx);
  if (sm) {
    let hour = parseInt(sm[4], 10);
    const mm = parseInt(sm[5], 10);
    if (sm[6]?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (sm[6]?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return new Date(parseInt(sm[3]), parseInt(sm[1]) - 1, parseInt(sm[2]), hour, mm);
  }
  const longRx = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i;
  const lm = dateStr.match(longRx);
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

function extractBodyName(html) {
  // Look for "Meeting Name" or page title (or h1)
  const labeled = html.match(/lblName[^>]*>([^<]+)</i)
    ?? html.match(/Meeting\s+Name<\/[^>]+>\s*<[^>]+>([^<]+)/i);
  if (labeled?.[1]) return stripHtml(labeled[1]).trim();
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    const t = stripHtml(titleMatch[1]);
    const bodyMatch = t.match(/([\w\s]+?(?:Council|Board|Committee|Commission|Caucus|Assembly|Senate))/i);
    if (bodyMatch) return bodyMatch[1].trim();
  }
  return null;
}

function extractInPersonAddress(html) {
  const labeled = html.match(/lblLocation[^>]*>([^<]+)</i)
    ?? html.match(/Meeting\s+Location<\/[^>]+>\s*<[^>]+>([^<]+)/i);
  if (labeled?.[1]) {
    const addr = stripHtml(labeled[1]).trim();
    if (addr && addr.length > 5 && addr.length < 300) return addr;
  }
  return null;
}

function extractTenant(url) {
  const m = url.match(/^https?:\/\/([^./]+)\.legistar\.com/i);
  return m ? m[1] : null;
}

// ---------- main ----------
console.log(`Fetching: ${URL_ARG}`);
console.log(`Tenant:   ${extractTenant(URL_ARG) ?? "(non-standard legistar URL)"}`);
let html;
try {
  const res = await fetch(URL_ARG, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status}`);
    process.exit(1);
  }
  html = await res.text();
} catch (e) {
  console.error(`Fetch failed: ${e.message}`);
  process.exit(1);
}

const items = extractKratomItems(html);
console.log(`\nKratom-relevant items found: ${items.length}`);
for (const it of items) {
  console.log(`  - ${it.title}`);
  console.log(`    ${it.excerpt.slice(0, 200)}…`);
}

if (items.length === 0) {
  console.log("\nNo kratom mention on this agenda.");
  process.exit(0);
}

const meetingAt = extractMeetingDate(html);
const bodyName = extractBodyName(html);
const inPersonAddress = extractInPersonAddress(html);

console.log(`\nDerived:`);
console.log(`  state:       ${STATE ?? "(provide --state)"}`);
console.log(`  locality:    ${LOCALITY ?? "(provide --locality)"}`);
console.log(`  body_name:   ${bodyName ?? "(unknown)"}`);
console.log(`  meeting_at:  ${meetingAt?.toISOString() ?? "(could not parse from page)"}`);
console.log(`  address:     ${inPersonAddress ?? "(not listed)"}`);

if (DRY_RUN) {
  console.log(`\nDRY RUN — would NOT insert.`);
  process.exit(0);
}
if (!STATE || !LOCALITY) {
  console.log(`\nMissing --state and/or --locality. Re-run with both, or use --dry-run.`);
  process.exit(0);
}
if (!meetingAt) {
  console.log(`\nCould not parse meeting date from page. Skipping insert.`);
  process.exit(0);
}
if (!sb) {
  console.log(`\nMissing Supabase env. Skipping insert.`);
  process.exit(0);
}

const aggregatedText = items.map((it) => `${it.title}\n${it.excerpt}`).join("\n\n").slice(0, 4000);
const { error } = await sb.from("municipal_meetings").insert({
  state: STATE.toUpperCase(),
  locality: LOCALITY,
  body_name: bodyName,
  meeting_at: meetingAt.toISOString(),
  format: inPersonAddress ? "hybrid" : "virtual",
  agenda_url: URL_ARG,
  agenda_text: aggregatedText,
  in_person_address: inPersonAddress,
  discovered_via: "legistar_fetch",
  source_url: URL_ARG,
  ai_confidence: 0.95,
  kratom_relevance: "confirmed",
  moderation_status: "pending_review",
});
if (error) {
  if (error.code === "23505") {
    console.log("\nAlready seen (dedupe constraint).");
  } else {
    console.log(`\n✗ DB: ${error.message}`);
  }
} else {
  console.log(`\n✓ Inserted as pending_review.`);
}
process.exit(0);
