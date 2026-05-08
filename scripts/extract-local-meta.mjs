#!/usr/bin/env node
/**
 * Extract structured local-event metadata from policy_alerts.body
 * and write it to the linked bill's local_meta jsonb. Lets the bill
 * detail page render a uniform "local action playbook" regardless of
 * how the original intel was formatted (Facebook post, news article,
 * agenda PDF excerpt, etc.).
 *
 * Run:
 *   node --env-file=.env.local scripts/extract-local-meta.mjs --bill <uuid>
 *   node --env-file=.env.local scripts/extract-local-meta.mjs --all-municipal
 *   node --env-file=.env.local scripts/extract-local-meta.mjs --refresh   # re-extract
 */
import { createClient } from "@supabase/supabase-js";
import { aiRouter, listAvailableProviders } from "./lib/ai-router.mjs";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const SPECIFIC = arg("--bill");
const ALL = args.includes("--all-municipal");
const REFRESH = args.includes("--refresh");

if (!SPECIFIC && !ALL) {
  console.error("Usage: --bill <uuid>  OR  --all-municipal  (optionally --refresh)");
  process.exit(1);
}

const SYSTEM = `You normalize unstructured kratom-policy intel (news articles, Facebook posts, advocate emails, meeting agendas) into a fixed-shape JSON object so a downstream UI can render it as actionable buttons.

Read the input carefully — it may be:
  - a city council meeting announcement with Zoom + dial-in
  - a board of pharmacy agenda with public-comment instructions
  - a news article describing an already-passed ordinance
  - an advocate-submitted tip with partial info

Return JSON with these EXACT keys (every key OPTIONAL — omit or set null when unknown):

{
  "meeting_at":               "ISO 8601 string with timezone (e.g. 2026-05-12T17:00:00-07:00)",
  "meeting_location":         "physical address or building, freeform",
  "livestream_urls":          [{"label": "YouTube", "url": "https://..."}, ...],
  "remote_url":               "single primary remote-attendance URL (Zoom, Teams, etc.)",
  "dial_in_phone":            "primary phone number for call-in",
  "dial_in_phone_alt":        "alternate phone (toll-free, etc.) — optional",
  "dial_in_meeting_id":       "meeting ID if separate from URL",
  "public_comment_email":     "email address for written public comment",
  "public_comment_form_url":  "URL of online public-comment form",
  "public_comment_deadline":  "ISO 8601 deadline for written comment submission",
  "public_comment_format_notes": "any rules: 'must include agenda item number', '1000 char max', etc.",
  "agenda_item_number":       "the specific item number/letter for the kratom action",
  "officials_to_contact":     [{"title": "Mayor", "name": "John Hasten", "email": "...", "phone": "..."}, ...],
  "official_status":          "introduced | first_reading | passed | enacted | tabled | dead",
  "summary_one_line":         "≤120 chars — what's actually happening, in plain English"
}

Strict rules:
- Output a SINGLE JSON object. No prose, no markdown, no code fences.
- Be conservative: if you're not sure of a value, omit the key.
- Phone numbers: include country code, format like "+1-669-900-6833"
- meeting_at: respect the timezone given in the input. Default to UTC offset matching the locality if input says "PST" / "EST" without specifics.
- Don't invent emails or URLs — only include what's literally in the input.`;

async function processBill(bill) {
  console.log(`\n=== ${bill.id.slice(0, 8)} | ${bill.state} ${bill.bill_number} | ${bill.title?.slice(0, 60)} ===`);

  // Find the linked alert (if any) to pull body from
  const { data: alerts } = await sb
    .from("policy_alerts")
    .select("body, source_url, title")
    .eq("bill_id", bill.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const alert = alerts?.[0];

  if (!alert?.body) {
    console.log("  ⏭  no linked alert with body content; skipping");
    return false;
  }

  const userPrompt =
    `Bill title: ${bill.title}\n` +
    `Locality: ${bill.locality ?? "(unknown)"}\n` +
    `State: ${bill.state}\n` +
    (alert.source_url ? `Source URL: ${alert.source_url}\n` : "") +
    `\n=== INTEL CONTENT ===\n${alert.body}`;

  let parsed;
  try {
    const r = await aiRouter({
      systemPrompt: SYSTEM,
      userPrompt,
      maxTokens: 1500,
      verbose: true,
    });
    parsed = r.parsed;
    console.log(`  ✓ extracted via ${r.provider} in ${r.elapsedMs}ms`);
  } catch (e) {
    console.log(`  ✗ extraction failed: ${e.message?.slice(0, 200)}`);
    return false;
  }

  // Strip null / empty entries so the jsonb stays compact
  const clean = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && v.trim().length === 0) continue;
    clean[k] = v;
  }

  if (Object.keys(clean).length === 0) {
    console.log("  ⏭  AI returned no structured fields");
    return false;
  }

  const { error } = await sb.from("bills").update({
    local_meta: clean,
    local_meta_extracted_at: new Date().toISOString(),
  }).eq("id", bill.id);
  if (error) {
    console.log(`  ✗ DB update failed: ${error.message}`);
    return false;
  }
  console.log(`  ✓ saved ${Object.keys(clean).length} field(s):`, Object.keys(clean).join(", "));
  return true;
}

console.log(`Providers available: ${listAvailableProviders().join(", ")}\n`);

let bills;
if (SPECIFIC) {
  const { data } = await sb.from("bills").select("id, state, bill_number, title, locality").eq("id", SPECIFIC).single();
  bills = data ? [data] : [];
} else {
  let q = sb.from("bills").select("id, state, bill_number, title, locality, local_meta_extracted_at")
    .in("scope", ["municipal", "county"])
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (!REFRESH) q = q.is("local_meta_extracted_at", null);
  const { data } = await q;
  bills = data ?? [];
}

if (bills.length === 0) { console.log("Nothing to process."); process.exit(0); }
console.log(`Processing ${bills.length} local bill(s)…`);

let ok = 0, fail = 0;
for (const b of bills) {
  if (await processBill(b)) ok++; else fail++;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`\nDone. ok=${ok}, fail=${fail}`);
try {
  await sb.from("scraper_runs").insert({
    source: "extract_local_meta",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: fail > ok ? "error" : (ok === 0 ? "empty" : "success"),
    rows_updated: ok,
    notes: `${ok} bills extracted, ${fail} failed`,
  });
} catch { /* best-effort */ }
