#!/usr/bin/env node
/**
 * reject-wrongstate-pending-alerts.mjs — auto-reject PENDING policy_alerts whose
 * stored locality contradicts the state named in the article TITLE. The per-state
 * Google-News RSS query mis-tags national stories to a state (a Michigan story
 * labeled Indiana), and those land in the pending "intel queue" the owner has to
 * hand-review. The linked news_items.state carries the SAME mis-tag, so
 * audit-alert-localities' source-state reconcile can't catch these — the article
 * TITLE (the real headline) is the trustworthy signal.
 *
 * Conservative rule: reject ONLY when the title names one or more states, the
 * stored locality is NOT among them, and at least one other state IS named. If
 * the title names the stored state (or names no state at all), leave it alone.
 *
 *   node --env-file=.env.local scripts/reject-wrongstate-pending-alerts.mjs           # dry-run
 *   node --env-file=.env.local scripts/reject-wrongstate-pending-alerts.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const t0 = Date.now();

const NAME_TO_ABBR = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const STATE_ABBRS = new Set(Object.values(NAME_TO_ABBR));

function statesNamedInTitle(title) {
  const t = ` ${String(title || "").toLowerCase()} `;
  const found = new Set();
  // Longest names first so "west virginia" wins over "virginia".
  for (const name of Object.keys(NAME_TO_ABBR).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) found.add(NAME_TO_ABBR[name]);
  }
  return found;
}

// Range-paginated: a bare .limit(1000) silently scanned an arbitrary 1000-row
// window — above that, wrong-state alerts outside the window were never
// rejected (audit 2026-07-16).
const alerts = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from("policy_alerts")
    .select("id, title, locality")
    .eq("moderation_status", "pending")
    .order("id")
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  alerts.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const specific = (alerts ?? []).filter((a) => STATE_ABBRS.has(String(a.locality ?? "").toUpperCase()));
console.log(`${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — ${specific.length} pending state-specific alerts\n`);

const reject = [];
for (const a of specific) {
  const stored = String(a.locality).toUpperCase();
  const named = statesNamedInTitle(a.title);
  if (named.size === 0) continue;       // title names no state → can't judge, leave
  if (named.has(stored)) continue;      // locality IS named in the title → keep
  reject.push({ a, derived: [...named].join("/") }); // locality not named, another state is → wrong
}

console.log(`${reject.length} wrong-state pending alerts:`);
for (const { a, derived } of reject) console.log(`  ${String(a.locality).padEnd(4)}→${derived.padEnd(6)} ${(a.title ?? "").slice(0, 64)}`);

let rejected = 0;
if (APPLY && reject.length) {
  // Per-row, NOT a batch .in(), so each rejection carries the state that was
  // actually named in the headline. A rejection with no recorded reason is
  // indistinguishable from a blanket denial when someone reviews the queue
  // later — 330 alerts sat rejected with a null moderation_note, which is
  // exactly why the auto-resolver read as "denies everything with no legit
  // reason". The reason was known right here and thrown away.
  const nowIso = new Date().toISOString();
  for (const { a, derived } of reject) {
    const note = `Locality "${a.locality}" is not named in the headline, which names ${derived} instead — `
      + `auto-rejected as a wrong-state alert (reject-wrongstate-pending-alerts).`;
    const { error: upErr } = await sb
      .from("policy_alerts")
      .update({
        moderation_status: "rejected",
        moderation_note: note.slice(0, 500),
        moderated_at: nowIso,
      })
      .eq("id", a.id);
    if (upErr) { console.error(`  ⚠ ${a.id.slice(0, 8)}: ${upErr.message.slice(0, 70)}`); continue; }
    rejected++;
  }
  console.log(`\n✅ Rejected ${rejected} wrong-state pending alert(s).`);
} else if (reject.length) {
  console.log(`\n(dry-run — re-run with --apply to reject these.)`);
}

// Telemetry on EVERY completed apply run, including the no-op.
//
// This used to live inside the `reject.length` branch, so a clean sweep — the
// healthy, normal outcome — wrote nothing at all. The job ran green in
// cron-daily every single day while check-cron-staleness saw the source as 50+
// days old and paged the owner about it. "Nothing to do" is a successful run
// and has to be recorded as one, or silence gets read as failure.
if (APPLY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "reject_wrongstate_pending_alerts",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: rejected > 0 ? "success" : "empty",
      rows_updated: rejected,
      notes: rejected > 0
        ? `rejected ${rejected} geo-mismatched pending alerts`
        : `clean — 0 of ${specific.length} pending state-specific alerts were geo-mismatched`,
    });
  } catch { /* best-effort */ }
}
process.exit(0);
