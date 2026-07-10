#!/usr/bin/env node
/**
 * sync-state-executives.mjs — keyless state executives (PR-K).
 *
 * Governors, lieutenant governors, attorneys general, and secretaries of
 * state for all 50 states + DC, from the openstates/people GitHub repo
 * (public YAML, clerk-grade, no key, no rate limit — one tarball download).
 * This fills the only gap 5Calls would have covered, without the manually
 * approved API key that whole effort exists to avoid.
 *
 * Sync semantics per (state, role): the YAML is truth. The current holder
 * is inserted/updated; any other active row for that seat is deactivated —
 * self-healing across elections.
 *
 * Self-gates to WEEKLY (executives change rarely; the tarball is ~50MB):
 * skips when the last successful run is younger than 6 days, so it can sit
 * in the nightly chassis. Telemetry: scraper_runs source
 * state_executives_sync.
 *
 *   node --env-file=.env.local scripts/sync-state-executives.mjs
 *   node --env-file=.env.local scripts/sync-state-executives.mjs --force --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// js-yaml ships as gray-matter's engine — pinned via package-lock.
const yaml = require("js-yaml");

const TARBALL = "https://codeload.github.com/openstates/people/tar.gz/refs/heads/main";
const PATH_RE = /\/data\/([a-z]{2})\/executive\/[^/]+\.yml$/;
// openstates/people uses "governor" / "lt_governor" / "attorney general" /
// "secretary of state" as the role `type`. lt-gov is the odd one (underscore,
// no space) — accept both spellings so a future format change can't silently
// drop all 45 lieutenant governors again.
const ROLE_MAP = new Map([
  ["governor", "governor"],
  ["lt_governor", "lt_governor"],
  ["lieutenant governor", "lt_governor"],
  ["attorney general", "attorney_general"],
  ["secretary of state", "secretary_of_state"],
]);

// js-yaml parses an UNQUOTED YYYY-MM-DD as a JS Date, not a string. String()
// on that yields "Sun Jan 10 2027 …" which breaks lexical date compares AND
// is rejected by the Postgres `date` column. Normalize everything to ISO.
const toIso = (d) => {
  if (d == null) return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  const s = String(d).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FORCE = args.includes("--force");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const t0 = Date.now();
const NOW = () => new Date().toISOString();

// Weekly self-gate — lives in the nightly chassis but only works Sundays-ish.
if (!FORCE) {
  // Exclude dry-run rows from the gate — a dry-run must never count as a real
  // sync (it would defer the next real run by the weekly window).
  const { data } = await sb.from("scraper_runs")
    .select("finished_at").eq("source", "state_executives_sync").eq("status", "success")
    .not("notes", "ilike", "%[dry-run]%")
    .order("finished_at", { ascending: false }).limit(1);
  const last = data?.[0]?.finished_at ? new Date(data[0].finished_at).getTime() : 0;
  if (last && Date.now() - last < 6 * 864e5) {
    console.log(`state-executives: last sync ${((Date.now() - last) / 864e5).toFixed(1)}d ago — weekly gate, skipping (--force overrides).`);
    process.exit(0);
  }
}

/**
 * Minimal streaming tar reader: walks 512-byte headers, collects the content
 * of paths matching `match`, skips everything else. Handles ustar prefix +
 * GNU 'L' longname entries. No dependencies.
 */
