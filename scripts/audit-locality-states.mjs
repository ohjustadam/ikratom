/**
 * Daily self-healing locality<->state audit.
 *
 * The permanent backstop behind the gazetteer resolver (scripts/lib/geo-resolver.mjs):
 * re-checks every geo-tagged row against the authoritative US gazetteer and
 * auto-corrects place<->state mismatches (Reno County tagged NV, a national FDA
 * story tagged a state, etc.). Even a brand-new edge case is caught within a day.
 *
 * AUTO-APPLY only the high-precision determinations (federal signal, explicit
 * "<X> County", "City, ST" pair, multi-place intersection, full-state-name as
 * SUBJECT). Lower-precision multi-word bare-place guesses are FLAGGED, not
 * written — so we never auto-introduce a wrong state. Writes scraper_runs
 * telemetry (source 'locality_state_audit', registered in check-cron-staleness).
 *
 * Usage:
 *   node --env-file=.env.local scripts/audit-locality-states.mjs           # dry-run
 *   node --env-file=.env.local scripts/audit-locality-states.mjs --apply   # write corrections
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { resolveLocality, STATE_ABBRS } from "./lib/geo-resolver.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DUMP = args.includes("--dump") ? (args[args.indexOf("--dump") + 1] || "scripts/lib/geo/_proposed.json") : null;
const APPLY_CONFIRMED = args.includes("--apply-confirmed") ? args[args.indexOf("--apply-confirmed") + 1] : null;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const t0 = Date.now();
const STATES = [...STATE_ABBRS];

let scanned = 0, fixed = 0, review = 0;
const tally = {};
const fixSamples = [], reviewSamples = [];
const proposals = []; // every proposed correction (for --dump / adversarial verification)

// ── --apply-confirmed: apply ONLY a verified subset [{table,id,patch}], then exit ──
if (APPLY_CONFIRMED) {
  const list = JSON.parse(fs.readFileSync(APPLY_CONFIRMED, "utf8"));
  let ok = 0;
  for (const p of list) {
    const { error } = await sb.from(p.table).update(p.patch).eq("id", p.id);
    if (!error) ok++; else console.error(p.table, p.id, error.message);
  }
  console.log(`Applied ${ok}/${list.length} confirmed corrections.`);
  try { await sb.from("scraper_runs").insert({ source: "locality_state_audit", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(), status: "success", rows_added: ok, notes: `apply-confirmed: ${ok}/${list.length}` }); } catch {}
  process.exit(0);
}

// Only the NEVER-REJECTED tiers run unattended (daily cron): an explicit unique
// county, a consistent "City, ST" pair, and a federal-agency signal. Adversarial
// verification of 215 real corrections showed full-state-name, intersection,
// contradicted->ALL, and bare-place all produce false positives on ambiguous
// headlines (Long Island=NY, Kansas City=MO, multi-state counties, source
// bylines). Those are FLAGGED for the verified-apply path, NEVER auto-written.
// (Write-time prevention still uses all tiers — it has the full article + only
// overrides on high confidence.)
function autoApplyable(reason) {
  return /^(county|city-state|federal-signal)/.test(reason);
}
function correction(candidate, title, extra) {
  const r = resolveLocality({ title: title || "", text: `${title || ""} ${extra || ""}`.trim(), candidateState: candidate });
  if (r.locality !== candidate && (r.confidence === "high" || r.confidence === "medium")) return r;
  return null;
}
function fixSpecific(specific, oldSt, newSt) {
  if (!specific) return specific;
  const m = specific.match(/^(.*),\s*([A-Z]{2})\s*$/);
  if (m && m[2] === oldSt && /^[A-Z]{2}$/.test(newSt)) return `${m[1]}, ${newSt}`;
  return specific;
}
async function logRun(status, notes) {
  try {
    await sb.from("scraper_runs").insert({ source: "locality_state_audit", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(), status, rows_added: fixed, notes });
  } catch { /* best-effort */ }
}
/** Returns true if this correction should be written (auto-applyable). Records tally/samples. */
function classify(table, fromVal, r, label) {
  const key = r.reason.split(/[: ]/)[0];
  tally[key] = (tally[key] || 0) + 1;
  if (!autoApplyable(r.reason)) {
    review++;
    if (reviewSamples.length < 20) reviewSamples.push(`[REVIEW] ${table} ${fromVal}->${r.locality} [${r.reason}] "${label.slice(0, 56)}"`);
    return false;
  }
  if (fixSamples.length < 25) fixSamples.push(`${table} ${fromVal}->${r.locality} [${r.reason}] "${label.slice(0, 56)}"`);
  return true;
}

