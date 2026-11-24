/**
 * check-legislator-rosters.mjs — compare state legislators' emails with each
 * chamber's OFFICIAL member list, and fix the ones the chamber spells
 * differently.
 *
 * Why (2026-11-11): our contacts come from openstates/people, which can itself
 * be wrong. MI Rep. Parker Fairbairn is parker.fairbairn@house.mi.gov there,
 * house.mi.gov/AllRepresentatives lists ParkerFairbairn@house.mi.gov, and
 * members' letters bounced. In Michigan, exactly the three bounced addresses
 * were the three not on the House's list.
 *
 * For each chamber it fetches the roster pages openstates/people itself cites
 * (sources noted as a members list, or a URL many members share), with a plain
 * fetch: a JS-built page or one with no addresses is skipped. A page must
 * vouch for the chamber (most members' exact addresses on it) before anything
 * is changed. Then, for each member whose domain is on the page but whose
 * address is not, the one address on the page that carries their surname is
 * swapped in; otherwise the mismatch is reported and the email is left alone.
 * The rules are in scripts/lib/roster-emails.mjs.
 *
 * Every swap appends `- Email corrected <date>: "<old>" is not on <chamber>'s
 * official roster …` to verified_sources_md. rejectedEmails() reads that, so
 * the daily openstates refresh (sync-state-legislator-contacts.mjs) never puts
 * the old address back, and the old value stays on the row to undo it.
 *
 * Dry run by default. More than --max-rows swaps (default 25) in one run holds
 * for the owner's yes (--allow-bulk). Writes scraper_runs on --apply.
 *   node --env-file=.env.local scripts/check-legislator-rosters.mjs                  # dry run
 *   node --env-file=.env.local scripts/check-legislator-rosters.mjs --apply [--state MI] [--allow-bulk]
 */
import { createClient } from "@supabase/supabase-js";
import yaml from "js-yaml";
import { PEOPLE_TARBALL, collectFromTarball } from "./lib/openstates-people.mjs";
import { rejectedEmails } from "./lib/legislator-contacts.mjs";
import { decodeCfEmails } from "./lib/page-text.mjs";
import { browserUA } from "./lib/browser-ua.mjs";
import { compareChamber, correctionLine, extractEmails, givenNames, rosterPages, surnameKeys } from "./lib/roster-emails.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = flag("--apply");
const ALLOW_BULK = flag("--allow-bulk");
const MAX_ROWS = Number(opt("--max-rows") ?? 25);
const STATE = opt("--state")?.toUpperCase();
const SOURCE = "check_legislator_rosters";
const CHAMBER_NAME = { upper: "Senate", lower: "House", legislature: "Legislature" };

const t0 = Date.now();
const today = new Date().toISOString().slice(0, 10);
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function telemetry(status, notes, rows = 0) {
  if (!APPLY) return;
  try {
    await sb.from("scraper_runs").insert({
      source: SOURCE, started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      status, rows_updated: rows, notes: String(notes).slice(0, 500),
    });
  } catch { /* best-effort */ }
}

// 1. openstates/people: each current member's chamber, surname and cited pages.
// data/us/ in the same repo is the US CONGRESS: exclude it.
const PATH_RE = /(?:^|\/)data\/(?!us\/)([a-z]{2})\/legislature\/[^/]+\.ya?ml$/i;
let files;
try { files = await collectFromTarball(PEOPLE_TARBALL, PATH_RE); } catch (e) { await telemetry("error", `tarball: ${e.message}`); throw e; }
const people = new Map();
const docsByChamber = new Map();
for (const [path, text] of files) {
  const state = PATH_RE.exec(path)?.[1]?.toUpperCase();
  if (!state || (STATE && state !== STATE)) continue;
  let doc;
  try { doc = yaml.load(text); } catch { continue; }
  const role = (doc?.roles ?? []).find((r) => !r.end_date) ?? doc?.roles?.at(-1);
  if (!doc?.id || !CHAMBER_NAME[role?.type]) continue;
  const key = `${state}-${role.type}`;
  people.set(doc.id, { key, family: doc.family_name, given: doc.given_name });
  if (!docsByChamber.has(key)) docsByChamber.set(key, []);
  docsByChamber.get(key).push(doc);
}

