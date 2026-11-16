/**
 * sync-state-legislator-contacts.mjs — keep state legislators' email, phone
 * and office address current from the keyless openstates/people roster.
 *
 * Why (PJ, 2026-11-11): one-click letters to Michigan Reps. DeBoyer and Neyer
 * bounced off addresses with a doubled letter. openstates/people had fixed
 * both long ago, but no job refreshed contact fields: every state legislator
 * row was last written by the one-off API seed on 2026-05-04, and the daily
 * roster diff only adds and retires people. This is the missing refresh.
 *
 * Joins on the exact `ocd-person` id (never a name). The field rules live in
 * scripts/lib/legislator-contacts.mjs: upstream never clears a field, an email
 * never steps down to a personal account, phone and address are replaced only
 * from the capitol office, a shared switchboard never replaces a direct line,
 * and an address our checkers rejected is never put back. A new email must
 * also be on a domain that accepts mail.
 *
 * Every change appends the old values to verified_sources_md, so it can be
 * reviewed and undone. Rows compared with the source get last_synced_at.
 *
 * Bulk brake: when more than --max-rows rows (default 25) would change in one
 * run, nothing is written and the run reports "held". The first run after the
 * May seed is a bulk rewrite that waits for the owner's yes (--allow-bulk);
 * after it, a normal run changes a handful of rows and applies on its own.
 *
 *   node --env-file=.env.local scripts/sync-state-legislator-contacts.mjs                 # dry run
 *   node --env-file=.env.local scripts/sync-state-legislator-contacts.mjs --apply
 *   node --env-file=.env.local scripts/sync-state-legislator-contacts.mjs --apply --only <uuid,uuid>
 *   node --env-file=.env.local scripts/sync-state-legislator-contacts.mjs --apply --state MI
 *   node --env-file=.env.local scripts/sync-state-legislator-contacts.mjs --apply --allow-bulk
 */
