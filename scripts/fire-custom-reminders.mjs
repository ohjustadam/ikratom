/**
 * Fire user-set custom reminders (Phase 3 / matrix sweep).
 *
 * Runs hourly. Reads rows from user_custom_reminders where remind_at
 * is in the past and fired_at IS NULL and cancelled_at IS NULL.
 * For each, inserts a row into the notifications table — the existing
 * push fan-out then delivers it like any other notification.
 *
 * No reinvention of the push path: we just emit notifications and let
 * the existing infra (src/modules/notifications/push-fanout.ts) do
 * its job. Same pattern bill_subscriptions + meeting reminders use.
 *
 * Idempotent: fired_at stamp prevents re-fire. If the script crashes
 * mid-batch, retried rows just notice fired_at is set and skip.
 *
 * Usage:
 *   node --env-file=.env.local scripts/fire-custom-reminders.mjs
 *   node --env-file=.env.local scripts/fire-custom-reminders.mjs --dry-run
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const APP_URL = process.env.APP_URL || "https://www.ikratom.org";

// =============================================================
// Build a link to the thing the reminder is about. This is what the
// push notification click takes the user to. For pure custom (no
// target_id) we send them to /reminders.
// =============================================================
function linkFor(reminder) {
  switch (reminder.target_kind) {
    case "bill":      return `/bills/${reminder.target_id}`;
    case "meeting":   return `/meetings/${reminder.target_id}`;
    case "campaign":  return `/campaigns/${reminder.target_id}`;
    case "legislator":return `/legislators/${reminder.target_id}/briefing`;
    case "news_item": return `/news/${reminder.target_id}`;
    case "custom":
    default:          return `/reminders`;
  }
}

// =============================================================
// Pull due reminders (the partial index makes this query trivial)
// =============================================================
const nowIso = new Date().toISOString();
const { data: due, error } = await sb
  .from("user_custom_reminders")
  .select("id, user_id, target_kind, target_id, title, message, remind_at")
  .lte("remind_at", nowIso)
  .is("fired_at", null)
  .is("cancelled_at", null)
  .order("remind_at", { ascending: true })
  .limit(500);

if (error) {
  console.error(`Query failed: ${error.message}`);
  process.exit(1);
}

if (!due || due.length === 0) {
  console.log("No reminders due.");
  // A quiet run must still write telemetry — the staleness pager can't tell
  // "nothing due" from "script dead" otherwise (found 2026-07-16: three quiet
  // ticks in a row read as never-observed).
  try {
    await sb.from("scraper_runs").insert({
      source: "fire_custom_reminders",
      started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      status: "empty", rows_updated: 0, notes: "no reminders due",
    });
  } catch { /* best-effort */ }
  process.exit(0);
}

console.log(`Found ${due.length} reminder(s) due${DRY_RUN ? " (DRY RUN)" : ""}`);

let fired = 0;
let failed = 0;
for (const r of due) {
  const link = linkFor(r);
  const notifRow = {
    user_id: r.user_id,
    kind: `custom_reminder:${r.target_kind}`,
    title: r.title,
    body: r.message ?? null,
    link,
  };

  if (DRY_RUN) {
    console.log(`  [DRY] ${r.user_id.slice(0, 8)} · ${r.target_kind} · ${r.title.slice(0, 50)} → ${link}`);
    continue;
  }

  // 1. Insert into notifications — the push fan-out picks it up.
  const { error: notifErr } = await sb.from("notifications").insert(notifRow);
  if (notifErr) {
    console.error(`  ⚠ notification insert failed (reminder ${r.id.slice(0, 8)}): ${notifErr.message}`);
    failed++;
    continue;
  }

  // 2. Stamp the reminder as fired so we don't re-process it next hour.
  // Done as a separate statement (not part of a transaction) because if
  // the notification insert succeeds but the stamp fails, the user
  // gets a duplicate next hour — annoying but not corrupting. Better
  // than missing it entirely.
  const { error: stampErr } = await sb
    .from("user_custom_reminders")
    .update({ fired_at: new Date().toISOString() })
    .eq("id", r.id);
  if (stampErr) {
    console.error(`  ⚠ stamp failed for reminder ${r.id.slice(0, 8)}: ${stampErr.message} (notification was sent — possible duplicate next hour)`);
  }

  fired++;
}

console.log(`\nDone — ${fired} fired, ${failed} failed`);

// Telemetry — user-set reminders are a user-facing hourly automation; without
// this row the staleness monitor could never detect it dying (audit 2026-07-16).
try {
  await sb.from("scraper_runs").insert({
    source: "fire_custom_reminders",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: failed > 0 && fired === 0 ? "error" : fired > 0 ? "success" : "empty",
    rows_updated: fired,
    notes: `${fired} fired · ${failed} failed`,
  });
} catch { /* best-effort */ }
