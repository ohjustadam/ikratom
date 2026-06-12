#!/usr/bin/env node
/**
 * fire-voting-reminders.mjs — T-30 / T-7 / T-1 day voting reminders for
 * EVERY approved election in election_dates (#19 PR 2). Runs daily via cron.
 *
 * For each election whose date falls in a reminder window AND whose
 * reminder_Nd_sent_at is NULL, this:
 *   1. Finds recipients — national scope → ALL users; state scope → in-state
 *      users; local scope → city/county match (geofenced).
 *   2. Inserts a `voting_reminder` in-app notification per user (the 0200
 *      category gate auto-skips users who muted notify_voting_reminder).
 *   3. Fans out a web push to each subscription, respecting DND/quiet-hours.
 *   4. Stamps reminder_Nd_sent_at so the next run skips it.
 *
 * Windows are THRESHOLDS, not exact days, so a skipped cron run still fires
 * the reminder on the next run (and the dedup stamp prevents a double-send):
 *   30-day window: election in (7, 30] days out
 *   7-day window:  election in (1, 7] days out
 *   1-day window:  election in [0, 1] days out
 * An election seeded already inside a tighter window simply gets that
 * window's reminder as its first (label shows the real days-out).
 *
 * Run:
 *   node --env-file=.env.local scripts/fire-voting-reminders.mjs
 *   node --env-file=.env.local scripts/fire-voting-reminders.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { canPushUser, loadPushPrefs, recordPush } from "./lib/push-gate.mjs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";
const NOW_MS = Date.now();
const dateStr = (offsetDays) => new Date(NOW_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);

const WINDOWS = [
  { col: "reminder_30d_sent_at", minDays: 8, maxDays: 30, key: "30d" },
  { col: "reminder_7d_sent_at", minDays: 2, maxDays: 7, key: "7d" },
  { col: "reminder_1d_sent_at", minDays: 0, maxDays: 1, key: "1d" },
];

const TYPE_LABEL = { general: "Election day", primary: "Primary", primary_runoff: "Primary runoff", special: "Special election", registration_deadline: "Voter registration deadline" };

/** Recipients for one election, geofenced by scope. */
async function recipientsFor(e) {
  if (e.scope === "national") {
    const { data } = await sb.from("profiles").select("id").limit(50_000);
    return (data ?? []).map((u) => u.id);
  }
  if (e.scope === "local" && e.locality) {
    // "City, ST" → match in-state users whose city OR county equals the city.
    const [cityRaw, stRaw] = e.locality.split(",").map((s) => s.trim());
    const st = (stRaw || e.state || "").toUpperCase();
    const want = (cityRaw || "").toLowerCase();
    const { data } = await sb.from("profiles").select("id, city, county").eq("state", st).limit(50_000);
    return (data ?? []).filter((u) => (u.city || "").toLowerCase() === want || (u.county || "").toLowerCase() === want).map((u) => u.id);
  }
  // state scope (and local without a locality) → all in-state users
  if (!e.state) return [];
  const { data } = await sb.from("profiles").select("id").eq("state", e.state).limit(50_000);
  return (data ?? []).map((u) => u.id);
}