import { createClient } from "@supabase/supabase-js";
import yaml from "js-yaml";
import { PEOPLE_TARBALL, collectFromTarball } from "./lib/openstates-people.mjs";
import { contactFromPerson, diffContacts, markSharedPhones, provenanceLine, CONTACT_FIELDS } from "./lib/legislator-contacts.mjs";
import { acceptsMail } from "./check-legislator-email-domains.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = flag("--apply");
const ALLOW_BULK = flag("--allow-bulk");
const MAX_ROWS = Number(opt("--max-rows") ?? 25);
const ONLY = new Set((opt("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const STATE = opt("--state")?.toUpperCase();
const SOURCE = "state_legislator_contacts";
const TOUCH_AFTER_MS = 6 * 86_400_000; // re-stamp a checked row at most weekly

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

// data/us/ in the same repo is the US CONGRESS: exclude it.
const PATH_RE = /(?:^|\/)data\/(?!us\/)([a-z]{2})\/legislature\/[^/]+\.ya?ml$/i;
let files;
try {
  files = await collectFromTarball(PEOPLE_TARBALL, PATH_RE);
} catch (e) {
  await telemetry("error", `tarball: ${e.message}`);
  throw e;
}
const entries = [];
for (const [path, text] of files) {
  const m = PATH_RE.exec(path);
  if (!m) continue;
  let doc;
  try { doc = yaml.load(text); } catch { continue; }
  if (doc?.id) entries.push({ id: doc.id, state: m[1].toUpperCase(), contact: contactFromPerson(doc) });
}
markSharedPhones(entries);
const upstream = new Map(entries.map((e) => [e.id, e.contact]));
console.log(`openstates/people: ${upstream.size} current state legislators`);

// Ours. Page with .order(), or pages overlap (supabase-postgrest-1000-row-cap).
const ours = [];
for (let from = 0; ; from += 1000) {
  let q = sb.from("legislators")
    .select("id, state, full_name, openstates_id, email, phone, office_address, verified_sources_md, last_synced_at")
    .eq("level", "state").in("role", ["state_senate", "state_house"]).eq("active", true).not("openstates_id", "is", null);
  if (STATE) q = q.eq("state", STATE);
  const { data, error } = await q.order("id").range(from, from + 999);
  if (error) { await telemetry("error", `read: ${error.message}`); throw error; }
  ours.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const scope = ONLY.size ? ours.filter((r) => ONLY.has(r.id)) : ours;

// Diff, then drop any new email whose domain cannot receive mail.
const planned = [];
const matched = [];
for (const r of scope) {
  const up = upstream.get(r.openstates_id);
  if (!up) continue;
  matched.push(r);
  const changes = diffContacts(r, up);
  if (changes.length) planned.push({ row: r, changes });
}
const newDomains = [...new Set(planned.flatMap((p) => p.changes.filter((c) => c.field === "email").map((c) => c.to.split("@").pop().toLowerCase())))];
const mailOk = new Map();
for (const d of newDomains) mailOk.set(d, await acceptsMail(d));
let deadDropped = 0;
for (const p of planned) {
  const before = p.changes.length;
  p.changes = p.changes.filter((c) => c.field !== "email" || mailOk.get(c.to.split("@").pop().toLowerCase()) === true);
  deadDropped += before - p.changes.length;
}
const changed = planned.filter((p) => p.changes.length);

// Report: per field, how many replace a value and how many fill an empty one.
const tally = Object.fromEntries(CONTACT_FIELDS.map((f) => [f, { replace: 0, fill: 0 }]));
const byState = new Map();
for (const p of changed) {
  byState.set(p.row.state, (byState.get(p.row.state) ?? 0) + 1);
  for (const c of p.changes) tally[c.field][c.from ? "replace" : "fill"]++;
}
console.log(`compared ${matched.length} of ${scope.length} rows · ${changed.length} would change · ${deadDropped} email(s) dropped (domain takes no mail)`);
for (const f of CONTACT_FIELDS) console.log(`  ${f.padEnd(15)} replace ${tally[f].replace} · fill ${tally[f].fill}`);
console.log(`  by state: ${[...byState].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(", ") || "none"}`);
for (const p of changed.slice(0, 40)) {
  for (const c of p.changes) console.log(`  ${p.row.state} ${p.row.full_name}: ${c.field} ${c.from ?? "(empty)"} -> ${c.to}`);
}

const fieldNote = CONTACT_FIELDS.map((f) => `${f} ${tally[f].replace}+${tally[f].fill}`).join(", ");
if (!APPLY) {
  console.log(`\nDRY RUN: nothing written. ${changed.length > MAX_ROWS ? `Over the ${MAX_ROWS}-row brake: --apply would hold without --allow-bulk.` : ""}`);
  process.exit(0);
}
if (changed.length > MAX_ROWS && !ALLOW_BULK) {
  const notes = `HELD: ${changed.length} rows would change (brake ${MAX_ROWS}; owner yes, then --allow-bulk). ${fieldNote} (replace+fill)`;
  console.log(notes);
  await telemetry("error", notes);
  process.exit(0);
}

let updated = 0, failed = 0;
const nowIso = new Date().toISOString();
for (const p of changed) {
  const patch = Object.fromEntries(p.changes.map((c) => [c.field, c.to]));
  const md = [p.row.verified_sources_md, provenanceLine(p.changes, p.row.openstates_id, today)].filter(Boolean).join("\n");
  const { error } = await sb.from("legislators").update({ ...patch, verified_sources_md: md, last_synced_at: nowIso }).eq("id", p.row.id);
  if (error) { failed++; console.error(`  ! ${p.row.full_name}: ${error.message}`); } else updated++;
}

// Stamp the unchanged rows we compared, in chunks, at most once a week each.
const changedIds = new Set(changed.map((p) => p.row.id));
const stale = matched.filter((r) => !changedIds.has(r.id) && (!r.last_synced_at || Date.parse(r.last_synced_at) < t0 - TOUCH_AFTER_MS)).map((r) => r.id);
let stamped = 0;
for (let i = 0; i < stale.length; i += 150) {
  const ids = stale.slice(i, i + 150);
  const { error } = await sb.from("legislators").update({ last_synced_at: nowIso }).in("id", ids);
  if (error) { failed++; console.error(`  ! stamp: ${error.message}`); } else stamped += ids.length;
}

const summary = `${updated} rows changed (${fieldNote} replace+fill) · ${stamped} confirmed unchanged · ${deadDropped} dead-domain emails skipped · ${failed} failed · ${Math.round((Date.now() - t0) / 1000)}s`;
console.log(summary);
await telemetry(failed ? "error" : updated + stamped > 0 ? "success" : "empty", summary, updated);
