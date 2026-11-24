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
 *                     users, and members quiet for 30 days who never picked
 *                     Daily, on Mondays: lib/digest-cadence.mjs) get everything since the last digest,
 *                     grouped, upcoming hearings first. No-state users get it
 *                     all (that is the "prefer not to say" lane).
 *   --mode meetings   hourly. Meetings approved since the last run are emailed
 *                     at once to EVERY opted-in member, whatever their state.
 *   --mode announce --content <file.json> [--audience all|opted-in] [--send]
 *                     one-off feature email. Dry-run unless --send.
 *
 * Common flags: --dry-run (render + count, send nothing), --limit N,
 *               --preview <dir> (write the first 3 rendered emails as .html),
 *               --only <user-id> (TEST: send to that one member, ignoring their
 *               email preference; records NOTHING — no telemetry, no "already
 *               sent" mark, no digest/meeting watermark — so the real run after
 *               it is unaffected).
 *
 * Budget: shares email_quota_log with the site's router and never touches the
 * per-provider reserve kept for auth + transactional mail. When the day's quota
 * runs out it stops cleanly. Every delivered email is written to the
 * `email_deliveries` ledger (migration 0326, scripts/lib/email-ledger.mjs), so
 * the next run skips what each member already has and serves the members
 * emailed longest ago first. --only and --dry-run write nothing to it.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { sendEmail, remainingToday, providerSummary, unsubscribeUrl, cadenceUrl } from "./lib/email-send.mjs";
import { digestCadence, weeklySince, CADENCE_LINKS_LIVE } from "./lib/digest-cadence.mjs";
import { renderDigest, renderMeetingAlert, renderAnnouncement } from "./lib/email-render.mjs";
import { isDeliverable, digestHearings } from "./lib/email-select.mjs";
import { dedupeStories } from "./lib/story-dedupe.mjs";
import { SECTIONS, DIGEST_KINDS, dedupeByLink } from "./lib/digest-sections.mjs";
import { KEEP_DAYS, fetchAll, digestRef, lastSentByUser, deliveredKeys, digestSinceFor, byPriority } from "./lib/email-ledger.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const MODE = arg("mode", "digest");
const DRY = argv.includes("--dry-run") || (MODE === "announce" && !argv.includes("--send"));
const LIMIT = Number(arg("limit", 1e9));
const PREVIEW = arg("preview", null);
const ONLY = arg("only", null);
if (ONLY && !/^[0-9a-f-]{36}$/i.test(ONLY)) { console.error("--only needs a user id"); process.exit(2); }
// Email links must always point at the public site. .env.local sets APP_URL to
// localhost for development, which would ship dead links to every inbox.
const PROD_URL = "https://www.ikratom.org";
const envUrl = process.env.EMAIL_APP_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || PROD_URL;
const APP_URL = (/localhost|127\.0\.0\.1/.test(envUrl) ? PROD_URL : envUrl).replace(/\/$/, "");
const SOURCE = { digest: "email_digest", meetings: "email_meeting_alerts", announce: "email_announcement" }[MODE];

