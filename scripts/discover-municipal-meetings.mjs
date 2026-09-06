#!/usr/bin/env node
/**
 * Discover city/county council meetings where kratom is on the agenda.
 *
 * Uses Gemini 2.5 Flash with Google Search grounding to find upcoming
 * municipal meetings discussing kratom, 7-OH, gas-station drugs,
 * tianeptine, or related substances. Stores findings in
 * municipal_meetings as pending_review so admin can verify before
 * pushing notifications.
 *
 * Per-state strategy: for each enabled state, ask Gemini to find
 * meetings in the next 14 days. The grounded model returns citations
 * — we capture those as source_url.
 *
 * Output is conservative — better to surface a false-pending for
 * admin review than miss the meeting. Admin moderates at
 * /admin/municipal-meetings.
 *
 * Free: uses our existing GEMINI_API_KEY. ~50 grounded calls/day stays
 * well within the 1500/day free tier.
 *
 * Run:
 *   node --env-file=.env.local scripts/discover-municipal-meetings.mjs
 *   node --env-file=.env.local scripts/discover-municipal-meetings.mjs --state NY
 *   node --env-file=.env.local scripts/discover-municipal-meetings.mjs --dry-run
 *   node --env-file=.env.local scripts/discover-municipal-meetings.mjs --priority-only
 *     (NY, FL, TX, CA, OH, MI — the states with the most kratom activity)
 */
import { createClient } from "@supabase/supabase-js";
import { groundedGenerate } from "./lib/grounded-ai.mjs";
import { reconcileLocality } from "./lib/geo-resolver.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const STATE = arg("--state");
const PRIORITY_ONLY = args.includes("--priority-only");
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
if (!GEMINI_KEY) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",
  FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",
  IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
  OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",
  SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",
  VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",
  WY:"Wyoming",
};

// States with highest kratom legislative activity → priority targets
// for daily discovery. The other 45 still get scanned, just less often.
const PRIORITY_STATES = ["NY", "FL", "TX", "CA", "OH", "MI", "TN", "MO", "PA", "GA"];

async function discoverState(state) {
  const stateName = STATE_NAMES[state];
  if (!stateName) return { state, status: "skip", reason: "unknown state" };

  const prompt = `Find upcoming (next 14 days) city council, county board, board of supervisors,
or related local government meetings in ${stateName} where kratom, 7-hydroxymitragynine (7-OH),
"gas station drugs", or tianeptine appears on the agenda.

For each meeting found, return strict JSON with this exact shape:
{
  "meetings": [
    {
      "locality": "City/county name, ST",
      "body_name": "City Council / Board of Supervisors / etc",
      "meeting_iso": "ISO 8601 datetime",
      "format": "in_person" | "virtual" | "hybrid" | "unknown",
      "zoom_url": "if known, the Zoom join URL — otherwise null",
      "livestream_url": "YouTube / city stream URL if separate from Zoom — otherwise null",
      "agenda_url": "link to the official agenda page",
      "in_person_address": "if in-person or hybrid, the address — otherwise null",
      "public_comment_url": "URL to sign up for public comment if separate — otherwise null",
      "agenda_excerpt": "the specific phrase or paragraph from the agenda mentioning kratom (verbatim)",
      "confidence": 0.0 to 1.0,
      "source_url": "the URL where you found this — required"
    }
  ]
}

Only include meetings you have concrete evidence for from grounded search.
Return {"meetings":[]} if nothing found. Skip past meetings.
ALWAYS include source_url for every meeting.`;

  // Grounding is REQUIRED here, never optional. The prompt above says "only
  // include meetings you have concrete evidence for from grounded search" — a
  // model without search would simply invent plausible city-council meetings,
  // which is the same failure class as the false 7-OH scheduling alert. So this
  // passes allowUngrounded:false and reports honestly when it cannot look.
  //
  // Before this change the script swallowed a depleted-Gemini 429 into
  // `status: "error", reason: "Gemini 429"` per state and the run summarised as
  // "51 states · 0 found · 0 new" — which reads as "there are no meetings",
  // not "we were unable to search". It had been failing that way for 4 days.
  let parsed;
  try {
    const r = await groundedGenerate({
      system: "You find real, upcoming municipal meetings from grounded web search. Never guess.",
      user: prompt,
      maxTokens: 2048,
      allowUngrounded: false,
    });
    parsed = r.parsed;
    if (!parsed) return { state, status: "empty", reason: "no JSON in response" };
  } catch (e) {
    const msg = String(e.message ?? e);
    if (msg.startsWith("GROUNDING_UNAVAILABLE")) {
      return { state, status: "blocked", reason: "grounding unavailable (Gemini not answering)" };
    }
    return { state, status: "error", reason: msg.slice(0, 90) };
  }
  const meetings = parsed.meetings ?? [];
  if (meetings.length === 0) {
    return { state, status: "empty" };
  }

  // Persist
  let inserted = 0, skipped = 0;
  for (const m of meetings) {
    if (!m.meeting_iso) { skipped++; continue; }
    const meetingAt = new Date(m.meeting_iso);
    if (Number.isNaN(meetingAt.getTime())) { skipped++; continue; }
    if (meetingAt.getTime() < Date.now() - 24 * 60 * 60 * 1000) { skipped++; continue; }  // already happened
    if (!DRY_RUN) {
      // Gazetteer-reconcile the meeting's state. The per-state scrape bucket
      // (`state`) and the model's "City, ST" guess (`m.locality`) are both just
      // candidates — the gazetteer decides. We write the RESOLVED state, never
      // the raw bucket, so a meeting the agenda body contradicts can't be
      // mislabeled. When the resolver can't corroborate a specific state, we
      // force moderation_status='pending_review' so auto-approve-meetings.mjs
      // can't promote a possibly-wrong-state meeting to /calendar.
      const { locality: resolvedState, corroborated } = reconcileLocality({
        aiLocality: m.locality,
        scopeState: state,
        text: `${m.body_name ?? ""} ${m.agenda_excerpt ?? ""}`,
        title: m.body_name,
      });
      const { error } = await sb.from("municipal_meetings").insert({
        state: resolvedState,
        ...(corroborated ? {} : { moderation_status: "pending_review" }),
        locality: m.locality?.slice(0, 200) ?? null,
        body_name: m.body_name?.slice(0, 200) ?? null,
        meeting_at: meetingAt.toISOString(),
        format: ["in_person", "virtual", "hybrid", "unknown"].includes(m.format) ? m.format : "unknown",
        zoom_url: m.zoom_url?.slice(0, 500) ?? null,
        livestream_url: m.livestream_url?.slice(0, 500) ?? null,
        agenda_url: m.agenda_url?.slice(0, 500) ?? null,
        agenda_text: m.agenda_excerpt?.slice(0, 1000) ?? null,
        in_person_address: m.in_person_address?.slice(0, 300) ?? null,
        public_comment_signup_url: m.public_comment_url?.slice(0, 500) ?? null,
        discovered_via: "gemini_grounded",
        source_url: m.source_url?.slice(0, 500) ?? null,
        ai_confidence: Number.isFinite(m.confidence) ? Math.max(0, Math.min(1, m.confidence)) : null,
      });
      if (error) {
        // 23505 = unique violation on the dedupe index — meeting already known. Skip.
        if (error.code !== "23505") {
          console.log(`    ✗ db insert: ${error.message?.slice(0, 80)}`);
        }
        skipped++;
      } else {
        inserted++;
      }
    }
  }

  return { state, status: "ok", found: meetings.length, inserted, skipped };
}