async function collectFromTarball(url, match) {
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`tarball ${res.status}`);
  const gunzip = Readable.fromWeb(res.body).pipe(createGunzip());

  const files = new Map();
  let buf = Buffer.alloc(0);
  let pendingLongName = null;
  let current = null; // { name, remaining, pad, collect: Buffer[] | null, isLongName }

  for await (const chunk of gunzip) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (true) {
      if (current) {
        // Consume up to remaining body bytes + pad; the first `remaining`
        // consumed bytes are body, the rest is block padding.
        const take = Math.min(buf.length, current.remaining + current.pad);
        const bodyTake = Math.min(take, current.remaining);
        if (current.collect && bodyTake > 0) current.collect.push(buf.subarray(0, bodyTake));
        current.remaining -= bodyTake;
        current.pad -= take - bodyTake;
        buf = buf.subarray(take);
        if (current.remaining > 0 || current.pad > 0) break; // need more data
        if (current.isLongName) {
          pendingLongName = Buffer.concat(current.collect).toString("utf8").replace(/\0+$/, "");
        } else if (current.collect) {
          files.set(current.name, Buffer.concat(current.collect).toString("utf8"));
        }
        current = null;
        continue;
      }
      if (buf.length < 512) break;
      const header = buf.subarray(0, 512);
      buf = buf.subarray(512);
      if (header.every((b) => b === 0)) continue; // end-of-archive padding
      let name = header.subarray(0, 100).toString("utf8").replace(/\0+$/, "");
      const prefix = header.subarray(345, 500).toString("utf8").replace(/\0+$/, "");
      if (prefix) name = `${prefix}/${name}`;
      if (pendingLongName) { name = pendingLongName; pendingLongName = null; }
      const size = parseInt(header.subarray(124, 136).toString("utf8").trim() || "0", 8) || 0;
      const typeflag = String.fromCharCode(header[156]);
      const pad = (512 - (size % 512)) % 512;
      const isLongName = typeflag === "L";
      const wanted = typeflag === "0" || typeflag === "\0" ? match.test(name) : false;
      current = { name, remaining: size, pad, collect: wanted || isLongName ? [] : null, isLongName };
    }
  }
  return files;
}

console.log("state-executives: downloading openstates/people tarball…");
let files;
try {
  files = await collectFromTarball(TARBALL, PATH_RE);
} catch (e) {
  console.error(`✗ tarball fetch/parse failed: ${e.message}`);
  try {
    await sb.from("scraper_runs").insert({
      source: "state_executives_sync", started_at: new Date(t0).toISOString(), finished_at: NOW(),
      status: "fail", rows_updated: 0, notes: `tarball: ${e.message}`.slice(0, 300),
    });
  } catch { /* best-effort */ }
  process.exit(1);
}
console.log(`  ${files.size} executive YAML file(s) found`);

