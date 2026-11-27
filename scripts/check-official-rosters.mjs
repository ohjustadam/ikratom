/**
 * check-official-rosters.mjs — read every state chamber's own member list,
 * daily. The officials-turnover engine's second source and its year-round
 * census. Rules: scripts/lib/official-roster.mjs. Table: migration 0339.
 *
 * Why (2026-11-27): after the 2026 general, openstates/people had not updated
 * FL, IN, TN, SC, AL, DE, HI or OK since October, and it was the only second
 * source the handover would accept. 167 seats sat past their handover day:
 * outgoing members still got letters, new members were missing. The chambers'
 * own sites already listed the newcomers.
 *
 * For each chamber: the pages openstates/people cites as its member list, plus
 * a few seeds, fetched plainly with an honest User-Agent (a page built by
 * JavaScript, or one that refuses us, is skipped and reported). A page counts
 * only if it lists at least a fifth of the members we expect to stay, and the
 * pages together VOUCH for the chamber only when they list 85% of them.
 *
 * Then, for a vouched chamber:
 *   SEATS. Each seat past its handover day whose winner is listed and whose
 *   outgoing member is not gets `official-roster:<day>` in result_sources, the
 *   page URL, and the winner's address if the page prints exactly one that is
 *   theirs. turnover-swap.mjs then retires the outgoing member and adds the
 *   new one. Winner and outgoing member both listed = the page isn't updated
 *   yet: hold.
 *   CENSUS. A member we list as active, not leaving, and missing from the
 *   page goes in official_roster_checks with a count of days in a row. A
 *   review list for /admin, never a retirement: the 15% a page may miss are
 *   mostly name spellings.
 *
 * Which pages: those remembered in official_roster_pages (migration 0340)
 * first, then seeds in code, then what openstates/people cites. A page that
 * helps a chamber vouch is remembered; one that stops helping for 14 runs is
 * retired. With --discover (weekly), a chamber that still can't be read gets
 * its home page crawled one level for member lists, and a page that vouches
 * is remembered: the engine re-finds a moved site or a new session's URL
 * (Kansas: /b2025_26/) on its own.
 *
 * Never read: Nevada's legislature site and Ballotpedia (owner rule).
 * Dry run by default. Telemetry: scraper_runs source "official_rosters".
 *   node --env-file=.env.local scripts/check-official-rosters.mjs [--state FL] [--apply] [--discover] [--verbose]
 */
import { createClient } from "@supabase/supabase-js";
import yaml from "js-yaml";
import { PEOPLE_TARBALL, collectFromTarball } from "./lib/openstates-people.mjs";
import { rosterPages, pageKey } from "./lib/roster-emails.mjs";
import { decodeCfEmails } from "./lib/page-text.mjs";
import { pageTokens, indexTokens, vouch, seatEvidence, emailFor, nameOnPage, pastSession, SEED_PAGES } from "./lib/official-roster.mjs";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = args.includes("--apply");
const DISCOVER = args.includes("--discover"); // weekly: crawl the home page of each chamber we cannot read
const VERBOSE = args.includes("--verbose");
const STATE = opt("--state")?.toUpperCase();
const SOURCE = "official_rosters";
const UA = "iKratom-RosterCensus/1.0 (+https://www.ikratom.org; support@ikratom.org)";
const OFF_LIMITS = /(^|\.)(state\.nv\.us|nv\.gov|ballotpedia\.org)$/i;
const MIN_PAGE_SHARE = 0.15;  // a page that lists fewer of the chamber is not its member list (a minority caucus page lists ~20%)
const MAX_TAGS = 600;         // the biggest real day is a few hundred seats; more means a bad read
const OFFICE = { upper: "state_senate", legislature: "state_senate", lower: "state_house" };
const RETIRE_AFTER = 14;      // runs in a row a remembered page did not help
const LINK_WORDS = /member|legislator|senator|representative|delegate|assembl|roster|directory/i;
const t0 = Date.now();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function telemetry(status, notes, rows = 0) {
  if (!APPLY) return;
  try {
    await sb.from("scraper_runs").insert({ source: SOURCE, started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(), status, rows_updated: rows, notes: String(notes).slice(0, 500) });
  } catch { /* best-effort */ }
}
async function readAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().order("id").range(from, from + 999);
    if (error) { await telemetry("error", `read: ${error.message}`); throw error; }
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// 1. The pages openstates/people cites, per chamber.
const RE = /(?:^|\/)data\/(?!us\/)([a-z]{2})\/legislature\/[^/]+\.ya?ml$/i;
let files;
try { files = await collectFromTarball(PEOPLE_TARBALL, RE); } catch (e) { await telemetry("error", `tarball: ${e.message}`); throw e; }
const docs = new Map();
for (const [p, txt] of files) {
  const st = p.match(RE)[1].toUpperCase();
  if (STATE && st !== STATE) continue;
  let d; try { d = yaml.load(txt); } catch { continue; }
  const role = (d?.roles ?? []).find((r) => !r.end_date) ?? d?.roles?.at(-1);
  const office = OFFICE[role?.type];
  if (office) (docs.get(`${st}-${office}`) ?? docs.set(`${st}-${office}`, []).get(`${st}-${office}`)).push(d);
}

