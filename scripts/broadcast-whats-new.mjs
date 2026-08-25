#!/usr/bin/env node
/**
 * Broadcast a "What's new" notification to every user pointing them
 * to the latest /whats-new patch note.
 *
 * Strict guardrails so we never spam:
 *   - Idempotent via notifications.kind='whats_new' + link=/whats-new/SLUG.
 *     A second run with the same slug is a no-op — we check for an
 *     existing notification per user.
 *   - Targets ALL users with active push_subscriptions OR all profiles
 *     when --all-users is set, OR only users with no state set when
 *     --stateless is set (#19c nudge). Default: push-subscribed users only.
 *   - --dry-run prints the count without inserting.
 *
 * Security guardrail: the patch-note body in the notification is the
 * front-matter `summary` field, NOT the full markdown. The full notes
 * live at /whats-new/<slug>; users click through to see them. This
 * means we don't accidentally include any sensitive internal detail
 * even if the patch-note markdown leaks one.
 *
 * Usage:
 *   node --env-file=.env.local scripts/broadcast-whats-new.mjs \
 *     --slug 2026-05-17-update
 *   node --env-file=.env.local scripts/broadcast-whats-new.mjs \
 *     --slug 2026-05-17-update --all-users
 *   node --env-file=.env.local scripts/broadcast-whats-new.mjs \
 *     --slug 2026-05-17-update --dry-run
 *
 * Briefings (src/content/briefings -> /briefings/<slug>) instead of patch notes:
 *   node --env-file=.env.local scripts/broadcast-whats-new.mjs \
 *     --briefing --slug 7-oh-scheduling-2026 --all-users --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const SLUG = arg("--slug");
const DRY_RUN = args.includes("--dry-run");
const ALL_USERS = args.includes("--all-users");
const STATELESS = args.includes("--stateless");
// --briefing switches the source to src/content/briefings and the link to
// /briefings/<slug>. Default (no flag) is unchanged: patch notes -> /whats-new,
// which is what cron-weekly.yml fires. Never make this the default.
const BRIEFING = args.includes("--briefing");

if (!SLUG) {
  console.error("Usage: --slug 2026-05-17-update [--briefing] [--all-users] [--dry-run]");
  process.exit(1);
}
// SLUG is interpolated into a filesystem path — keep it to the slug charset.
if (!/^[a-z0-9-]+$/.test(SLUG)) {
  console.error(`Invalid --slug "${SLUG}" (expected lowercase letters, digits, hyphens).`);
  process.exit(1);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Read the patch note's front-matter so the notification body matches
// the published summary exactly.
const contentDir = BRIEFING ? "briefings" : "patch-notes";
const filePath = join(process.cwd(), "src", "content", contentDir, `${SLUG}.md`);
let title, summary;
try {
  const raw = readFileSync(filePath, "utf8");
  const fm = matter(raw);
  title = fm.data.title;
  summary = fm.data.summary;
  if (!title || !summary) throw new Error("front-matter missing title or summary");
} catch (e) {
  console.error(`Failed to read ${BRIEFING ? "briefing" : "patch note"} ${SLUG}: ${e.message}`);
  process.exit(1);
}

const link = BRIEFING ? `/briefings/${SLUG}` : `/whats-new/${SLUG}`;
// Dedupe is keyed on (kind, link), so a distinct kind keeps briefing pushes
// from ever colliding with the weekly digest's idempotency check.
const notifKind = BRIEFING ? "briefing" : "whats_new";

console.log(`Broadcasting "${title}"`);
console.log(`Link: ${link}`);
console.log(`Summary: ${summary}`);

// Target user set
let users;
if (STATELESS) {
  // #19c "activate stateless users" nudge: users who never set their state.
  // Setting it unlocks geofenced elections/primaries, voting reminders, and
  // per-legislator kratom stance. Targeted, not a blast to everyone.
  const { data } = await sb.from("profiles").select("id").is("state", null).limit(50000);
  users = (data ?? []).map((r) => r.id);
  console.log(`\nTarget: ${users.length} stateless profiles (state IS NULL)`);
} else if (ALL_USERS) {
  // Every profile row (Supabase Auth handles email verification; if
  // there's a profile row we treat them as a notifiable user).
  const { data } = await sb.from("profiles").select("id").limit(50000);
  users = (data ?? []).map((r) => r.id);
  console.log(`\nTarget: ALL ${users.length} profiles`);
} else {
  // Users with at least one active push subscription
  const { data } = await sb.from("push_subscriptions").select("user_id");
  users = [...new Set((data ?? []).map((r) => r.user_id))];
  console.log(`\nTarget: ${users.length} push-subscribed users`);
}

if (users.length === 0) {
  console.log("No users to notify.");
  process.exit(0);
}

// Dedupe: skip users who already have a whats_new notification for
// this link. Re-runs are idempotent.
const { data: existing } = await sb
  .from("notifications")
  .select("user_id")
  .eq("kind", notifKind)
  .eq("link", link)
  .in("user_id", users);
const alreadyNotified = new Set((existing ?? []).map((r) => r.user_id));
const toNotify = users.filter((id) => !alreadyNotified.has(id));
console.log(`Already notified: ${alreadyNotified.size}`);
console.log(`To notify now: ${toNotify.length}`);

if (toNotify.length === 0) {
  console.log("Everyone already notified.");
  process.exit(0);
}

if (DRY_RUN) {
  console.log("\n[DRY RUN] Would insert notifications. Sample row:");
  console.log({
    user_id: toNotify[0],
    kind: notifKind,
    title,
    body: summary,
    link,
  });
  process.exit(0);
}

// Insert in batches of 500
const BATCH = 500;
let inserted = 0;
for (let i = 0; i < toNotify.length; i += BATCH) {
  const chunk = toNotify.slice(i, i + BATCH).map((user_id) => ({
    user_id,
    kind: notifKind,
    title,
    body: summary,
    link,
  }));
  const { error, data } = await sb.from("notifications").insert(chunk).select("id");
  if (error) {
    console.error(`Batch ${i / BATCH} failed: ${error.message}`);
    continue;
  }
  inserted += data?.length ?? 0;
  process.stdout.write(`  inserted ${inserted}/${toNotify.length}\r`);
}
console.log(`\nDone — ${inserted} notifications inserted.`);
console.log("The fanoutPushNotifications cron will deliver them as web push within the hour.");

try {
  await sb.from("scraper_runs").insert({
    source: "broadcast_whats_new",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: "success",
    rows_updated: inserted,
    notes: `slug=${SLUG} target=${ALL_USERS ? "all" : "push-subscribed"}`,
  });
} catch { /* best-effort */ }
