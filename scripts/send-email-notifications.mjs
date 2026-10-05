#!/usr/bin/env node
/**
 * send-email-notifications.mjs — iKratom's email channel.
 *
 * WHY (2026-10-03): the platform had a working email router and a verified
 * sending domain but sent ZERO notification emails — the preference existed,
 * nothing read it. Push reaches 7 of 46 users, so for most members nothing
 * outside the site reached them at all. This runs from GitHub Actions straight
 * against Supabase: it keeps working when Netlify is down, and costs no credits.
 *
 * Modes:
 *   --mode digest     daily. Opted-in users (prefs.email, digest != off; weekly
 *                     users on Mondays) get everything since the last digest,
 *                     grouped, upcoming hearings first. No-state users get it
 *                     all (that is the "prefer not to say" lane).
 *   --mode meetings   hourly. Meetings approved since the last run are emailed
 *                     at once to EVERY opted-in member, whatever their state.
 *   --mode announce --content <file.json> [--audience all|opted-in] [--send]
 *                     one-off feature email. Dry-run unless --send.
 *
 * Common flags: --dry-run (render + count, send nothing), --limit N,
 *               --preview <dir> (write the first 3 rendered emails as .html).
 *
 * Budget: shares email_quota_log with the site's router and never touches the
 * per-provider reserve kept for auth + transactional mail. When the day's quota
 * runs out it stops cleanly; the next digest picks up from the same `since`.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { sendEmail, remainingToday, providerSummary, unsubscribeUrl } from "./lib/email-send.mjs";
import { renderDigest, renderMeetingAlert, renderAnnouncement } from "./lib/email-render.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const MODE = arg("mode", "digest");
const DRY = argv.includes("--dry-run") || (MODE === "announce" && !argv.includes("--send"));
const LIMIT = Number(arg("limit", 1e9));
const PREVIEW = arg("preview", null);
// Email links must always point at the public site. .env.local sets APP_URL to
// localhost for development, which would ship dead links to every inbox.
const PROD_URL = "https://www.ikratom.org";
const envUrl = process.env.EMAIL_APP_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || PROD_URL;
const APP_URL = (/localhost|127\.0\.0\.1/.test(envUrl) ? PROD_URL : envUrl).replace(/\/$/, "");
const SOURCE = { digest: "email_digest", meetings: "email_meeting_alerts", announce: "email_announcement" }[MODE];
if (!SOURCE) { console.error(`unknown --mode ${MODE}`); process.exit(2); }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const startedAt = new Date().toISOString();

// Notification kinds that belong in a member's email, by section. Anything
// not listed (admin queues, security notices, internal tooling) never emails.
const SECTIONS = [
  { title: "Action needed", kinds: ["policy_alert", "new_campaign", "voting_reminder"] },
  { title: "Your state", kinds: ["state_news"] },
  { title: "Around the country", kinds: ["national_news"] },
  { title: "From iKratom", kinds: ["briefing", "whats_new", "reps_added"] },
];
const DIGEST_KINDS = SECTIONS.flatMap((s) => s.kinds);
const MEETING_COLS = "id, state, locality, body_name, meeting_at, format, zoom_url, livestream_url, agenda_url, public_comment_signup_url, public_comment_deadline";

async function lastSuccess(source) {
  const { data } = await sb.from("scraper_runs").select("started_at").eq("source", source).eq("status", "success")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  return data?.started_at ?? null;
}

async function record(status, rows, notes) {
  if (DRY) return;
  await sb.from("scraper_runs").insert({ source: SOURCE, started_at: startedAt, finished_at: new Date().toISOString(), status, rows_updated: rows, notes: notes.slice(0, 900) });
}

/** Members with an email address, joined to their preferences. */
async function members(audience) {
  const [{ data: profiles, error: e1 }, { data: prefs, error: e2 }] = await Promise.all([
    sb.from("profiles").select("id, email, username, state").not("email", "is", null).limit(50_000),
    sb.from("notification_preferences").select("user_id, email, digest").limit(50_000),
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2).message);
  const byUser = new Map(prefs.map((p) => [p.user_id, p]));
  const monday = new Date().getUTCDay() === 1;
  return profiles.filter((p) => {
    const pr = byUser.get(p.id);
    if (pr?.digest === "off") return false; // a global "off" always wins, even for announcements
    if (audience === "all") return true;
    if (!pr?.email) return false;
    return pr.digest !== "weekly" || monday;
  }).map((p) => ({ ...p, weekly: byUser.get(p.id)?.digest === "weekly" }));
}