// Click counting (scripts/email-clicks.mjs) sends links through /e/<kind>/,
// which only works once the /e/ route (src/app/e/[kind]) is deployed. Check it first,
// at the Netlify origin because Cloudflare challenges CI, and send plain links
// if it fails: a missing redirect must never put a dead link in an inbox.
const PROBE_ORIGIN = APP_URL === PROD_URL ? (process.env.WATCHDOG_ORIGIN_URL || "https://main--ikratom.netlify.app").replace(/\/+$/, "") : APP_URL;
async function clickPathsLive() {
  try {
    const r = await fetch(`${PROBE_ORIGIN}/e/probe/notifications?k=1`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const loc = r.headers.get("location") ?? "";
    const to = new URL(loc, PROBE_ORIGIN);
    // Relative only. The first build redirected to the deploy's own
    // <id>--ikratom.netlify.app address, which signs readers out (2026-10-30).
    return r.status >= 300 && r.status < 400 && /^\/(?![/\\])/.test(loc) &&
      to.pathname === "/notifications" && to.searchParams.get("k") === "1";
  } catch { return false; }
}
let VIA = false;
if (!SOURCE) { console.error(`unknown --mode ${MODE}`); process.exit(2); }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const startedAt = new Date().toISOString();

// Which notification kinds email, by section: scripts/lib/digest-sections.mjs.
const MEETING_COLS = "id, state, locality, body_name, meeting_at, format, zoom_url, livestream_url, agenda_url, public_comment_signup_url, public_comment_deadline";

async function lastSuccess(source) {
  const { data } = await sb.from("scraper_runs").select("started_at").eq("source", source).eq("status", "success")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  return data?.started_at ?? null;
}

async function record(status, rows, notes) {
  if (DRY || ONLY) return; // a test send must not move any watermark
  await sb.from("scraper_runs").insert({ source: SOURCE, started_at: startedAt, finished_at: new Date().toISOString(), status, rows_updated: rows, notes: notes.slice(0, 900) });
}

/**
 * The delivery ledger (migration 0326). A read failure must not stop the
 * day's email: it logs, and the run behaves as it did before the ledger.
 */
let LEDGER_OK = true;
async function ledger(makeQuery) {
  if (ONLY) return []; // a test send goes out whatever the member already has
  try { return await fetchAll(makeQuery); } catch (e) {
    LEDGER_OK = false;
    console.warn(`  ! email_deliveries unreadable (${e.message}): no skip-already-sent this run`);
    return [];
  }
}
async function remember(user, refs) {
  if (DRY || ONLY || !LEDGER_OK || !refs?.length) return;
  const { error } = await sb.from("email_deliveries")
    .upsert(refs.map((r) => ({ ...r, user_id: user.id })), { onConflict: "source,ref,user_id", ignoreDuplicates: true });
  if (error) console.warn(`  ! ledger write failed: ${error.message}`);
}

/** Members with an email address, joined to their preferences. Paged: PostgREST returns at most 1,000 rows. */
async function members(audience) {
  const [profiles, prefs] = await Promise.all([
    fetchAll(() => sb.from("profiles").select("id, email, username, state, last_seen_at, created_at").not("email", "is", null).order("id")),
    fetchAll(() => sb.from("notification_preferences").select("user_id, email, digest").order("user_id")),
  ]);
  const byUser = new Map(prefs.map((p) => [p.user_id, p]));
  if (ONLY) return profiles.filter((p) => p.id === ONLY).map((p) => ({ ...p, weekly: false }));
  const monday = new Date().getUTCDay() === 1;
  return profiles.filter((p) => {
    if (!isDeliverable(p.email)) return false; // test addresses: a 422 that still costs quota
    const pr = byUser.get(p.id);
    if (pr?.digest === "off") return false; // a global "off" always wins, even for announcements
    if (audience === "all") return true;
    if (!pr?.email) return false;
    return pr.digest !== "weekly" || monday;
  }).map((p) => ({ ...p, digest: byUser.get(p.id)?.digest ?? "instant", weekly: byUser.get(p.id)?.digest === "weekly" }));
}

/** auth.users last_sign_in_at by member, or null when it can't be read (then nobody is treated as quiet). */
async function lastSignIns() {
  const out = new Map();
  try {
    for (let page = 1; page <= 500; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      for (const u of data.users) out.set(u.id, u.last_sign_in_at ?? null);
      if (data.users.length < 1000) break;
    }
    return out;
  } catch (e) {
    console.warn(`  ! sign-in times unreadable (${e.message}): no quiet-member weekly digest this run`);
    return null;
  }
}

/**
 * Quiet members (scripts/lib/digest-cadence.mjs) get the digest on Mondays only.
 * Sets u.cadence on every member and drops the quiet ones on other days.
 */
async function applyCadence(all) {
  const signIns = ONLY ? null : await lastSignIns();
  const monday = new Date().getUTCDay() === 1;
  let quietHeld = 0, quiet = 0;
  const users = [];
  for (const u of all) {
    const cadence = signIns
      ? digestCadence({ digest: u.digest, lastSeenAt: u.last_seen_at, lastSignInAt: signIns.get(u.id), createdAt: u.created_at })
      : (u.weekly ? "weekly" : "daily");
    if (cadence === "quiet") { quiet++; if (!monday) { quietHeld++; continue; } }
    users.push({ ...u, cadence, weekly: cadence !== "daily" });
  }
  return { users, quiet, quietHeld };
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
    if (r.ok) { sent++; await remember(job.user, job.refs); } else { failed++; if (errors.length < 3) errors.push(r.error); }
  }
  return { sent, failed, deferred, errors };
}