async function fireWindow(win) {
  const lo = dateStr(win.minDays);
  const hi = dateStr(win.maxDays);
  const { data: elections, error: queryErr } = await sb
    .from("election_dates")
    .select("id, scope, state, locality, election_type, title, election_date, registration_deadline")
    .eq("moderation_status", "approved")
    .is(win.col, null)
    .gte("election_date", lo)
    .lte("election_date", hi)
    .order("election_date", { ascending: true })
    .limit(500);

  if (queryErr) {
    // Most likely the reminder_Nd_sent_at column isn't migrated yet — surface it.
    console.log(`  ${win.key}: query failed — ${queryErr.message?.slice(0, 120)}`);
    return { window: win.key, sent: 0, recipients: 0, error: queryErr.message };
  }
  if (!elections || elections.length === 0) {
    console.log(`  ${win.key}: nothing in window (${lo}…${hi})`);
    return { window: win.key, sent: 0, recipients: 0 };
  }

  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:noreply@ikratom.org";
  let webpush = null;
  if (pub && priv) {
    webpush = (await import("web-push")).default;
    webpush.setVapidDetails(subject, pub, priv);
  }

  let totalRecipients = 0;
  for (const e of elections) {
    const daysOut = Math.round((Date.parse(`${e.election_date}T12:00:00Z`) - NOW_MS) / 86_400_000);
    const whenLabel = daysOut <= 0 ? "Today" : daysOut === 1 ? "Tomorrow" : `In ${daysOut} days`;
    const userIds = await recipientsFor(e);

    if (userIds.length === 0) {
      console.log(`    · ${e.title} (no recipients) — stamping anyway`);
      if (!DRY_RUN) await sb.from("election_dates").update({ [win.col]: new Date().toISOString() }).eq("id", e.id);
      continue;
    }

    const title = `🗳️ ${whenLabel}: ${e.title}`;
    const regBit = e.registration_deadline
      ? ` Register to vote by ${new Date(`${e.registration_deadline}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`
      : "";
    const body = `${TYPE_LABEL[e.election_type] ?? "Election"} is ${whenLabel.toLowerCase()}. Make a plan to vote.${regBit}`;
    const link = e.scope === "national" ? "/calendar" : `/calendar?state=${e.state}`;

    if (DRY_RUN) {
      console.log(`    [dry] "${title}" → ${userIds.length} ${e.scope === "national" ? "ALL" : e.state} users`);
      continue;
    }

    // In-app notifications (chunked). The 0200 category gate drops rows for
    // users who muted notify_voting_reminder.
    const rows = userIds.map((uid) => ({ user_id: uid, kind: "voting_reminder", title, body, link }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from("notifications").insert(rows.slice(i, i + 200));
      if (error) console.log(`    ✗ notif chunk: ${error.message?.slice(0, 80)}`);
    }

    // Push fanout — quiet-hours / DND never buzz a muted user; the in-app row stays.
    let pushSent = 0, pushHeld = 0;
    const pushGone = [];
    if (webpush) {
      const prefsMap = await loadPushPrefs(sb, userIds);
      const pushedUsers = new Set();
      const { data: subs } = await sb
        .from("push_subscriptions")
        .select("id, user_id, endpoint, p256dh, auth")
        .in("user_id", userIds)
        .limit(10_000);
      const payload = JSON.stringify({ title, body, link, tag: `voting-reminder-${e.id}-${win.key}` });
      for (const s of subs ?? []) {
        if (!canPushUser(prefsMap.get(s.user_id), NOW_MS)) { pushHeld++; continue; }
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 60 * 60 });
          pushSent++;
          pushedUsers.add(s.user_id);
        } catch (err) {
          const status = err?.statusCode ?? 0;
          if (status === 404 || status === 410) pushGone.push(s.id);
        }
      }
      if (pushGone.length > 0) await sb.from("push_subscriptions").delete().in("id", pushGone);
      await recordPush(sb, [...pushedUsers]);
    }

    await sb.from("election_dates").update({ [win.col]: new Date().toISOString() }).eq("id", e.id);
    totalRecipients += userIds.length;
    console.log(`    ✓ ${e.title}: ${userIds.length} notif, ${pushSent} push${pushHeld > 0 ? `, ${pushHeld} held (quiet/DND)` : ""}`);
  }

  return { window: win.key, sent: elections.length, recipients: totalRecipients };
}

console.log(`Firing voting reminders${DRY_RUN ? " [DRY RUN]" : ""}…\n`);
const t0 = Date.now();
const results = [];
for (const win of WINDOWS) {
  console.log(`Window: ${win.key} (${win.minDays}–${win.maxDays}d out)`);
  results.push(await fireWindow(win));
  console.log("");
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const totalElections = results.reduce((s, r) => s + (r.sent ?? 0), 0);
const totalRecipients = results.reduce((s, r) => s + (r.recipients ?? 0), 0);
console.log(`Done in ${elapsed}s — ${totalElections} election reminders, ${totalRecipients} user notifications.`);

if (!DRY_RUN) {
  try {
    await sb.from("scraper_runs").insert({
      source: "fire_voting_reminders",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: totalElections > 0 ? "success" : "empty",
      rows_added: totalRecipients,
      notes: results.map((r) => `${r.window}: ${r.sent ?? 0} elections, ${r.recipients ?? 0} users`).join(" · ").slice(0, 300),
    });
  } catch { /* best-effort */ }
}
process.exit(0);