const today = NOW().slice(0, 10);
const current = []; // { state, role, full_name, party, phone, website, term_end_date, sourcePath }
for (const [path, text] of files) {
  const st = path.match(PATH_RE)?.[1]?.toUpperCase();
  let doc;
  try { doc = yaml.load(text); } catch { continue; }
  if (!st || !doc?.name || !Array.isArray(doc.roles)) continue;
  const activeRole = doc.roles.find((r) => {
    if (!ROLE_MAP.has(String(r?.type ?? "").toLowerCase())) return false;
    const end = toIso(r.end_date);
    const start = toIso(r.start_date);
    if (end && end < today) return false;       // term ended
    if (start && start > today) return false;    // elected but not yet sworn in
    return true;
  });
  if (!activeRole) continue;
  const office = (doc.offices ?? []).find((o) => o?.voice) ?? (doc.offices ?? [])[0] ?? {};
  // Contact channel (the LA-campaign gap: every executive used to sync with
  // email=NULL because we never read these fields). Precedence:
  //   1. a real inbox from the YAML `email` field (or an office email)
  //   2. an explicit contact-page/webform link from `links` — stored in the
  //      email column as an http URL (the sync-congress convention; all send
  //      paths detect `startsWith('http')` and render a contact-form flow)
  // A bare homepage is NOT treated as a contact form — the UI falls back to
  // `website` with honest labeling instead.
  const rawEmail = String(doc.email ?? office.email ?? "").trim();
  // Only accept a link that clearly means "reach the official". Deliberately
  // NOT matching bare "feedback"/"write"/"forms" — those hit gov-site footer
  // links like "Website feedback" or "disclosure forms" and would be stored as
  // the office's contact channel (a wrong destination for advocates). Matches
  // real patterns: '…/contact/', note 'webform', '…/contact-form', '…/email-the-governor'.
  const contactLink = (doc.links ?? []).find((l) => {
    const hay = `${l?.note ?? ""} ${l?.url ?? ""}`.toLowerCase();
    return /^https?:\/\//i.test(String(l?.url ?? ""))
      && /\bcontact\b|contact-?(us|the|form)|webform|constituent|email-?(the|us|your)|share-?your-?(views|opinion|story)/i.test(hay)
      && !/website.?feedback|report.?a.?(problem|bug)|technical|disclosure/i.test(hay);
  })?.url ?? null;
  current.push({
    state: st,
    role: ROLE_MAP.get(String(activeRole.type).toLowerCase()),
    full_name: String(doc.name).trim(),
    party: (Array.isArray(doc.party) ? doc.party[0]?.name : null) ?? null,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : contactLink,
    phone: office.voice ?? null,
    website: (doc.links ?? [])[0]?.url ?? null,
    term_end_date: toIso(activeRole.end_date),
    sourcePath: path.replace(/^[^/]+\//, ""), // strip the tarball root dir
  });
}
// Dedup by (state, role): a person can carry two overlapping role entries
// (consecutive terms) → two parse hits for the same seat. Keep the one with
// the latest term_end_date (null = current/open-ended = wins).
const bySeat = new Map();
const termRank = (d) => (d ? Date.parse(d) || 0 : Infinity);
for (const ex of current) {
  const key = `${ex.state}|${ex.role}`;
  const prev = bySeat.get(key);
  if (!prev || termRank(ex.term_end_date) > termRank(prev.term_end_date)) bySeat.set(key, ex);
}
const seats = [...bySeat.values()];
console.log(`  ${current.length} parsed → ${seats.length} unique seat(s) after dedup`);

let inserted = 0, updated = 0, deactivated = 0;
for (const ex of seats) {
  const title = { governor: "Governor", lt_governor: "Lieutenant Governor", attorney_general: "Attorney General", secretary_of_state: "Secretary of State" }[ex.role];
  const { data: rows } = await sb.from("legislators")
    .select("id, full_name, active")
    .eq("state", ex.state).eq("role", ex.role).eq("level", "state");
  const matching = (rows ?? []).find((r) => r.full_name.toLowerCase() === ex.full_name.toLowerCase());
  const stale = (rows ?? []).filter((r) => r.active && r.full_name.toLowerCase() !== ex.full_name.toLowerCase());

  if (DRY) {
    const channel = !ex.email ? "no contact channel" : ex.email.startsWith("http") ? `form: ${ex.email}` : `email: ${ex.email}`;
    console.log(`  · [${ex.state}] ${title}: ${ex.full_name}${matching ? " (update)" : " (insert)"}${stale.length ? ` + deactivate ${stale.length}` : ""} — ${channel}`);
    continue;
  }
  const sources = `- openstates/people (clerk-grade public roster): https://github.com/openstates/people/blob/main/${ex.sourcePath}`;
  if (matching) {
    const { error } = await sb.from("legislators").update({
      party: ex.party, phone: ex.phone, website: ex.website,
      term_end_date: ex.term_end_date, title, active: true,
      verified_sources_md: sources, last_synced_at: NOW(),
      // Only write email when the YAML yielded a channel — never clobber a
      // manually-entered address with null.
      ...(ex.email ? { email: ex.email } : {}),
    }).eq("id", matching.id);
    if (error) { console.log(`  ✗ [${ex.state}] ${title} update: ${error.message.slice(0, 80)}`); continue; }
    updated++;
  } else {
    const { error } = await sb.from("legislators").insert({
      full_name: ex.full_name, state: ex.state, role: ex.role, level: "state",
      title, party: ex.party, phone: ex.phone, website: ex.website,
      email: ex.email ?? null,
      term_end_date: ex.term_end_date, active: true,
      verified_sources_md: sources, last_synced_at: NOW(),
    });
    if (error) { console.log(`  ✗ [${ex.state}] ${title} insert: ${error.message.slice(0, 80)}`); continue; }
    inserted++;
  }
  if (stale.length) {
    await sb.from("legislators").update({ active: false, last_synced_at: NOW() }).in("id", stale.map((r) => r.id));
    deactivated += stale.length;
  }
}

console.log(`\nDone. inserted=${inserted} updated=${updated} deactivated=${deactivated}${DRY ? " [dry-run]" : ""}`);
// A dry-run writes NO telemetry — otherwise it poisons the weekly gate above
// (a [dry-run] success row would defer the next real sync). Belt + braces:
// the gate also excludes [dry-run] notes.
if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "state_executives_sync",
      started_at: new Date(t0).toISOString(),
      finished_at: NOW(),
      status: seats.length === 0 ? "fail" : "success",
      rows_updated: inserted + updated,
      notes: `seats=${seats.length} inserted=${inserted} updated=${updated} deactivated=${deactivated}`,
    });
  } catch { /* best-effort */ }
}
process.exit(0);