async function runDigest() {
  // A dry run may preview what EVERY member would get (--audience all); a real send never widens the audience.
  const { users, quiet, quietHeld } = await applyCadence(await members(DRY ? arg("audience", "opted-in") : "opted-in"));
  const now = Date.now();
  const last = await lastSuccess(SOURCE);
  // One digest a day, whoever starts it. GitHub ran the 10:17 UTC schedule nine
  // hours late on 2026-10-05 and a manual run four minutes after it sent most
  // members the same email twice. --force overrides.
  if (!DRY && !ONLY && last && now - Date.parse(last) < 12 * 3600e3 && !argv.includes("--force")) {
    console.log(`digest already sent at ${last} — skipping (one per day; --force to override)`);
    process.exit(0);
  }
  const sinceDaily = last ?? new Date(now - 24 * 3600e3).toISOString();
  // Never reach further back than 72h: a long outage must not produce a wall of stale items.
  const floor = new Date(now - 72 * 3600e3).toISOString();
  const since = sinceDaily < floor ? floor : sinceDaily;
  const weekAgo = new Date(now - 7 * 86400e3).toISOString();

  const { data: meetings } = await sb.from("municipal_meetings").select(`${MEETING_COLS}, moderation_reviewed_at`).eq("moderation_status", "approved")
    .gte("meeting_at", new Date(now).toISOString()).lte("meeting_at", new Date(now + 21 * 86400e3).toISOString())
    .order("meeting_at").limit(50);

  const ids = users.map((u) => u.id);
  const notes = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    // Paged: 200 members' week can pass PostgREST's 1,000-row cap, which a bigger limit never lifted.
    const data = await fetchAll(() => sb.from("notifications").select("user_id, kind, title, body, link, created_at")
      .in("user_id", ids.slice(i, i + 200)).in("kind", DIGEST_KINDS).gte("created_at", weekAgo).order("created_at", { ascending: false }).order("id"));
    for (const n of data) (notes.get(n.user_id) ?? notes.set(n.user_id, []).get(n.user_id)).push(n);
  }

  // A what's-new post that already went out as its own announcement email must
  // not come back as a digest line the next morning.
  const { data: announced } = await sb.from("scraper_runs").select("notes").eq("source", "email_announcement")
    .eq("status", "success").gte("started_at", weekAgo).limit(50);
  const emailedLinks = new Set((announced ?? []).map((a) => `/whats-new/${String(a.notes).split(" ")[0]}`));

  // Each member's own last digest: one skipped for quota yesterday gets both days,
  // and the queue below serves the members emailed longest ago first.
  const lastSent = lastSentByUser(await ledger(() => sb.from("email_deliveries").select("user_id, sent_at")
    .eq("source", "digest").gte("sent_at", floor).order("user_id").order("ref")));
  const ref = digestRef(now);

  const queue = [];
  for (const u of users) {
    const from = u.weekly ? weeklySince(weekAgo, lastSent.get(u.id)) : digestSinceFor(since, floor, lastSent.get(u.id));
    const mine = (notes.get(u.id) ?? []).filter((n) => n.created_at > from && !(n.kind === "whats_new" && emailedLinks.has(n.link)));
    const sections = [{ title: "Hearings and meetings (every state)", meetings: digestHearings(meetings, from, now) },
      ...SECTIONS.map((s) => { const mineHere = mine.filter((n) => s.kinds.includes(n.kind)); return { title: s.title, items: s.dedupe === "link" ? dedupeByLink(mineHere) : dedupeStories(mineHere) }; })];
    const msg = renderDigest({ username: u.username, sections, appUrl: APP_URL, unsubscribeUrl: unsubscribeUrl(APP_URL, u.id), briefLink: "/brief", via: VIA && "digest",
      cadence: u.cadence, switchUrl: CADENCE_LINKS_LIVE ? cadenceUrl(APP_URL, u.id, u.cadence === "daily" ? "weekly" : "daily") : null });
    if (msg.count === 0) continue; // nothing new: send nothing
    queue.push({ user: u, refs: [{ source: "digest", ref }], msg: { ...msg, tag: "digest", unsubscribeUrl: unsubscribeUrl(APP_URL, u.id) } });
  }
  // A hearing first if the day's quota is tight, then whoever waited longest.
  queue.sort(byPriority(lastSent));
  const r = await deliver(queue);
  return { ...r, eligible: users.length, withContent: queue.length, since, quiet, quietHeld };
}