// ---------- main ----------
let targets;
if (STATE) {
  targets = [STATE.toUpperCase()];
} else if (PRIORITY_ONLY) {
  targets = PRIORITY_STATES;
} else {
  targets = Object.keys(STATE_NAMES);
}

console.log(`Discovering municipal meetings across ${targets.length} state(s)${DRY_RUN ? " [DRY RUN]" : ""}…\n`);
const t0 = Date.now();
let totalInserted = 0;
let totalFound = 0;
let blocked = 0;
for (const s of targets) {
  process.stdout.write(`  ${s}: `);
  const r = await discoverState(s);
  if (r.status === "ok") {
    console.log(`✓ ${r.found} found, ${r.inserted} new, ${r.skipped} skipped`);
    totalFound += r.found;
    totalInserted += r.inserted ?? 0;
  } else if (r.status === "empty") {
    console.log("· nothing on agendas");
  } else if (r.status === "blocked") {
    blocked++;
    console.log(`⛔ ${r.reason}`);
  } else {
    console.log(`✗ ${r.status}${r.reason ? ` — ${r.reason}` : ""}`);
  }
  await sleep(2000);  // gentle pace
}
const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${totalFound} meetings found across ${targets.length} states, ${totalInserted} new.`);
if (blocked > 0) {
  console.log(`⛔ ${blocked}/${targets.length} states could NOT be searched (grounding unavailable).`);
  console.log('   This is NOT "no meetings exist" - it is "we were unable to look".');
}

try {
  await sb.from("scraper_runs").insert({
    source: "discover_municipal_meetings",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    // A run that could not SEARCH is an error, never "empty". Reporting it as
    // empty is what let this look healthy while finding nothing for 4 days.
    status: blocked >= targets.length ? "error"
      : blocked > 0 ? "partial"
      : totalInserted > 0 ? "success" : "empty",
    rows_added: totalInserted,
    error_message: blocked > 0
      ? `grounding unavailable for ${blocked}/${targets.length} states — Gemini not answering`
      : null,
    notes: `${targets.length} states · ${totalFound} found · ${totalInserted} new`
      + (blocked > 0 ? ` · ${blocked} BLOCKED (could not search)` : ""),
  });
} catch { /* best-effort */ }
process.exit(0);
