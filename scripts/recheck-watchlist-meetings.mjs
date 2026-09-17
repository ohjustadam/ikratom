/**
 * Re-check legislative bodies that have previously hosted a kratom-
 * related meeting. For each known body, ask Gemini-grounded "when is
 * this body's next meeting and is kratom on the agenda?" — and pull
 * any new agenda forward into municipal_meetings.
 *
 * Why this exists: Suffolk County Legislature tabled their kratom
 * resolution (I.R. 1279-2026) at the May 12 General Meeting. They
 * said "we'll come back to it at the next General Meeting." Our
 * existing discover-municipal-meetings.mjs runs a generic per-state
 * Gemini-grounded search daily — but a "tabled resolution" doesn't
 * always trigger fresh news the next week. The body itself, however,
 * still exists, still has a calendar, and the resolution will resurface.
 *
 * This script CLOSES that loop: any (state, locality, body_name)
 * that's appeared in an approved kratom-relevant meeting becomes a
 * watchlist entry. Daily we ask "next agenda?" specifically — much
 * more targeted than the generic state-wide search.
 *
 * Architecture: derive watchlist from municipal_meetings table; no
 * new table needed. Idempotent — re-runs upsert by dedup key.
 *
 * Usage:
 *   node --env-file=.env.local scripts/recheck-watchlist-meetings.mjs
 *   node --env-file=.env.local scripts/recheck-watchlist-meetings.mjs --dry-run
 *   node --env-file=.env.local scripts/recheck-watchlist-meetings.mjs --limit 5
 */

import { createClient } from "@supabase/supabase-js";
import { groundedGenerate } from "./lib/grounded-ai.mjs";
import { logProviderSummary } from "./lib/ai-router.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const arg = (n, fallback = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fallback; };

const DRY_RUN = flag("--dry-run");
const LIMIT = parseInt(arg("--limit", "30"), 10);

// NO hard exit on a missing GEMINI_API_KEY (was: `process.exit(0)`).
//
// This script called Gemini directly with no fallback, so the day the key hit
// its quota the job stopped doing anything — and `continue-on-error: true` on
// its workflow step meant the run still went green. A dead pipeline that
// reports success is worse than one that fails. Now it goes through
// groundedGenerate(), which draws from the whole Gemini key pool
// (GEMINI_API_KEY_2..9) and falls through to any other grounding tier, and the
// summary at the end states plainly whether grounding was ever available.

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================================
// Derive the watchlist: distinct (state, locality, body_name) trips
// from municipal_meetings where we've previously confirmed kratom
// on the agenda. This is the "warm leads" set — bodies known to
// care about kratom enough to schedule a hearing.
// =============================================================
const { data: priorMeetings } = await sb
  .from("municipal_meetings")
  .select("state, locality, body_name, source_url")
  .eq("kratom_relevance", "confirmed")
  .order("meeting_at", { ascending: false });

const watchlist = new Map();
for (const m of priorMeetings ?? []) {
  if (!m.state || !m.body_name) continue;
  const key = `${m.state}|${m.locality ?? ""}|${m.body_name}`;
  if (!watchlist.has(key)) {
    watchlist.set(key, {
      state: m.state,
      locality: m.locality,
      body_name: m.body_name,
      source_url_hint: m.source_url,
    });
  }
}

const entries = [...watchlist.values()].slice(0, LIMIT);
console.log(`Watchlist size: ${watchlist.size} unique bodies. Re-checking first ${entries.length}…`);
for (const e of entries) {
  console.log(`  ${e.state} · ${e.locality ?? "(state)"} · ${e.body_name}`);
}

if (entries.length === 0) {
  console.log("Nothing to re-check (no prior kratom meetings on record).");
  process.exit(0);
}

// =============================================================
// Gemini grounded call — one per body. Asks specifically about
// upcoming meetings of that body where kratom may be on the agenda.
// =============================================================
async function checkBody(e) {
  const prompt = `Find the NEXT upcoming meeting of "${e.body_name}" in ${e.locality ?? e.state} (state: ${e.state}). Specifically:
- When is the next meeting (date + time, ISO format YYYY-MM-DD HH:MM)?
- Is kratom, mitragyna, mitragynine, 7-OH, or any related substance on the agenda for that meeting?
- Is there a resolution number or bill number being considered (e.g. "I.R. 1279-2026")?
- What's the livestream URL or agenda URL?

If kratom IS on the next agenda, return a JSON object:
{
  "next_meeting_at": "2026-06-10 14:00",
  "kratom_on_agenda": true,
  "resolution_number": "I.R. 1279-2026 or similar, or null",
  "agenda_url": "url or null",
  "livestream_url": "url or null",
  "source_url": "url where you found this info"
}

If kratom is NOT explicitly on the next agenda, OR if you can't find the next meeting, return:
{ "next_meeting_at": null, "kratom_on_agenda": false }

Return ONLY the JSON. No markdown fences, no prose.`;

  // allowUngrounded: false is deliberate. This script writes MEETING DATES into
  // municipal_meetings, and a model guessing a date without a search behind it
  // invents a hearing that nobody is holding — exactly the failure mode that put
  // a bogus "effective date" and a "ban expiry" into the review queue. No
  // grounding means no answer, and the caller counts that separately from a real
  // error so a depleted key never reads as "no kratom item upcoming".
  const { parsed } = await groundedGenerate({
    system:
      "You research municipal and county legislative calendars. Answer only from " +
      "what the search results actually show. Never infer or extrapolate a meeting " +
      "date. Return ONLY JSON.",
    user: prompt,
    maxTokens: 1024,
    json: true,
    allowUngrounded: false,
  });
  if (!parsed || typeof parsed !== "object") {
    throw new Error("grounded call returned no JSON object");
  }
  return parsed;
}

