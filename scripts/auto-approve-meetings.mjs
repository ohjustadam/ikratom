#!/usr/bin/env node
/**
 * auto-approve-meetings.mjs — apply the admin auto-approval policy.
 *
 * AI-seeded municipal_meetings (from extract-news-events.mjs and
 * discover-municipal-meetings.mjs) land as moderation_status =
 * 'pending_review'. This script promotes the high-confidence, sourced
 * ones to 'approved' so they appear on /calendar and fire the 7d/3d/1d
 * reminders — without a manual admin click. Low-confidence or
 * source-less rows stay pending for human review.
 *
 * The policy is admin-tunable on the site_config singleton (editable
 * from /admin/meetings, no deploy):
 *   - meeting_auto_approve_enabled        (default true)
 *   - meeting_auto_approve_min_confidence (default 0.85)
 *   - meeting_auto_approve_require_source (default true)
 *
 * Every auto-approval writes an admin_audit_log row with actor_id=null
 * (system action) recording the confidence + threshold, so the decision
 * is traceable and an admin can reject anything that slipped through.
 *
 * Only future-dated meetings are eligible (a past meeting auto-approved
 * onto the calendar is noise). Runs hourly after the extractors.
 *
 * Run:
 *   node --env-file=.env.local scripts/auto-approve-meetings.mjs
 *   node --env-file=.env.local scripts/auto-approve-meetings.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.slice(2).includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const t0 = Date.now();

// 1. Read the policy from site_config (singleton row).
const { data: cfg } = await sb
  .from("site_config")
  .select("meeting_auto_approve_enabled, meeting_auto_approve_min_confidence, meeting_auto_approve_require_source")
  .maybeSingle();

const enabled = cfg?.meeting_auto_approve_enabled ?? false;
const minConf = Number(cfg?.meeting_auto_approve_min_confidence ?? 0.85);
const requireSource = cfg?.meeting_auto_approve_require_source ?? true;

console.log(`Auto-approve-meetings${DRY ? " [DRY]" : ""} — enabled=${enabled} minConf=${minConf} requireSource=${requireSource}`);

if (!enabled) {
  console.log("  policy disabled — nothing to do");
  await tag("empty", 0, 0);
  process.exit(0);
}

// 2. Candidate pending meetings: future-dated, confident enough.
let q = sb
  .from("municipal_meetings")
  .select("id, state, locality, body_name, meeting_at, ai_confidence, source_url, discovered_via")
  .eq("moderation_status", "pending_review")
  .gte("meeting_at", new Date().toISOString())
  .gte("ai_confidence", minConf)
  .order("meeting_at", { ascending: true })
  .limit(200);
const { data: candidates, error } = await q;
if (error) { console.error("query failed:", error.message); await tag("error", 0, 0); process.exit(1); }

const eligible = (candidates ?? []).filter((m) => !requireSource || (m.source_url && m.source_url.length > 0));
console.log(`  ${candidates?.length ?? 0} confident pending · ${eligible.length} eligible after source gate`);

let approved = 0;
for (const m of eligible) {
  const label = `${m.state} ${m.meeting_at?.slice(0, 10)} ${m.body_name ?? m.locality ?? "(event)"} conf=${m.ai_confidence}`;
  if (DRY) { console.log(`  would approve: ${label}`); continue; }

  const { error: upErr } = await sb
    .from("municipal_meetings")
    .update({
      moderation_status: "approved",
      moderation_reviewed_at: new Date().toISOString(),
      // moderation_reviewed_by stays null → system action (see audit row)
    })
    .eq("id", m.id)
    .eq("moderation_status", "pending_review"); // guard against races
  if (upErr) { console.log(`  ⚠ approve failed ${m.id.slice(0, 8)}: ${upErr.message?.slice(0, 80)}`); continue; }

  approved++;
  console.log(`  ✓ approved: ${label}`);
  try {
    await sb.from("admin_audit_log").insert({
      actor_id: null,
      action: "municipal_meeting_auto_approved",
      target_type: "policy_alert",
      target_id: m.id,
      details: {
        confidence: m.ai_confidence,
        threshold: minConf,
        require_source: requireSource,
        discovered_via: m.discovered_via,
        state: m.state,
        locality: m.locality,
        meeting_at: m.meeting_at,
      },
    });
  } catch { /* audit is best-effort, never blocks approval */ }
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — approved ${approved}/${eligible.length} eligible.`);
await tag(approved > 0 ? "success" : "empty", approved, eligible.length);

async function tag(status, added, processed) {
  if (DRY) return;
  try {
    await sb.from("scraper_runs").insert({
      source: "auto_approve_meetings",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status,
      rows_added: added,
      rows_updated: processed,
      notes: `enabled=${enabled} minConf=${minConf} requireSource=${requireSource} · approved ${added}/${processed}`,
    });
  } catch { /* best-effort */ }
}
