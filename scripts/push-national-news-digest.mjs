#!/usr/bin/env node
/**
 * push-national-news-digest.mjs — one daily digest of kratom news from the REST
 * of the country.
 *
 * WHY. push-state-news.mjs only ever reaches in-state users: a Florida advocate
 * never hears that Ohio moved, and the people most able to act early on a
 * spreading ban are exactly the ones who cannot see it coming. This is the
 * counterpart — "news for the country and other states", condensed the same way
 * the state notification is, so the answer to "tell everyone about everything"
 * is not fifty separate pushes a day.
 *
 * CONDENSED, DELIBERATELY. One notification per user per day, carrying up to
 * MAX_ITEMS headlines. Per-item pushes are what push-state-news does, and that
 * only stays tolerable because a single state's volume is low. Nationally it
 * would be notification fatigue, which ends with the user disabling the category
 * and missing the alert that mattered.
 *
 * WHAT EACH USER SEES. Items from their OWN state are excluded: they already
 * received those individually from push-state-news, and repeating them in the
 * digest is the same story twice. National items (state IS NULL) go to everyone.
 * A user with no state on their profile gets the unfiltered set.
 *
 * GATING. kind='national_news' maps to the 'news' category in
 * notification_category() (migration 0251), so notify_news=false suppresses this
 * at the DB trigger. Do not rename the kind without updating that function, or
 * the digest silently becomes ungated.
 *
 * DELIVERY. This inserts `notifications` rows; the hourly fanoutPushNotifications
 * cron (api/cron/fire-waves) turns them into web pushes. Same path as every other
 * notification script — no web-push calls here.
 *
 * EMAIL. Not sent from here, because this platform has no transactional email
 * sender at all (no resend/nodemailer/sendgrid dependency exists, and CLAUDE.md
 * makes "no transactional email service" a v1 product rule). When an email
 * channel is chosen, it belongs in the shared fan-out, not in this script —
 * otherwise every notification source grows its own copy.
 *
 * WINDOW. From the last successful run of this source, so a missed day is picked
 * up rather than skipped, clamped to MAX_WINDOW_H to stop a long outage from
 * dumping a week of headlines into one notification.
 *
 * Run:
 *   node --env-file=.env.local scripts/push-national-news-digest.mjs
 *   node --env-file=.env.local scripts/push-national-news-digest.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const SOURCE = "push_national_news_digest";
const MAX_ITEMS = 5;            // headlines carried in one digest
const MIN_RELEVANCE = 0.85;     // same bar as push-state-news — this is a push, not a feed
const DEFAULT_WINDOW_H = 24;
const MAX_WINDOW_H = 72;        // a long outage must not become a week-long digest
const RESEND_GUARD_H = 20;      // one digest per user per day, even if the cron double-fires

const t0 = Date.now();

// ── 1. Window: resume from the last successful run, clamped. ────────────────
const { data: lastRun } = await sb
  .from("scraper_runs")
  .select("finished_at")
  .eq("source", SOURCE)
  .eq("status", "success")
  .order("finished_at", { ascending: false })
  .limit(1);

// --window-hours N overrides the resume logic. Two real uses: rehearsing the
// digest against a quiet week (the 24h window is legitimately empty on most
// days at current news volume), and backfilling one after an outage. It bypasses
// the MAX_WINDOW_H clamp on purpose — an operator asking for 168h means it.
const wIdx = args.indexOf("--window-hours");
const windowOverrideH = wIdx >= 0 ? Number(args[wIdx + 1]) : null;

const clampFloor = Date.now() - MAX_WINDOW_H * 3600_000;
const lastAt = lastRun?.[0]?.finished_at ? new Date(lastRun[0].finished_at).getTime() : null;
const sinceMs = Number.isFinite(windowOverrideH) && windowOverrideH > 0
  ? Date.now() - windowOverrideH * 3600_000
  : Math.max(clampFloor, lastAt ?? Date.now() - DEFAULT_WINDOW_H * 3600_000);
const since = new Date(sinceMs).toISOString();
console.log(`National news digest${DRY_RUN ? " [DRY RUN]" : ""} — window since ${since.slice(0, 16)}`);

// ── 2. Candidate items. Same quality gates as push-state-news, plus national. ─
const { data: items, error } = await sb
  .from("news_items")
  .select("id, state, title, url, source_name, published_at, ai_relevance_score")
  .gte("ai_relevance_score", MIN_RELEVANCE)
  .gte("published_at", since)
  .not("body_has_kratom_keyword", "is", false)
  .not("body_extracted_at", "is", null)
  .order("ai_relevance_score", { ascending: false })
  .order("published_at", { ascending: false })
  .limit(40);
if (error) { console.error("news query failed:", error.message); await tag("error", 0, 0, error.message.slice(0, 200)); process.exit(1); }

// Declared BEFORE the empty-exit below: tag() reads it, and reading a
// not-yet-initialised const throws even under ?. — inside tag()'s try/catch that
// would silently drop the run's telemetry row, which is the one thing that must
// never go missing quietly.
const states = [...new Set((items ?? []).map((i) => i.state).filter(Boolean))];

if (!items?.length) {
  console.log("  no qualifying items in window — nothing to digest");
  await tag("empty", 0, 0);
  process.exit(0);
}
console.log(`  ${items.length} qualifying item(s) across ${states.length} state(s) + ${items.filter((i) => !i.state).length} national`);

// ── 3. Recipients: everyone. Own-state items are filtered per user below. ────
const { data: users, error: uErr } = await sb.from("profiles").select("id, state").limit(50_000);
if (uErr) { console.error("profiles query failed:", uErr.message); await tag("error", 0, 0, uErr.message.slice(0, 200)); process.exit(1); }

// Already digested recently? One per user per day regardless of cron cadence.
const { data: recent } = await sb
  .from("notifications")
  .select("user_id")
  .eq("kind", "national_news")
  .gte("created_at", new Date(Date.now() - RESEND_GUARD_H * 3600_000).toISOString())
  .limit(50_000);
const alreadySent = new Set((recent ?? []).map((r) => r.user_id));

const rows = [];
let skippedRecent = 0;
let skippedNothingNew = 0;
for (const u of users ?? []) {
  if (alreadySent.has(u.id)) { skippedRecent++; continue; }
  // Their own state's stories already arrived individually via push-state-news.
  const forUser = items.filter((i) => !i.state || i.state !== u.state).slice(0, MAX_ITEMS);
  if (forUser.length === 0) { skippedNothingNew++; continue; }

  const scopes = [...new Set(forUser.map((i) => i.state ?? "national"))];
  const lead = forUser[0].title.slice(0, 90);
  rows.push({
    user_id: u.id,
    kind: "national_news",
    title: `📰 Kratom news across the country (${forUser.length})`,
    // The lead headline earns the tap; the scope list says why it is not their
    // state's feed, so the digest reads as coverage rather than a misfire.
    body: `${lead} — plus ${forUser.length - 1} more from ${scopes.slice(0, 4).join(", ")}`,
    link: "/news",
  });
}

console.log(`  ${rows.length} user(s) to notify · ${skippedRecent} already digested in ${RESEND_GUARD_H}h · ${skippedNothingNew} had nothing outside their state`);

if (DRY_RUN) {
  if (rows[0]) console.log(`  [dry] sample → ${rows[0].title}\n         ${rows[0].body}`);
  console.log("  [dry] no rows written");
  process.exit(0);
}

// ── 4. Insert. The category-gate trigger drops rows for users who muted news. ─
let inserted = 0;
for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200);
  const { error: insErr, count } = await sb.from("notifications").insert(chunk, { count: "exact" });
  if (insErr) console.log(`    ✗ notif chunk: ${insErr.message?.slice(0, 80)}`);
  else inserted += count ?? chunk.length;
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nDone in ${elapsed}s — ${inserted} digest notification(s) from ${items.length} item(s).`);
// "success" only when something was actually delivered: an empty run is 'empty',
// which is what makes the resume window above advance honestly.
await tag(inserted > 0 ? "success" : "empty", inserted, rows.length);

async function tag(status, added, processed, errMsg = null) {
  try {
    await sb.from("scraper_runs").insert({
      source: SOURCE,
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status,
      rows_added: added,
      rows_updated: processed,
      error_message: errMsg,
      notes: `${items?.length ?? 0} items · ${states?.length ?? 0} states · ${added} digests sent`,
    });
  } catch { /* best-effort */ }
}