// 2. Ours, and the seats changing hands.
const ours = await readAll(() => {
  const q = sb.from("legislators").select("id, state, role, district, full_name, email")
    .eq("level", "state").in("role", ["state_senate", "state_house"]).eq("active", true);
  return STATE ? q.eq("state", STATE) : q;
});
const seats = await readAll(() => {
  const q = sb.from("seat_elections")
    .select("id, state, office, district, incumbent_id, incumbent_name, winner_name, handover_date, status, result_sources, review_reason, sources_md")
    .in("office", ["state_senate", "state_house"]).in("status", ["successor_elected", "needs_review"])
    .not("winner_name", "is", null).not("handover_date", "is", null);
  return STATE ? q.eq("state", STATE) : q;
});
const leaving = new Set(seats.map((s) => s.incumbent_id).filter(Boolean));
const taken = new Set(ours.map((r) => String(r.email ?? "").trim().toLowerCase()).filter((e) => e.includes("@")));
const byChamber = new Map();
for (const r of ours) (byChamber.get(`${r.state}-${r.role}`) ?? byChamber.set(`${r.state}-${r.role}`, []).get(`${r.state}-${r.role}`)).push(r);

// 3. Read each chamber.
const fetched = new Map();
function getPage({ url, method = "GET" }) {
  const k = `${method} ${url}`;
  if (!fetched.has(k)) fetched.set(k, (async () => {
    try {
      const res = await fetch(url, { method, headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const type = res.headers.get("content-type") ?? "";
      if (type && !/html|text|xml|json/i.test(type)) return { error: `not a page (${type.split(";")[0]})` };
      const html = decodeCfEmails((await res.text()).slice(0, 8_000_000));
      return { html, page: indexTokens(pageTokens(html)) };
    } catch (e) { return { error: e.name === "TimeoutError" ? "timeout" : String(e.message ?? e).slice(0, 60) }; }
  })());
  return fetched.get(k);
}

// Pages remembered from earlier runs.
const { data: learnedRows, error: learnedErr } = await (STATE
  ? sb.from("official_roster_pages").select("*").is("retired_on", null).eq("state", STATE)
  : sb.from("official_roster_pages").select("*").is("retired_on", null));
if (learnedErr) { await telemetry("error", `read pages: ${learnedErr.message}`); throw learnedErr; }
const learned = new Map();
for (const p of learnedRows ?? []) (learned.get(`${p.state}-${p.office}`) ?? learned.set(`${p.state}-${p.office}`, []).get(`${p.state}-${p.office}`)).push(p);

// Candidate member lists on a chamber's home pages, one level deep (--discover).
async function discover(key) {
  const origins = new Map();
  for (const d of docs.get(key) ?? []) for (const u of [...(d.links ?? []), ...(d.sources ?? [])].map((x) => x?.url)) {
    try { const o = new URL(u).origin; if (!/wikipedia\.org|ballotpedia/i.test(o)) origins.set(o, (origins.get(o) ?? 0) + 1); } catch { /* not a URL */ }
  }
  const out = new Set();
  for (const [o] of [...origins].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    if (OFF_LIMITS.test(new URL(o).hostname)) continue;
    const home = await getPage({ url: `${o}/` });
    if (home.error) continue;
    const site = new URL(o).hostname.split(".").slice(-2).join(".");
    for (const m of home.html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
      try {
        const u = new URL(m[1].replace(/&amp;/g, "&"), `${o}/`);
        if (/^https?:$/.test(u.protocol) && u.hostname.endsWith(site) && LINK_WORDS.test(u.pathname + u.search) && !/\.(pdf|jpe?g|png|docx?)$/i.test(u.pathname)) out.add(pageKey(u.href));
      } catch { /* not a URL */ }
    }
  }
  return [...out].filter(Boolean).slice(0, 12).map((url) => ({ url, found_by: "discovery" }));
}

const results = [];
const learnedWrites = [];
let discovered = 0;
async function readChamber(key) {
  const members = byChamber.get(key);
  const continuing = members.filter((r) => !leaving.has(r.id));
  const names = continuing.map((r) => r.full_name);
  const year = Number(today.slice(0, 4));
  const seen = new Set();
  const norm = (list) => list
    .map((s) => ({ ...s, method: s.method ?? "GET", url: s.method === "POST" ? s.url : pageKey(s.url) }))
    .filter((s) => s.url && !seen.has(`${s.method} ${s.url}`) && seen.add(`${s.method} ${s.url}`))
    .filter((s) => { try { return !OFF_LIMITS.test(new URL(s.url).hostname) && !pastSession(s.url, year); } catch { return false; } });
  const mine = (learned.get(key) ?? []).sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0));
  const specs = norm([
    ...mine.map((p) => ({ url: p.url, method: p.method, found_by: p.found_by })),
    ...(SEED_PAGES[key] ?? []).map((s) => (typeof s === "string" ? { url: s, found_by: "seed" } : { ...s, found_by: "seed" })),
    ...rosterPages(docs.get(key) ?? [], { max: 4 }).map((url) => ({ url, found_by: "openstates" })),
  ]);
  const used = [], tried = [];
  let tokens = [], best = null;
  const tryAll = async (list) => {
    for (const spec of list) {
      if (best?.coverage >= 0.97) break;
      const got = await getPage(spec);
      if (got.error) { tried.push({ spec, why: got.error }); continue; }
      const own = vouch(names, got.page);
      if (own.coverage < MIN_PAGE_SHARE) { tried.push({ spec, why: `lists ${Math.round(own.coverage * 100)}%${got.page.tokens.length < 400 ? ", JS-built?" : ""}` }); continue; }
      used.push({ ...spec, ...got, coverage: own.coverage });
      tokens = tokens.length ? [...tokens, "|", ...got.page.tokens] : got.page.tokens;
      best = vouch(names, indexTokens(tokens));
    }
  };
  await tryAll(specs);
  if (DISCOVER && !best?.vouches) {
    await tryAll(norm(await discover(key)));
    if (best?.vouches) discovered += used.filter((u) => u.found_by === "discovery").length;
  }
  // Remember what helped a vouched chamber; count a miss for a remembered page that did not.
  if (best?.vouches) for (const u of used) learnedWrites.push({ state: key.slice(0, 2), office: key.slice(3), url: u.url, method: u.method, found_by: u.found_by, coverage: Math.min(0.999, Number(u.coverage.toFixed(3))), last_vouched_on: today, last_checked_on: today, misses: 0, retired_on: null });
  for (const p of mine) {
    if (best?.vouches && used.some((u) => u.url === p.url && u.method === p.method)) continue;
    if (!tried.some((x) => x.spec.url === p.url) && !used.some((u) => u.url === p.url)) continue; // not reached this run
    const misses = p.misses + 1;
    learnedWrites.push({ state: p.state, office: p.office, url: p.url, method: p.method, found_by: p.found_by, coverage: p.coverage, last_vouched_on: p.last_vouched_on, last_checked_on: today, misses, retired_on: misses >= RETIRE_AFTER ? today : null });
  }
  results.push({ key, members, continuing, used, tried: tried.map((x) => `${x.spec.url} (${x.why})`), union: tokens.length ? indexTokens(tokens) : null, check: best });
}
const keys = [...byChamber.keys()].sort();
for (let i = 0; i < keys.length; i += 6) await Promise.all(keys.slice(i, i + 6).map(readChamber));