// =============================================================
// Main loop
// =============================================================
const t0 = Date.now();
let ok = 0, miss = 0, fail = 0, newMeetings = 0, ungrounded = 0;

for (const e of entries) {
  process.stdout.write(`  ${e.state} · ${e.body_name.slice(0, 40)}… `);
  let parsed;
  try {
    parsed = await checkBody(e);
  } catch (err) {
    const msg = String(err.message ?? err);
    // GROUNDING_UNAVAILABLE is not a failure of this body — it is the pool being
    // empty or throttled. Counting it as `fail` is what made a dead key look
    // like 25 individually-unlucky lookups.
    if (msg.startsWith("GROUNDING_UNAVAILABLE")) {
      console.log(`SKIP (no grounding): ${msg.slice(0, 90)}`);
      ungrounded++;
      continue;
    }
    console.log(`FAIL: ${msg.slice(0, 80)}`);
    fail++;
    continue;
  }
  if (!parsed.kratom_on_agenda || !parsed.next_meeting_at) {
    console.log(`no kratom item upcoming`);
    miss++;
    await new Promise(r => setTimeout(r, 1500));
    continue;
  }
  // Parse meeting time loosely
  const meetingAt = new Date(parsed.next_meeting_at.replace(" ", "T") + (parsed.next_meeting_at.length === 10 ? "T09:00:00" : ":00"));
  if (Number.isNaN(meetingAt.getTime()) || meetingAt.getTime() < Date.now()) {
    console.log(`bogus date "${parsed.next_meeting_at}"`);
    fail++;
    await new Promise(r => setTimeout(r, 1500));
    continue;
  }
  console.log(`✓ next ${meetingAt.toISOString().slice(0, 10)}${parsed.resolution_number ? ` · ${parsed.resolution_number}` : ""}`);
  ok++;

  if (DRY_RUN) continue;

  // Upsert into municipal_meetings as pending_review (admin moderates
  // before pushing user notifications)
  const row = {
    state: e.state,
    locality: e.locality,
    body_name: e.body_name,
    meeting_at: meetingAt.toISOString(),
    format: "unknown",
    livestream_url: parsed.livestream_url ?? null,
    agenda_url: parsed.agenda_url ?? null,
    discovered_via: "gemini_grounded_watchlist_recheck",
    source_url: parsed.source_url ?? e.source_url_hint ?? null,
    kratom_relevance: "confirmed",
    ai_confidence: 0.85,
    ai_notes: `Watchlist re-check for body that previously hosted kratom items. Resolution: ${parsed.resolution_number ?? "(none cited)"}.`,
    moderation_status: "pending_review",
  };
  const { error } = await sb
    .from("municipal_meetings")
    .upsert(row, { onConflict: "state,locality,meeting_at", ignoreDuplicates: false });
  if (error) {
    console.log(`    ⚠ DB write failed: ${error.message?.slice(0, 100)}`);
  } else {
    newMeetings++;
  }

  await new Promise(r => setTimeout(r, 1500));
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ok=${ok}, miss=${miss}, fail=${fail}, ungrounded=${ungrounded}, new_meetings=${newMeetings}`);
logProviderSummary("AI providers (ungrounded fallback tier)");

// The step is `continue-on-error: true`, so this can never fail the daily run —
// but a run that checked NOTHING because grounding was unavailable must not read
// as a clean pass in the log. Say it in one unmissable line.
if (ungrounded > 0 && ok === 0 && miss === 0) {
  console.log(
    `\n⚠ Watchlist re-check did NO work: all ${ungrounded} bodies were skipped for lack of a ` +
    `working grounded-search key. Add a free Gemini key (GEMINI_API_KEY, or GEMINI_API_KEY_2..9 ` +
    `for extra quota) — see docs/AI_PROVIDERS.md.`,
  );
}
