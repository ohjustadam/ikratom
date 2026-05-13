#!/usr/bin/env node
/**
 * Fetch a BoardDocs (Diligent Community) meeting agenda and extract:
 *   - kratom-relevant agenda items
 *   - meeting datetime
 *   - body name
 *
 * BoardDocs runs the agenda systems for ~1500 US school districts +
 * many county-level government boards. Especially relevant for
 * "substance abuse policy" or "drug education curriculum" agenda
 * items that may touch kratom.
 *
 * URL patterns supported (BoardDocs uses go.boarddocs.com or
 * a tenant-specific subdomain, with a hash-based router):
 *   https://go.boarddocs.com/<state>/<tenant>/Board.nsf/goto?open&id=<MEETING_ID>
 *   https://go.boarddocs.com/<state>/<tenant>/Board.nsf/Public  (list page)
 *   https://meetings.boardbook.org/Public/Agenda/<TENANT_ID>?id=<MEETING_ID>  (BoardBook fallback — similar pattern)
 *
 * Some BoardDocs sites render the meeting list as a JS shell that
 * loads JSON from a sibling endpoint; we try both the HTML view and
 * the print/legacy view since the legacy view returns parseable HTML.
 *
 * Output: prints structured data OR upserts into municipal_meetings.
 *
 * Run:
 *   node --env-file=.env.local scripts/fetch-boarddocs-agenda.mjs <url>
 *   node --env-file=.env.local scripts/fetch-boarddocs-agenda.mjs <url> --dry-run
 *   node --env-file=.env.local scripts/fetch-boarddocs-agenda.mjs <url> --state TX --locality "Austin ISD, TX"
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
  console.error("Usage: <boarddocs-url> [--state XX] [--locality 'District, ST'] [--dry-run]");
  process.exit(1);
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = (SB_URL && SB_KEY)
  ? createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })
  : null;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// BoardDocs hash-based URLs (#tab-X&id=Y) can be rewritten to a
// "Public" landing view that serves static HTML. The print view also
// works well: /Board.nsf/Public?open&id=X yields a printable HTML.
function preferPrintVariant(url) {
  // hash → query: BoardDocs sometimes accepts ?open&id= for printable
  return url.replace(/#tab-?\d*&?/i, "?open&");
}

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

// Extract kratom-relevant agenda items from BoardDocs HTML.
//
// BoardDocs item conventions vary by tenant but most share these
// patterns:
//   - <div class="boardWrapper"> wrapping the agenda
//   - <li class="agendaItem"> or <div class="item">
//   - <a class="title"> for item titles
//   - <div class="public-side"> for the body
function extractKratomItems(html) {
  const items = [];

  // Pattern A: <li class="agendaItem"> with nested title + body
  const liRx = /<li[^>]*class="[^"]*agendaItem[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRx.exec(html))) {
    const text = stripHtml(m[1]);
    if (hasKratomKeyword(text)) {
      const titleMatch = m[1].match(/<(a|span|h[1-6])[^>]*(?:class="[^"]*(?:title|name)[^"]*")?[^>]*>([\s\S]*?)<\/\1>/i);
      const title = titleMatch ? stripHtml(titleMatch[2]).slice(0, 120) : "(agenda item)";
      items.push({ title, excerpt: text.slice(0, 600) });
    }
  }

  // Pattern B: <div class="item"> blocks
  if (items.length === 0) {
    const divRx = /<div[^>]*class="[^"]*\bitem\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    while ((m = divRx.exec(html))) {
      const text = stripHtml(m[1]);
      if (hasKratomKeyword(text)) {
        const titleMatch = m[1].match(/<(a|span|h[1-6])[^>]*>([\s\S]*?)<\/\1>/i);
        const title = titleMatch ? stripHtml(titleMatch[2]).slice(0, 120) : "(agenda item)";
        items.push({ title, excerpt: text.slice(0, 600) });
      }
    }
  }

  // Pattern C: anchor tags with item links (some BoardDocs print views)
  if (items.length === 0) {
    const anchorRx = /<a[^>]*href="[^"]*GoTo[^"]*"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1500}?)(?=<a[^>]*href="[^"]*GoTo|<\/body|$)/gi;
    while ((m = anchorRx.exec(html))) {
      const title = stripHtml(m[1]).slice(0, 120);
      const body = stripHtml(m[2]).slice(0, 600);
      if (hasKratomKeyword(`${title} ${body}`)) {
        items.push({ title, excerpt: body });
      }
    }
  }

  // Pattern D (fallback): full-page kratom search with context window
  if (items.length === 0) {
    const stripped = stripHtml(html);
    if (hasKratomKeyword(stripped)) {
      const idx = stripped.toLowerCase().search(/(kratom|mitragyn|7[- ]?oh|gas[- ]?station\s+(?:drug|heroin|opioid)|tianeptine)/i);
      const around = stripped.slice(Math.max(0, idx - 200), idx + 600);
      items.push({ title: "(kratom mention found in agenda)", excerpt: around });
    }
  }
  return items;
}

// BoardDocs surfaces meeting metadata in different places depending
// on tenant: <span class="meetingDate">, <h1 class="title"> with date,
// or a <meta> tag. Try several.
function extractMeetingDate(html) {
  // BoardDocs typically uses "MMM dd, yyyy" or "Month dd, yyyy"
  const head = html.slice(0, 10000);
  const longRx = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})(?:\s+at\s+|\s+@\s+|\s+)?(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/i;
  const lm = head.match(longRx);
  if (lm) {
    const months = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
    const monthIdx = months[lm[1].toLowerCase()];
    let hour = parseInt(lm[4], 10);
    const mm = parseInt(lm[5], 10);
    if (lm[6]?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (lm[6]?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return new Date(parseInt(lm[3]), monthIdx, parseInt(lm[2]), hour, mm);
  }
  // Date-only fallback — default to 18:00 (typical board meeting time)
  const dateOnly = head.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (dateOnly) {
    const months = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
    const monthIdx = months[dateOnly[1].toLowerCase()];
    return new Date(parseInt(dateOnly[3]), monthIdx, parseInt(dateOnly[2]), 18, 0);
  }
  return null;
}

function extractBodyName(html) {
  // BoardDocs tenant name often in <h1> or <title>
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    const t = stripHtml(titleMatch[1]);
    // titles often look like "Austin ISD - Board of Trustees Meeting"
    const bodyMatch = t.match(/([\w\s.]+?(?:Board|Council|Trustees|Commission|Committee))/i);
    if (bodyMatch) return bodyMatch[1].trim();
    return t.slice(0, 100);
  }
  return null;
}

function extractTenant(url) {
  const m = url.match(/^https?:\/\/(?:go\.|meetings\.)?boarddocs\.com\/([^/]+)\/([^/]+)\//i)
    ?? url.match(/^https?:\/\/(?:meetings\.boardbook\.org)\/Public\/Agenda\/(\d+)/i);
  if (m) {
    return m[2] ? `${m[1]}/${m[2]}` : m[1];
  }
  return null;
}

// ---------- main ----------
const fetchUrl = preferPrintVariant(URL_ARG);
console.log(`Fetching: ${fetchUrl}`);
console.log(`Tenant:   ${extractTenant(fetchUrl) ?? "(non-standard boarddocs URL)"}`);

let html;
try {
  const res = await fetch(fetchUrl, {
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

console.log(`\nDerived:`);
console.log(`  state:       ${STATE ?? "(provide --state)"}`);
console.log(`  locality:    ${LOCALITY ?? "(provide --locality)"}`);
console.log(`  body_name:   ${bodyName ?? "(unknown)"}`);
console.log(`  meeting_at:  ${meetingAt?.toISOString() ?? "(could not parse from page)"}`);

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
  format: "hybrid",
  agenda_url: URL_ARG,
  agenda_text: aggregatedText,
  discovered_via: "boarddocs_fetch",
  source_url: URL_ARG,
  ai_confidence: 0.9,
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