function writePreview(name, html) {
  if (!PREVIEW) return;
  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, `${name}.html`), html);
}

async function deliver(queue) {
  let budget = DRY ? Infinity : await remainingToday(sb);
  let sent = 0, failed = 0, deferred = 0, previews = 0;
  const errors = [];
  for (const job of queue.slice(0, LIMIT)) {
    if (previews < 3) { writePreview(`${MODE}-${previews + 1}-${job.user.username || job.user.id.slice(0, 8)}`, job.msg.html); previews++; }
    if (DRY) { sent++; continue; }
    if (budget <= 0) { deferred++; continue; }
    const r = await sendEmail(sb, { to: job.user.email, ...job.msg });
    budget--;
    if (r.ok) sent++; else { failed++; if (errors.length < 3) errors.push(r.error); }
  }
  return { sent, failed, deferred, errors };
}

async function runDigest() {
  // A dry run may preview what EVERY member would get (--audience all); a real send never widens the audience.
  const users = await members(DRY ? arg("audience", "opted-in") : "opted-in");
  const now = Date.now();
  const sinceDaily = (await lastSuccess(SOURCE)) ?? new Date(now - 24 * 3600e3).toISOString();
  // Never reach further back than 72h: a long outage must not produce a wall of stale items.
  const floor = new Date(now - 72 * 3600e3).toISOString();
  const since = sinceDaily < floor ? floor : sinceDaily;
  const weekAgo = new Date(now - 7 * 86400e3).toISOString();

  const { data: meetings } = await sb.from("municipal_meetings").select(MEETING_COLS).eq("moderation_status", "approved")
    .gte("meeting_at", new Date(now).toISOString()).lte("meeting_at", new Date(now + 21 * 86400e3).toISOString())
    .order("meeting_at").limit(5);

  const ids = users.map((u) => u.id);
  const notes = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("notifications").select("user_id, kind, title, body, link, created_at")
      .in("user_id", ids.slice(i, i + 200)).in("kind", DIGEST_KINDS).gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(20_000);
    if (error) throw new Error(error.message);
    for (const n of data) (notes.get(n.user_id) ?? notes.set(n.user_id, []).get(n.user_id)).push(n);
  }

  const queue = [];
  for (const u of users) {
    const from = u.weekly ? weekAgo : since;
    const mine = (notes.get(u.id) ?? []).filter((n) => n.created_at > from);
    const sections = [{ title: "Hearings and meetings (every state)", meetings: meetings ?? [] },
      ...SECTIONS.map((s) => ({ title: s.title, items: dedupe(mine.filter((n) => s.kinds.includes(n.kind))) }))];
    const msg = renderDigest({ username: u.username, sections, appUrl: APP_URL, unsubscribeUrl: unsubscribeUrl(APP_URL, u.id), briefLink: "/brief" });
    if (msg.count === 0) continue; // nothing new: send nothing
    queue.push({ user: u, msg: { ...msg, tag: "digest", unsubscribeUrl: unsubscribeUrl(APP_URL, u.id) } });
  }
  // Members with a hearing in their digest go first if the day's quota is tight.
  queue.sort((a, b) => Number(b.msg.subject.startsWith("Hearing")) - Number(a.msg.subject.startsWith("Hearing")));
  const r = await deliver(queue);
  return { ...r, eligible: users.length, withContent: queue.length, since };
}

/**
 * Collapse repeats of the same story into one line. Exact link/title repeats go
 * first; then near-duplicates — the alerts pipeline files one event from four
 * outlets as four alerts ("Federal prosecutors charge store clerk..." x4), so
 * headlines whose significant words overlap >= 45% are treated as one story.
 */