async function record(table, id, from, to, reason, title, patch) {
  const auto = classify(table, from, { locality: to, reason }, title);
  proposals.push({ table, id, from, to, reason, title: String(title).slice(0, 140), patch, autoApply: auto });
  if (auto) { if (APPLY) { const { error: e } = await sb.from(table).update(patch).eq("id", id); if (!e) fixed++; } else fixed++; }
}
async function auditPolicyAlerts() {
  const { data, error } = await sb.from("policy_alerts").select("id, locality, specific_locality, title").in("locality", STATES).limit(5000);
  if (error) return console.error("policy_alerts:", error.message);
  for (const a of data ?? []) {
    scanned++;
    const r = correction(a.locality, a.title, a.specific_locality);
    if (!r) continue;
    const patch = { locality: r.locality };
    const sp = fixSpecific(a.specific_locality, a.locality, r.locality);
    if (sp !== a.specific_locality) patch.specific_locality = sp;
    await record("policy_alerts", a.id, a.locality, r.locality, r.reason, a.title || a.specific_locality || "", patch);
  }
}
async function auditNewsItems() {
  const { data, error } = await sb.from("news_items").select("id, state, title").in("state", STATES).eq("active", true)
    .gte("published_at", new Date(Date.now() - 365 * 86400000).toISOString()).order("published_at", { ascending: false }).limit(5000);
  if (error) return console.error("news_items:", error.message);
  for (const it of data ?? []) {
    scanned++;
    const r = correction(it.state, it.title, null);
    if (!r) continue;
    const newState = (r.locality === "FED" || r.locality === "ALL") ? null : r.locality;
    await record("news_items", it.id, it.state, r.locality, r.reason, it.title || "", { state: newState });
  }
}
async function auditMeetings() {
  const { data, error } = await sb.from("municipal_meetings").select("id, state, locality").in("state", STATES).limit(5000);
  if (error) return console.error("municipal_meetings:", error.message);
  for (const m of data ?? []) {
    scanned++;
    const r = correction(m.state, m.locality, null);
    if (!r || r.locality === "FED" || r.locality === "ALL") continue;
    await record("municipal_meetings", m.id, m.state, r.locality, r.reason, m.locality || "", { state: r.locality });
  }
}
async function auditBills() {
  const { data, error } = await sb.from("bills").select("id, state, scope, locality, title").in("state", STATES).not("scope", "is", null).neq("scope", "state").not("locality", "is", null).limit(5000);
  if (error) return console.error("bills:", error.message);
  for (const b of data ?? []) {
    scanned++;
    const r = correction(b.state, b.title, b.locality);
    if (!r || r.locality === "FED" || r.locality === "ALL") continue;
    await record("bills", b.id, b.state, r.locality, r.reason, b.locality || b.title || "", { state: r.locality });
  }
}

console.log(`Locality<->state audit ${APPLY ? "(APPLY)" : "(DRY RUN)"}…`);
await auditPolicyAlerts();
await auditNewsItems();
await auditMeetings();
await auditBills();

console.log(`\nScanned ${scanned}. ${APPLY ? "Auto-corrected" : "Would auto-correct"} ${fixed}; flagged for review ${review}.`);
console.log("By evidence tier:", JSON.stringify(tally));
console.log("\nAuto-apply samples:");
for (const s of fixSamples) console.log("  " + s);
console.log("\nFlagged-for-review samples (NOT written):");
for (const s of reviewSamples) console.log("  " + s);
if (DUMP) { fs.writeFileSync(DUMP, JSON.stringify(proposals, null, 1)); console.log(`\nWrote ${proposals.length} proposals -> ${DUMP}`); }
await logRun(fixed > 0 ? "success" : "empty", `${APPLY ? "applied" : "dry"}: scanned ${scanned}, ${fixed} auto-fixed, ${review} flagged; tiers=${JSON.stringify(tally)}`);
process.exit(0);
