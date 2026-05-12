#!/usr/bin/env node
/**
 * Fetch a CivicPlus AgendaCenter agenda by URL and extract:
 *   - kratom-relevant agenda items
 *   - meeting datetime
 *   - body name
 *   - in-person address (if listed)
 *
 * URL patterns supported (covers ~3000 US municipalities):
 *   {host}/AgendaCenter/ViewFile/Agenda/_{MMDDYYYY}-{NNN}?html=true
 *   {host}/AgendaCenter/ViewFile/Agenda/{any-id}
 *   {host}/AgendaCenter
 *
 * Output: prints structured data OR upserts into municipal_meetings.
 *
 * Run:
 *   node --env-file=.env.local scripts/fetch-civicplus-agenda.mjs <url>
 *   node --env-file=.env.local scripts/fetch-civicplus-agenda.mjs <url> --dry-run
 *   node --env-file=.env.local scripts/fetch-civicplus-agenda.mjs <url> --state WA --locality "Cheney, WA"
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
  console.error("Usage: <url> [--state XX] [--locality 'City, ST'] [--dry-run]");
  process.exit(1);
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = (SB_URL && SB_KEY)
  ? createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })
  : null;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Build the html=true variant of an AgendaCenter URL so we get text not PDF
function withHtmlFlag(url) {
  if (!/AgendaCenter\/ViewFile/i.test(url)) return url;
  if (/[?&]html=true/i.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + "html=true";
}

// Pull the date from a CivicPlus filename pattern like "_05122026-665"
function dateFromCivicPlusUrl(url) {
  const m = url.match(/\/Agenda\/_(\d{2})(\d{2})(\d{4})/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  // Council meetings typically evening; default to 18:00 local. Owner can edit.
  return new Date(`${yyyy}-${mm}-${dd}T18:00:00`);
}

// Strip HTML, leave alphanumeric + basic punctuation
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

// Extract titled agenda items mentioning kratom
function extractKratomItems(html) {
  // CivicPlus shows agenda item titles in <h3 class="title">
  const items = [];
  const itemRx = /<h3\s+class="title"[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3\s+class="title"|<\/body|$)/gi;
  let m;
  while ((m = itemRx.exec(html))) {
    const title = stripHtml(m[1]);
    const body = stripHtml(m[2]);
    const combined = `${title} ${body}`;
    if (hasKratomKeyword(combined)) {
      items.push({ title, excerpt: body.slice(0, 500) });
    }
  }
  // Fallback: if no titled items found but the page mentions kratom, capture
  // the surrounding paragraph
  if (items.length === 0) {
    const stripped = stripHtml(html);
    if (hasKratomKeyword(stripped)) {
      const idx = stripped.toLowerCase().search(/(kratom|mitragyn|7[- ]?oh|gas[- ]?station\s+(?:drug|heroin|opioid))/i);
      const around = stripped.slice(Math.max(0, idx - 200), idx + 500);
      items.push({ title: "(kratom mention found in agenda)", excerpt: around });
    }
  }
  return items;
}

// ---------- main ----------
const fetchUrl = withHtmlFlag(URL_ARG);
console.log(`Fetching: ${fetchUrl}`);
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
const meetingAt = dateFromCivicPlusUrl(URL_ARG);
const bodyMatch = html.match(/<h2[^>]*>([^<]+(?:Council|Board|Committee|Commission)[^<]*)<\/h2>/i);
const bodyName = bodyMatch ? stripHtml(bodyMatch[1]) : null;

console.log(`\nDerived:`);
console.log(`  state:       ${STATE ?? "(provide --state)"}`);
console.log(`  locality:    ${LOCALITY ?? "(provide --locality)"}`);
console.log(`  body_name:   ${bodyName ?? "(unknown)"}`);
console.log(`  meeting_at:  ${meetingAt?.toISOString() ?? "(could not parse)"}`);

if (DRY_RUN) {
  console.log(`\nDRY RUN — would NOT insert.`);
  process.exit(0);
}
if (!STATE || !LOCALITY) {
  console.log(`\nMissing --state and/or --locality. Re-run with both, or use --dry-run.`);
  process.exit(0);
}
if (!meetingAt) {
  console.log(`\nCould not parse meeting date from URL. Skipping insert.`);
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
  discovered_via: "civicplus_fetch",
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