const STOP = new Set("a an the of to in on for and or with by at from as is are was be over after into its their his her this that federal state".split(" "));
const words = (t) => new Set(String(t).toLowerCase().replace(/^[^a-z0-9]*[a-z]+:\s*/, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
function similar(a, b) { let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.max(1, Math.min(a.size, b.size)); }
function dedupe(items) {
  const seen = new Set(), kept = [];
  for (const n of items) {
    const k = n.link || n.title;
    if (seen.has(k)) continue;
    const w = words(n.title);
    if (kept.some((m) => similar(w, m.w) >= 0.45 && w.size >= 3)) continue;
    seen.add(k); kept.push({ ...n, w });
  }
  return kept;
}

async function runMeetings() {
  const since = (await lastSuccess(SOURCE)) ?? new Date(Date.now() - 6 * 3600e3).toISOString();
  const { data: fresh, error } = await sb.from("municipal_meetings").select(MEETING_COLS).eq("moderation_status", "approved")
    .gte("meeting_at", new Date().toISOString()).gt("moderation_reviewed_at", since).order("meeting_at").limit(20);
  if (error) throw new Error(error.message);
  if (!fresh?.length) return { sent: 0, failed: 0, deferred: 0, errors: [], eligible: 0, meetings: 0, since };
  const users = await members(DRY ? arg("audience", "opted-in") : "opted-in");
  const queue = users.map((u) => ({ user: u, msg: { ...renderMeetingAlert({ username: u.username, meetings: fresh, appUrl: APP_URL, unsubscribeUrl: unsubscribeUrl(APP_URL, u.id) }), tag: "meeting", unsubscribeUrl: unsubscribeUrl(APP_URL, u.id) } }));
  const r = await deliver(queue);
  return { ...r, eligible: users.length, meetings: fresh.length, since };
}

async function runAnnounce() {
  const file = arg("content", null);
  if (!file) throw new Error("--content <file.json> is required");
  const content = JSON.parse(fs.readFileSync(file, "utf8"));
  const audience = arg("audience", "all");
  const slug = content.slug || path.basename(file, ".json");
  if (!DRY) {
    const { data: prior } = await sb.from("scraper_runs").select("id").eq("source", SOURCE).eq("status", "success").ilike("notes", `${slug}%`).limit(1);
    if (prior?.length) throw new Error(`announcement "${slug}" was already sent — refusing to send twice`);
  }
  const users = await members(audience);
  const queue = users.map((u) => ({ user: u, msg: { ...renderAnnouncement({ ...content, username: u.username, appUrl: APP_URL, unsubscribeUrl: unsubscribeUrl(APP_URL, u.id) }), tag: "announcement", unsubscribeUrl: unsubscribeUrl(APP_URL, u.id) } }));
  const r = await deliver(queue);
  return { ...r, eligible: users.length, slug, audience };
}

try {
  console.log(`email ${MODE}${DRY ? " (DRY RUN — nothing sent)" : ""} · providers: ${providerSummary()} · app ${APP_URL}`);
  const r = MODE === "digest" ? await runDigest() : MODE === "meetings" ? await runMeetings() : await runAnnounce();
  const summary = `${r.slug ? `${r.slug} · ` : ""}sent ${r.sent} · failed ${r.failed} · deferred ${r.deferred} (quota) · eligible ${r.eligible}` +
    (r.withContent != null ? ` · with-content ${r.withContent}` : "") + (r.meetings != null ? ` · meetings ${r.meetings}` : "") +
    (r.errors.length ? ` · errors: ${r.errors.join(" ; ")}` : "");
  console.log(summary);
  await record(r.failed > 0 && r.sent === 0 ? "error" : r.deferred > 0 ? "partial" : "success", r.sent, summary);
  // exitCode, not exit(): an abrupt exit with fetch sockets still closing trips
  // a libuv assertion on Windows. Same exit status, clean shutdown.
  process.exitCode = r.failed > 0 && r.sent === 0 ? 1 : 0;
} catch (e) {
  console.error(`✗ ${e.message}`);
  await record("error", 0, e.message);
  process.exitCode = 1;
}