// 2. Ours: every active state legislator with an address.
const ours = [];
for (let from = 0; ; from += 1000) {
  let q = sb.from("legislators").select("id, state, role, full_name, openstates_id, email, verified_sources_md")
    .eq("level", "state").in("role", ["state_senate", "state_house"]).eq("active", true).like("email", "%@%");
  if (STATE) q = q.eq("state", STATE);
  const { data, error } = await q.order("id").range(from, from + 999);
  if (error) { await telemetry("error", `read: ${error.message}`); throw error; }
  ours.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const takenByState = new Map();
const rowsByChamber = new Map();
for (const r of ours) {
  if (!takenByState.has(r.state)) takenByState.set(r.state, new Map());
  takenByState.get(r.state).set(String(r.email).trim().toLowerCase(), r.id);
  const p = people.get(r.openstates_id);
  const key = p?.key ?? `${r.state}-${r.role === "state_senate" ? "upper" : "lower"}`;
  if (!rowsByChamber.has(key)) rowsByChamber.set(key, []);
  const keys = surnameKeys(p?.family, r.full_name);
  rowsByChamber.get(key).push({ ...r, surnameKeys: keys, givenNames: givenNames(r.full_name, p?.given, keys), rejected: rejectedEmails(r.verified_sources_md) });
}

// 3. Fetch each cited roster page once (a page can list both chambers).
const pageCache = new Map();
async function fetchEmails(url) {
  if (!pageCache.has(url)) {
    pageCache.set(url, (async () => {
      try {
        const res = await fetch(url, { headers: { "user-agent": browserUA("iKratom-RosterCheck/1.0 (+https://www.ikratom.org)"), accept: "text/html,application/json,application/xml,text/plain;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(25_000) });
        if (!res.ok) return { error: `HTTP ${res.status}` };
        const type = res.headers.get("content-type") ?? "";
        if (type && !/text|json|xml/i.test(type)) return { error: `not text (${type.split(";")[0]})` };
        const html = (await res.text()).slice(0, 6_000_000);
        return { emails: extractEmails(decodeCfEmails(html)) };
      } catch (e) { return { error: e.name === "TimeoutError" ? "timeout" : String(e.message ?? e).slice(0, 60) }; }
    })());
  }
  return pageCache.get(url);
}

const chambers = [...docsByChamber.keys()].filter((k) => rowsByChamber.has(k)).sort();
const results = [];
for (let i = 0; i < chambers.length; i += 6) {
  await Promise.all(chambers.slice(i, i + 6).map(async (key) => {
    const rows = rowsByChamber.get(key);
    const taken = takenByState.get(key.split("-")[0]);
    let best = null;
    for (const url of rosterPages(docsByChamber.get(key))) {
      const page = await fetchEmails(url);
      const cmp = page.emails?.size ? compareChamber(rows, page.emails, taken) : null;
      const cand = { url, error: page.error ?? (page.emails?.size ? null : "no addresses (JS-built?)"), size: page.emails?.size ?? 0, cmp };
      const score = (c) => (c.cmp ? c.cmp.coverage : c.error === "no addresses (JS-built?)" ? -1 : -2);
      if (!best || score(cand) > score(best)) best = cand;
      if (cand.cmp?.vouches && cand.cmp.coverage > 0.95) break;
    }
    results.push({ key, rows: rows.length, best });
  }));
}
results.sort((a, b) => a.key.localeCompare(b.key));

// 4. Report.
const label = (key) => { const [st, ch] = key.split("-"); return `${st} ${CHAMBER_NAME[ch]}`; };
const swaps = [];
const reportOnly = [];
let readable = 0, partial = 0, unconfirmed = 0, unreadable = 0;
console.log("| Chamber | Page | Addresses | Listed | Coverage | Mismatches | Swaps |");
console.log("|---|---|---|---|---|---|---|");
for (const { key, rows, best } of results) {
  const c = best?.cmp;
  if (!c) { unreadable++; console.log(`| ${label(key)} | ${best?.url ?? "(none cited)"} | - | 0/${rows} | - | - | ${best?.error ?? "no page"} |`); continue; }
  const sw = c.mismatches.filter((m) => m.swap);
  if (c.reports) {
    if (c.vouches) readable++; else partial++;
    for (const m of c.mismatches) (m.swap ? swaps : reportOnly).push({ key, url: best.url, ...m });
  } else unconfirmed++;
  const tag = c.vouches ? "" : c.reports ? " (report only)" : " (too few listed)";
  console.log(`| ${label(key)} | ${best.url} | ${best.size} | ${c.listed}/${c.inScope} | ${Math.round(c.coverage * 100)}%${tag} | ${c.reports ? c.mismatches.length : "-"} | ${sw.length} |`);
}
console.log(`\n${results.length} chambers · ${readable} vouched by their roster page · ${partial} report only (60-90% listed) · ${unconfirmed} too few members listed · ${unreadable} unreadable`);
console.log(`\nSwaps (${swaps.length}):`);
for (const s of swaps) console.log(`  ${label(s.key)} · ${s.row.full_name}: ${s.row.email} -> ${s.swap}`);
console.log(`\nReport only, email left alone (${reportOnly.length}):`);
for (const s of reportOnly) console.log(`  ${label(s.key)} · ${s.row.full_name}: ${s.row.email} — ${s.reason}`);

const summary = `${readable}/${results.length} chambers vouched, ${partial} report-only · ${swaps.length + reportOnly.length} not on roster · ${swaps.length} swaps · ${reportOnly.length} report-only`;
if (!APPLY) {
  console.log(`\nDRY RUN: nothing written. ${swaps.length > MAX_ROWS ? `Over the ${MAX_ROWS}-row brake: --apply would hold without --allow-bulk.` : ""}`);
  process.exit(0);
}
if (swaps.length > MAX_ROWS && !ALLOW_BULK) {
  const notes = `HELD: ${swaps.length} swaps (brake ${MAX_ROWS}; owner yes, then --allow-bulk). ${summary}`;
  console.log(notes);
  await telemetry("error", notes);
  process.exit(0);
}

// 5. Apply. The .eq on the old email skips a row another job changed meanwhile.
let updated = 0, failed = 0;
for (const s of swaps) {
  const md = [s.row.verified_sources_md, correctionLine(s.row.email, s.swap, label(s.key), s.url, today)].filter(Boolean).join("\n");
  const { data, error } = await sb.from("legislators").update({ email: s.swap, verified_sources_md: md })
    .eq("id", s.row.id).eq("email", s.row.email).select("id");
  if (error || !data?.length) { failed++; console.error(`  ! ${s.row.full_name}: ${error?.message ?? "row changed meanwhile"}`); } else updated++;
}
const names = reportOnly.slice(0, 8).map((s) => `${s.key} ${s.row.full_name}`).join("; ");
const notes = `${summary} · ${updated} written · ${failed} failed${names ? ` · check: ${names}` : ""}`;
console.log(notes);
await telemetry(failed ? "error" : readable ? "success" : "empty", notes, updated);