// 4. Seats and census, vouched chambers only.
const tags = [], holds = [], notYet = [], absent = [], present = [];
const unreadable = [];
for (const r of results) {
  if (!r.check?.vouches) {
    unreadable.push(`${r.key}${r.check ? ` ${Math.round(r.check.coverage * 100)}%` : ""}`);
    if (VERBOSE) console.log(`  · ${r.key}: not vouched${r.check ? ` (${r.check.listed}/${r.continuing.length})` : ""}; ${[...r.used.map((u) => u.url), ...r.tried].join(" · ") || "no pages"}`);
    continue;
  }
  const [st, office] = [r.key.slice(0, 2), r.key.slice(3)];
  console.log(`  ✓ ${r.key}: ${r.check.listed}/${r.continuing.length} listed (${Math.round(r.check.coverage * 100)}%) on ${r.used.map((u) => u.url).join(" + ")}`);
  for (const s of seats.filter((x) => x.state === st && x.office === office && x.handover_date <= today)) {
    if ((s.result_sources ?? []).some((t) => t.startsWith("official-roster:"))) continue;
    if (s.status === "needs_review" && !/no second source/.test(s.review_reason ?? "")) continue;
    const ev = seatEvidence(s, r.union);
    if (ev === "both") { holds.push(`${st} ${office} ${s.district}: ${s.winner_name} and ${s.incumbent_name} both listed`); continue; }
    if (ev === "absent") { notYet.push(`${st} ${office} ${s.district}: ${s.winner_name}`); continue; }
    const single = !String(s.winner_name).includes(",");
    const where = r.used.find((u) => String(s.winner_name).split(/,\s*/).every((w) => nameOnPage(w, u.page))) ?? r.used[0];
    const email = single ? emailFor(s.winner_name, where.html, where.url, taken) : null;
    if (email) taken.add(email.toLowerCase());
    tags.push({ s, url: where.url, email });
  }
  for (const m of r.continuing) (nameOnPage(m.full_name, r.union, { loose: true }) ? present : absent).push({ m, url: r.used[0].url });
}

