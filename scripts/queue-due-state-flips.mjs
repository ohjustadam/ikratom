#!/usr/bin/env node
/**
 * queue-due-state-flips.mjs — self-auditing scheduler for FUTURE-DATED legal
 * changes recorded in state_status_flips (migration 0179).
 *
 * Daily: for every flip whose effective_date has arrived AND that the owner
 * hasn't confirmed yet, surface it into the /admin/state-status confirm queue
 * (set the state's needs_review=true + a review_reason describing the change)
 * and — the first time it comes due — notify the owner/admins. It does NOT
 * auto-publish; the owner confirms the new status via the existing confirm UI
 * (so the confirmed-only rule still holds and a bad value never reaches the
 * public map). This is what stops the map silently showing the wrong status
 * past a known flip date (e.g. TN's leaf ban effective Jul 1, 2026).
 *
 * Robustness: the nightly derive-state-status cron rewrites needs_review, so we
 * RE-ASSERT the flag every run until the flip is resolved (the state's admin
 * status already equals the flip's new value). The daily cron also runs this
 * AFTER derive (needs: derive-state-status) so our flag wins for the day.
 *
 *   node --env-file=.env.local scripts/queue-due-state-flips.mjs                        # dry-run
 *   node --env-file=.env.local scripts/queue-due-state-flips.mjs --apply
 *   node --env-file=.env.local scripts/queue-due-state-flips.mjs --as-of 2026-07-02 --dry-run  # test a date
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const asOfIdx = args.indexOf("--as-of");
const AS_OF = asOfIdx >= 0 ? args[asOfIdx + 1] : new Date().toISOString().slice(0, 10);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const FIELD_LABEL = { leaf: "leaf", sevenoh: "7-OH" };
const t0 = Date.now();
const nowIso = () => new Date().toISOString();

async function main() {
  console.log(`${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — state-status flips due on/before ${AS_OF}\n`);

  const { data: due, error } = await sb
    .from("state_status_flips")
    .select("id, state, field, new_status, effective_date, note, source, queued_at")
    .lte("effective_date", AS_OF)
    .order("effective_date", { ascending: true });
  if (error) { console.error("query failed:", error.message); process.exit(1); }

  if (!due || due.length === 0) {
    console.log("✓ No flips are due. Nothing to queue.");
    await recordRun(0);
    return;
  }

  // Resolution check: a flip is done once the state's admin status already
  // equals the flip's new value (the owner confirmed it).
  const states = [...new Set(due.map((f) => f.state))];
  const { data: statusRows } = await sb
    .from("state_status")
    .select("state, admin_leaf_status, admin_7oh_status")
    .in("state", states);
  const adminBy = new Map((statusRows ?? []).map((r) => [r.state, r]));
  const isResolved = (f) => {
    const row = adminBy.get(f.state);
    if (!row) return false;
    return f.field === "leaf" ? row.admin_leaf_status === f.new_status : row.admin_7oh_status === f.new_status;
  };

  const unresolved = due.filter((f) => !isResolved(f));
  const resolvedCount = due.length - unresolved.length;
  if (resolvedCount > 0) console.log(`(${resolvedCount} due flip(s) already confirmed by an admin — skipping)\n`);

  if (unresolved.length === 0) {
    console.log("✓ All due flips already confirmed. Nothing to queue.");
    await recordRun(0);
    return;
  }

  // Group unresolved flips by state (one review_reason can cover several fields).
  const byState = new Map();
  for (const f of unresolved) {
    if (!byState.has(f.state)) byState.set(f.state, []);
    byState.get(f.state).push(f);
  }

  let asserted = 0, fails = 0;
  const newlyDue = [];
  for (const [state, flips] of byState) {
    const reason =
      "⏰ Scheduled legal change now in effect — confirm to publish:\n" +
      flips
        .map((f) => `• ${FIELD_LABEL[f.field]} → ${f.new_status} (effective ${f.effective_date}${f.source ? `, ${f.source}` : ""}). ${f.note ?? ""}`.trim())
        .join("\n");

    console.log(`${state}: ${flips.length} due`);
    for (const f of flips) console.log(`   ${FIELD_LABEL[f.field]} → ${f.new_status} (${f.effective_date})`);

    if (!APPLY) continue;

    const { error: upErr } = await sb
      .from("state_status")
      .upsert(
        { state, needs_review: true, review_reason: reason.slice(0, 2000), updated_at: nowIso() },
        { onConflict: "state" },
      );
    if (upErr) { console.error(`   ✗ ${state}: ${upErr.message}`); fails++; continue; }
    asserted += flips.length;
    for (const f of flips) if (!f.queued_at) newlyDue.push(f);
  }

  // Notify admins ONCE per flip (the first time it comes due), then stamp queued_at.
  if (APPLY && newlyDue.length > 0) {
    await notifyAdmins([...new Set(newlyDue.map((f) => f.state))]);
    const { error: markErr } = await sb
      .from("state_status_flips")
      .update({ queued_at: nowIso() })
      .in("id", newlyDue.map((f) => f.id));
    if (markErr) console.log(`  (couldn't stamp queued_at: ${markErr.message})`);
  }

  console.log(
    APPLY
      ? `\n✓ Re-asserted ${asserted} flip(s) across ${byState.size} state(s) into /admin/state-status (${newlyDue.length} newly due, ${fails} failed).`
      : `\n(dry-run — ${unresolved.length} unresolved flip(s) would be queued. Re-run with --apply.)`,
  );
  await recordRun(APPLY ? asserted : 0);
}

async function notifyAdmins(stateList) {
  const states = stateList.join(", ");
  const { data: admins } = await sb
    .from("profiles")
    .select("id")
    .or("is_owner.eq.true,is_admin.eq.true");
  if (!admins || admins.length === 0) return;
  const rows = admins.map((a) => ({
    user_id: a.id,
    kind: "state_flip",
    title: `⏰ Scheduled legal change in effect: ${states}`,
    body: "A signed kratom-law change is now in effect. Confirm the new status in the queue.",
    link: "/admin/state-status",
  }));
  const { error } = await sb.from("notifications").insert(rows);
  if (error) console.log(`  (admin notify skipped: ${error.message})`);
  else console.log(`  Notified ${rows.length} admin(s).`);
}

async function recordRun(rowsUpdated) {
  try {
    await sb.from("scraper_runs").insert({
      source: "queue_due_state_flips",
      started_at: new Date(t0).toISOString(),
      finished_at: nowIso(),
      status: "success",
      rows_updated: rowsUpdated,
      notes: `as_of=${AS_OF}`,
    });
  } catch { /* best-effort */ }
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
