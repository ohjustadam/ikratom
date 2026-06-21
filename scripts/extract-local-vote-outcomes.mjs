#!/usr/bin/env node
/**
 * extract-local-vote-outcomes.mjs — restructure local (city/county) kratom
 * VOTE results from policy_alerts into the local_vote_outcomes table (0210).
 *
 * The narrative already arrives as alerts ("Spokane City Council votes to ban
 * kratom"), but those are filtered off the forward calendar and aren't
 * queryable as pass/fail outcomes. This derives real outcome rows from the
 * source alerts — never fabricated; each row keeps policy_alert_id + source_url
 * for traceability, and the unique index on policy_alert_id makes re-runs
 * idempotent.
 *
 * Conservative: only inserts when the title states a DECISIVE outcome (passed /
 * failed / tabled) AND a usable locality is present. Upcoming/proposed votes
 * ("to vote on", "proposes") and state-level rows are skipped — they're not
 * local outcomes.
 *
 * READ-ONLY by default (dry-run). Pass --apply to write (owner-gated prod write).
 *   node --env-file=.env.local scripts/extract-local-vote-outcomes.mjs           # dry-run
 *   node --env-file=.env.local scripts/extract-local-vote-outcomes.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PASSED = /\b(votes?\s+to\s+(?:ban|approve|adopt|pass|prohibit|restrict|regulate)|voted\s+to\s+\w+|approv(?:es|ed)|adopt(?:s|ed)|pass(?:es|ed)|enact(?:s|ed)|ban(?:s|ned))\b/i;
const FAILED = /\b(reject(?:s|ed)?|votes?\s+(?:down|against)|fail(?:s|ed)?|defeat(?:s|ed)?|vote[sd]?\s+no\b)\b/i;
const TABLED = /\b(tabl(?:e|ed|es)|postpon\w*|delay(?:s|ed)?|deferr?\w*|reschedul\w*)\b/i;
// A decisive vote actually happened (separates "Council bans X" from "Board urges bans").
const STRONG = /\b(voted?|approv(?:es|ed)|adopt(?:s|ed)|pass(?:es|ed)|enact(?:s|ed)|reject(?:s|ed)|tabl(?:e|ed|es)|defer(?:s|red)?|postpon\w*|defeat(?:s|ed)?)\b/i;
// Advisory / future — NOT an outcome (a board "urges" a ban; a council is "set
// to vote"). Skipped unless a STRONG decision verb is also present.
const ADVISORY = /\b(urges?|recommends?|calls?\s+for|pushes?\s+for|seeks?|wants?|propose[sd]?|considers?|weighs?|looking\s+to|to\s+vote|will\s+vote|set\s+to\s+vote|may\s+vote|to\s+decide|to\s+consider|upcoming|scheduled\s+to)\b/i;

function classify(title) {
  if (ADVISORY.test(title) && !STRONG.test(title)) return null; // advisory/future, no decision yet
  if (FAILED.test(title)) return "failed";
  if (TABLED.test(title)) return "tabled";
  if (PASSED.test(title)) return "passed";
  return null;
}

// Non-geographic sentinels that sometimes sit in policy_alerts.locality.
const SENTINEL = /^(all|none|n\/a|na|unknown|national|federal|us|usa|multiple)$/i;

// Resolve { locality, state }. Prefer the LOCAL BODY name parsed from the title
// (most specific + reliable) over the alert's locality field, which is often a
// sentinel ("ALL") or a bare/occasionally-wrong state code. locality null ⇒
// "skip, not clearly local".
function resolveLocality(alert) {
  const loc = (alert.locality ?? "").trim();
  const stateFromLoc = /^[A-Z]{2}$/.test(loc) ? loc : null;
  // "<Name> City Council / County Commission / Board of Health …"
  const m = (alert.title ?? "").match(/\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+){0,2})\s+(?:City Council|City|County Council|County Commission|County|Board of|Township|Village|Borough|Commission|Aldermen)\b/);
  if (m) return { locality: m[1].trim(), state: stateFromLoc };
  // Fall back to the locality field only if it's a real place (not a sentinel / state code).
  if (loc && !SENTINEL.test(loc) && !stateFromLoc) return { locality: loc, state: null };
  return { locality: null, state: stateFromLoc };
}

async function main() {
  console.log(`\n${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — deriving local_vote_outcomes from policy_alerts\n`);

  // Candidate alerts: local vote / ordinance language.
  const { data: alerts, error } = await sb.from("policy_alerts")
    .select("id, title, locality, source_url, occurs_at, created_at, moderation_status")
    .or("title.ilike.%council vote%,title.ilike.%votes to%,title.ilike.%voted to%,title.ilike.%votes down%,title.ilike.%ordinance%,title.ilike.%city council%,title.ilike.%county commission%,title.ilike.%board of%")
    .limit(2000);
  if (error) { console.error(error.message); process.exit(1); }

  // Already-derived alert ids (idempotency).
  const { data: existing } = await sb.from("local_vote_outcomes").select("policy_alert_id").not("policy_alert_id", "is", null);
  const done = new Set((existing ?? []).map((r) => r.policy_alert_id));

  const rows = [];
  let skipNoOutcome = 0, skipNoLocality = 0, already = 0;
  for (const a of alerts ?? []) {
    if (done.has(a.id)) { already++; continue; }
    const title = a.title ?? "";
    const outcome = classify(title);
    if (!outcome) { skipNoOutcome++; continue; }
    const { locality, state } = resolveLocality(a);
    if (!locality) { skipNoLocality++; continue; }
    const when = a.occurs_at ?? a.created_at;
    rows.push({
      state, locality, vote_date: String(when).slice(0, 10), outcome,
      measure: title.slice(0, 300), description: null,
      source_url: a.source_url ?? null, policy_alert_id: a.id,
    });
  }

  // Collapse syndications: many outlets re-report ONE local ban, each as its
  // own alert. Keep one row per (locality, outcome), earliest date, so the table
  // records distinct votes — not press coverage.
  rows.sort((a, b) => a.vote_date.localeCompare(b.vote_date));
  const seen = new Set();
  const uniq = [];
  let syndic = 0;
  for (const r of rows) {
    const key = `${r.locality.toLowerCase()}|${r.outcome}`;
    if (seen.has(key)) { syndic++; continue; }
    seen.add(key);
    uniq.push(r);
  }
  rows.length = 0;
  rows.push(...uniq);

  console.log(`${alerts?.length ?? 0} candidate alerts · ${already} already derived · ${rows.length} distinct outcomes (${syndic} syndication dupes collapsed)`);
  console.log(`  skipped: ${skipNoOutcome} not a decisive outcome · ${skipNoLocality} no usable locality\n`);
  const byOutcome = rows.reduce((m, r) => ((m[r.outcome] = (m[r.outcome] || 0) + 1), m), {});
  console.log(`  outcomes: ${JSON.stringify(byOutcome)}`);
  for (const r of rows.slice(0, 20)) console.log(`  ${r.outcome.toUpperCase().padEnd(7)} ${r.vote_date} ${r.locality}${r.state ? ", " + r.state : ""} — ${r.measure.slice(0, 56)}`);

  let ok = 0, err = 0;
  if (APPLY && rows.length) {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      // Plain insert — idempotency is the `done` set above (skips alerts already
      // derived); the partial unique index on policy_alert_id is a DB backstop.
      const { error: e, data } = await sb.from("local_vote_outcomes").insert(chunk).select("id");
      if (e) { err++; console.log(`  ✗ batch ${i / 200}: ${e.message?.slice(0, 80)}`); } else ok += data?.length ?? 0;
    }
    console.log(`\n✓ ${ok} inserted, ${err} batch errors.`);
    try {
      await sb.from("scraper_runs").insert({
        source: "extract_local_vote_outcomes", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
        status: err > 0 ? "error" : "success", rows_added: ok, notes: `${ok} outcomes (${JSON.stringify(byOutcome)})`,
      });
    } catch { /* best-effort */ }
  } else if (!APPLY) {
    console.log(`\nDry-run only. Re-run with --apply to write.`);
  }
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