for (const t of tags) console.log(`  ⇢ ${t.s.state} ${t.s.office} ${t.s.district}: ${t.s.winner_name} in office, ${t.s.incumbent_name ?? "(open seat)"} gone${t.email ? ` · ${t.email}` : ""}`);
for (const h of holds.slice(0, 20)) console.log(`  = ${h}`);
if (VERBOSE) for (const a of absent) console.log(`  ? ${a.m.state} ${a.m.role} ${a.m.district}: ${a.m.full_name} not on ${a.url}`);

if (tags.length > MAX_TAGS) {
  await telemetry("error", `held: ${tags.length} seats would be marked in office, over ${MAX_TAGS}`);
  throw new Error("too many seats in one run, held for review");
}

// 5. Writes.
let tagged = 0, opened = 0, counted = 0, cleared = 0, failed = 0, remembered = 0;
if (APPLY) {
  for (const { s, url, email } of tags) {
    const line = `- On ${url} ${today}: ${s.winner_name} listed${s.incumbent_name ? `, ${s.incumbent_name} not` : ""}${email ? ` (address printed there: ${email})` : ""}.`;
    const { error } = await sb.from("seat_elections").update({
      result_sources: [...new Set([...(s.result_sources ?? []), `official-roster:${today}`])],
      winner_source_url: url, ...(email ? { winner_email: email } : {}),
      sources_md: [s.sources_md, line].filter(Boolean).join("\n"), updated_at: new Date().toISOString(),
    }).eq("id", s.id).eq("status", s.status);
    if (error) failed++; else tagged++;
  }
  const open = new Map();
  const ids = [...absent, ...present].map((x) => x.m.id);
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await sb.from("official_roster_checks").select("legislator_id, last_missed_on, misses, cleared_on").in("legislator_id", ids.slice(i, i + 300));
    for (const c of data ?? []) open.set(c.legislator_id, c);
  }
  const now = new Date().toISOString();
  for (const { m, url } of absent) {
    const c = open.get(m.id);
    if (c && !c.cleared_on && c.last_missed_on === today) continue;
    const row = c && !c.cleared_on
      ? { misses: c.misses + 1, last_missed_on: today, url, updated_at: now }
      : { first_missed_on: today, last_missed_on: today, misses: 1, cleared_on: null, url, updated_at: now };
    const { error } = c
      ? await sb.from("official_roster_checks").update(row).eq("legislator_id", m.id)
      : await sb.from("official_roster_checks").insert({ legislator_id: m.id, state: m.state, office: m.role, ...row });
    if (error) failed++; else if (c && !c.cleared_on) counted++; else opened++;
  }
  for (const p of learnedWrites) {
    const { error } = await sb.from("official_roster_pages").upsert({ ...p, updated_at: now }, { onConflict: "state,office,url,method" });
    if (error) failed++; else remembered++;
  }
  for (const { m } of present) {
    const c = open.get(m.id);
    if (!c || c.cleared_on) continue;
    const { error } = await sb.from("official_roster_checks").update({ cleared_on: today, updated_at: now }).eq("legislator_id", m.id);
    if (error) failed++; else cleared++;
  }
}

const vouched = results.filter((r) => r.check?.vouches).length;
const summary = `${APPLY ? "" : "DRY "}chambers ${results.length} · vouched ${vouched} · seats in office ${tags.length}${APPLY ? ` (tagged ${tagged})` : ""} · addresses found ${tags.filter((t) => t.email).length} · both listed ${holds.length} · winner not listed yet ${notYet.length} · missing members ${absent.length}${APPLY ? ` (new ${opened}, again ${counted}, cleared ${cleared})` : ""} · pages remembered ${learnedWrites.filter((p) => !p.misses).length}${DISCOVER ? ` (discovered ${discovered})` : ""} · failed ${failed} · unreadable: ${unreadable.join(", ") || "none"}`;
console.log(summary);
await telemetry(failed ? "error" : vouched ? "success" : "error", summary, tagged + opened + counted + cleared);
if (failed) process.exit(1);