async function runMeetings() {
  // --since is honoured only with --only (a test send can look back further
  // without moving the real watermark).
  const since = (ONLY && arg("since", null)) || (await lastSuccess(SOURCE)) || new Date(Date.now() - 6 * 3600e3).toISOString();
  const { data: fresh, error } = await sb.from("municipal_meetings").select(MEETING_COLS).eq("moderation_status", "approved")
    .gte("meeting_at", new Date().toISOString()).gt("moderation_reviewed_at", since).order("meeting_at").limit(20);
  if (error) throw new Error(error.message);
  if (!fresh?.length) return { sent: 0, failed: 0, deferred: 0, errors: [], eligible: 0, meetings: 0, since };
  const users = await members(DRY ? arg("audience", "opted-in") : "opted-in");
  // A run that ran out of quota keeps the old watermark, so the next run sees
  // the same meetings again: send each member only the ones they lack.
  const had = deliveredKeys(await ledger(() => sb.from("email_deliveries").select("ref, user_id")
    .eq("source", "meeting").in("ref", fresh.map((m) => String(m.id))).order("user_id").order("ref")));
  const queue = [];
  for (const u of users) {
    const mine = fresh.filter((m) => !had.has(`${m.id}:${u.id}`));
    if (!mine.length) continue;
    queue.push({ user: u, refs: mine.map((m) => ({ source: "meeting", ref: String(m.id) })),
      msg: { ...renderMeetingAlert({ username: u.username, meetings: mine, appUrl: APP_URL, unsubscribeUrl: unsubscribeUrl(APP_URL, u.id), via: VIA && "hearing" }), tag: "meeting", unsubscribeUrl: unsubscribeUrl(APP_URL, u.id) } });
  }
  const r = await deliver(queue);
  return { ...r, eligible: users.length, meetings: fresh.length, since };
}

async function runAnnounce() {
  const file = arg("content", null);
  if (!file) throw new Error("--content <file.json> is required");
  const content = JSON.parse(fs.readFileSync(file, "utf8"));
  // md_file: send a site page (briefing/report) whole, from the same file the page renders.
  if (content.md_file) content.md = fs.readFileSync(content.md_file, "utf8");
  const audience = arg("audience", "all");
  const slug = content.slug || path.basename(file, ".json");
  if (!DRY && !ONLY) {
    const { data: prior } = await sb.from("scraper_runs").select("id").eq("source", SOURCE).eq("status", "success").ilike("notes", `${slug}%`).limit(1);
    if (prior?.length) throw new Error(`announcement "${slug}" was already sent — refusing to send twice`);
  }
  // A quota-cut announcement records "partial", so it may run again: skip whoever has it.
  const had = deliveredKeys(await ledger(() => sb.from("email_deliveries").select("ref, user_id")
    .eq("source", "announce").eq("ref", slug).order("user_id")));
  const users = (await members(audience)).filter((u) => !had.has(`${slug}:${u.id}`));
  const queue = users.map((u) => ({ user: u, refs: [{ source: "announce", ref: slug }], msg: { ...renderAnnouncement({ ...content, username: u.username, appUrl: APP_URL, unsubscribeUrl: unsubscribeUrl(APP_URL, u.id), via: VIA && (content.md ? "report" : "announce") }), tag: "announcement", unsubscribeUrl: unsubscribeUrl(APP_URL, u.id) } }));
  const r = await deliver(queue);
  return { ...r, eligible: users.length, slug, audience };
}

try {
  console.log(`email ${MODE}${DRY ? " (DRY RUN — nothing sent)" : ""}${ONLY ? ` (TEST → ${ONLY.slice(0, 8)} only, nothing recorded)` : ""} · providers: ${providerSummary()} · app ${APP_URL}`);
  VIA = await clickPathsLive();
  const r = MODE === "digest" ? await runDigest() : MODE === "meetings" ? await runMeetings() : await runAnnounce();
  const summary = `${r.slug ? `${r.slug} · ` : ""}sent ${r.sent} · failed ${r.failed} · deferred ${r.deferred} (quota) · eligible ${r.eligible}` +
    (r.withContent != null ? ` · with-content ${r.withContent}` : "") + (r.meetings != null ? ` · meetings ${r.meetings}` : "") + (r.quiet ? ` · quiet ${r.quiet} (${r.quietHeld} held for Monday)` : "") +
    ` · links ${VIA ? "tagged" : "plain"}` + (r.errors.length ? ` · errors: ${r.errors.join(" ; ")}` : "");
  console.log(summary);
  await record(r.failed > 0 && r.sent === 0 ? "error" : r.deferred > 0 ? "partial" : "success", r.sent, summary);
  // Housekeeping: the ledger only needs recent rows (migration 0326).
  if (!DRY && !ONLY && LEDGER_OK) {
    const { error } = await sb.from("email_deliveries").delete().lt("sent_at", new Date(Date.now() - KEEP_DAYS * 86400e3).toISOString());
    if (error) console.warn(`  ! ledger prune failed: ${error.message}`);
  }
  // exitCode, not exit(): an abrupt exit with fetch sockets still closing trips
  // a libuv assertion on Windows. Same exit status, clean shutdown.
  process.exitCode = r.failed > 0 && r.sent === 0 ? 1 : 0;
} catch (e) {
  console.error(`✗ ${e.message}`);
  await record("error", 0, e.message);
  process.exitCode = 1;
}
