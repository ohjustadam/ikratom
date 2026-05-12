#!/usr/bin/env node
/**
 * Fetch a Granicus AgendaViewer agenda by URL and extract:
 *   - kratom-relevant agenda items
 *   - meeting datetime
 *   - body name
 *
 * Granicus is the largest US municipal-meeting platform after CivicPlus —
 * runs roughly 5,000+ city/county/state agencies including LA, SF,
 * Seattle, Phoenix, Atlanta, Boston, Minneapolis, Portland, Sacramento,
 * Las Vegas, Denver, Austin, Charlotte, and most California cities.
 *
 * Each Granicus tenant runs on a city-specific subdomain — e.g.
 *   sf.granicus.com, lacity.granicus.com, seattle.granicus.com,
 *   sanjose.granicus.com — but ALL of them use the same routes and
 *   markup conventions:
 *
 * URL patterns supported:
 *   {tenant}.granicus.com/AgendaViewer.php?view_id=N&event_id=N
 *   {tenant}.granicus.com/GeneratedAgendaViewer.php?view_id=N&clip_id=N
 *   {tenant}.granicus.com/MetaViewer.php?view_id=N&event_id=N&meta_id=N
 *   {tenant}.granicus.com/ViewPublisher.php?view_id=N    (list page → resolve to agendas)
 *
 * Output: prints structured data OR upserts into municipal_meetings.
 *
 * Run:
 *   node --env-file=.env.local scripts/fetch-granicus-agenda.mjs <url>
 *   node --env-file=.env.local scripts/fetch-granicus-agenda.mjs <url> --dry-run
 *   node --env-file=.env.local scripts/fetch-granicus-agenda.mjs <url> --state CA --locality "Los Angeles, CA"
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
  console.error("Usage: <granicus-url> [--state XX] [--locality 'City, ST'] [--dry-run]");
  process.exit(1);
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = (SB_URL && SB_KEY)
  ? createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })
  : null;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Granicus AgendaViewer often loads a JS shell; GeneratedAgendaViewer is
// the static HTML version. Prefer that when possible.
function preferGeneratedVariant(url) {
  return url.replace(/\/AgendaViewer\.php/i, "/GeneratedAgendaViewer.php");
}

// Strip HTML, collapse whitespace.
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

// Extract agenda items mentioning kratom.
//
// Granicus item markup varies by tenant, but most share these
// conventions:
//   - <table class="agenda"> with <tr> rows, item title in first cell
//   - or <div class="agenda-item"> with <h3>/<h4> title + body text
//   - or anchor-tagged item links: <a class="agenda_item_link">...</a>
//   - or numbered list rows in a <tr> with "Section X" / "Item N"
function extractKratomItems(html) {
  const items = [];

  // Pattern A: <a class="agenda_item_link">title</a> followed by description text
  const linkRx = /<a[^>]*class="[^"]*agenda_item_link[^"]*"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,2000}?)(?=<a[^>]*class="[^"]*agenda_item_link|<\/body|$)/gi;
  let m;
  while ((m = linkRx.exec(html))) {
    const title = stripHtml(m[1]);
    const body = stripHtml(m[2]);
    if (hasKratomKeyword(`${title} ${body}`)) {
      items.push({ title, excerpt: body.slice(0, 500) });
    }
  }

  // Pattern B: <div class="agenda-item"> blocks
  if (items.length === 0) {
    const itemRx = /<div[^>]*class="[^"]*agenda-item[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    while ((m = itemRx.exec(html))) {
      const text = stripHtml(m[1]);
      if (hasKratomKeyword(text)) {
        const titleMatch = m[1].match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
        const title = titleMatch ? stripHtml(titleMatch[1]) : "(agenda item)";
        items.push({ title, excerpt: text.slice(0, 500) });
      }
    }
  }

  // Pattern C: table rows in <table class="agenda"> — title in first <td>, description in second
  if (items.length === 0) {
    const trRx = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    while ((m = trRx.exec(html))) {
      const rowText = stripHtml(m[1]);
      if (hasKratomKeyword(rowText)) {
        // Try to split title vs description by first <td>
        const tdMatch = m[1].match(/<td\b[^>]*>([\s\S]*?)<\/td>([\s\S]*)/i);
        if (tdMatch) {
          items.push({
            title: stripHtml(tdMatch[1]).slice(0, 200),
            excerpt: stripHtml(tdMatch[2]).slice(0, 500),
          });
        } else {
          items.push({ title: "(agenda row)", excerpt: rowText.slice(0, 500) });
        }
      }
    }
  }

  // Pattern D (fallback): page-wide scan with context window around the
  // first kratom mention — same behavior as CivicPlus fallback.
  if (items.length === 0) {
    const stripped = stripHtml(html);
    if (hasKratomKeyword(stripped)) {
      const idx = stripped.toLowerCase().search(/(kratom|mitragyn|7[- ]?oh|gas[- ]?station\s+(?:drug|heroin|opioid)|tianeptine)/i);
      const around = stripped.slice(Math.max(0, idx - 200), idx + 500);
      items.push({ title: "(kratom mention found in agenda)", excerpt: around });
    }
  }
  return items;
}

// Granicus agenda pages typically show the meeting date in one of:
//   <h2>Body Name — Meeting Date</h2>
//   <span class="meeting-date">Monday, May 12, 2026 6:00 PM</span>
//   <td class="datetime">5/12/2026 6:00 PM</td>
function extractMeetingDate(html) {
  // Try ISO/MDY patterns in the visible HTML, near the top
  const head = html.slice(0, 8000);
  // "May 12, 2026 6:00 PM"
  const longMatch = head.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})(?:\s+at)?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (longMatch) {
    const [_, monthName, dd, yyyy, hh, mm, ampm] = longMatch;
    const months = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
    const monthIdx = months[monthName.toLowerCase()];
    let hour = parseInt(hh, 10);
    if (ampm?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (ampm?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return new Date(parseInt(yyyy), monthIdx, parseInt(dd), hour, parseInt(mm));
  }
  // "5/12/2026 6:00 PM"
  const shortMatch = head.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (shortMatch) {
    const [_, mo, dd, yyyy, hh, mm, ampm] = shortMatch;
    let hour = parseInt(hh, 10);
    if (ampm?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (ampm?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return new Date(parseInt(yyyy), parseInt(mo) - 1, parseInt(dd), hour, parseInt(mm));
  }
  return null;
}

function extractBodyName(html) {
  // Granicus typically puts body name in <title> or first <h1>/<h2>
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    const t = stripHtml(titleMatch[1]);
    // titles often look like "City of LA - City Council - Agenda - May 12, 2026"
    // pull the "Council/Board/Committee/Commission" piece
    const bodyMatch = t.match(/([\w\s]+?(?:Council|Board|Committee|Commission|Authority|District|Assembly))/i);
    if (bodyMatch) return bodyMatch[1].trim();
  }
  const hMatch = html.match(/<h[12][^>]*>([^<]*(?:Council|Board|Committee|Commission|Authority|District|Assembly)[^<]*)<\/h[12]>/i);
  if (hMatch) return stripHtml(hMatch[1]);
  return null;
}

// Extract the granicus tenant subdomain for context
function extractTenant(url) {
  const m = url.match(/^https?:\/\/([^./]+)\.granicus\.com/i);
  return m ? m[1] : null;
}

// ---------- main ----------
const fetchUrl = preferGeneratedVariant(URL_ARG);
console.log(`Fetching: ${fetchUrl}`);
console.log(`Tenant:   ${extractTenant(fetchUrl) ?? "(non-standard granicus URL)"}`);

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

// Derive metadata
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
  console.log(`\nCould not parse meeting date from page. Skipping insert (provide manually if needed).`);
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
  discovered_via: "granicus_fetch",
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
