#!/usr/bin/env node
/**
 * audit-wikidata-portraits.mjs — re-check every Wikidata photo on file with the
 * state-checked query (scripts/lib/wikidata-portrait.mjs).
 *
 * WHY (2026-11-18): the old portrait sync matched on name alone, so local
 * officials showed famous namesakes (Speaker Kevin McCarthy for a Normal, IL
 * council member). For each legislators row with portrait_source 'wikidata':
 *   same image as the state-checked answer   -> keep
 *   a different, state-checked image          -> replace with it
 *   no state-checked image                    -> clear (no photo beats a wrong one)
 *   county seats never get a replacement (in-state namesakes), and state
 *   rows with no match are only listed for review (statewide offices miss the check)
 *   Wikidata query failed                     -> keep, counted as "unchecked"
 *
 *   node --env-file=.env.local scripts/audit-wikidata-portraits.mjs               # dry run
 *   node --env-file=.env.local scripts/audit-wikidata-portraits.mjs --apply --backup private/backups/x.json
 *   --max-minutes N (default 40)   --limit N   --level municipal|county|state
 *
 * Undo: every changed row (id, old url, new url) goes to the --backup file.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { stateCheckedPortrait, commonsFile } from "./lib/wikidata-portrait.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const APPLY = argv.includes("--apply");
const BACKUP = arg("backup", null);
const LIMIT = Number(arg("limit", 1e9));
const LEVEL = arg("level", null);
const DEADLINE = Date.now() + Number(arg("max-minutes", 40)) * 60_000;
const CONCURRENCY = 3; // WDQS asks for few parallel queries per client
if (APPLY && !BACKUP) { console.error("--apply needs --backup <file> (the undo list)"); process.exit(2); }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const rows = [];
for (let from = 0; ; from += 1000) {
  let q = sb.from("legislators").select("id, full_name, state, level, locality, portrait_url").eq("portrait_source", "wikidata").order("id");
  if (LEVEL) q = q.eq("level", LEVEL);
  const { data, error } = await q.range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...data);
  if (data.length < 1000) break;
}
const todo = rows.slice(0, LIMIT);
console.log(`wikidata portraits on file: ${rows.length}; checking ${todo.length}${APPLY ? "" : " (DRY RUN)"}`);

const out = { keep: 0, replace: [], clear: [], review: [], unchecked: 0, timedOut: 0 };
let next = 0;
async function worker() {
  while (next < todo.length) {
    const r = todo[next++];
    if (Date.now() > DEADLINE) { out.timedOut++; continue; }
    const res = await stateCheckedPortrait(r.full_name, r.state);
    if (!res.ok) { out.unchecked++; continue; }
    // Any in-state image confirms the one on file (two P18 photos, e.g. Keith Ellison).
    if (res.imgs.some((i) => commonsFile(i) === commonsFile(r.portrait_url))) { out.keep++; continue; }
    const row = { id: r.id, name: r.full_name, where: `${r.level} ${r.locality ?? r.state}`, old: r.portrait_url, new: null };
    // Statewide offices miss the place check when Wikidata files them oddly (Gov.
    // Sarah Huckabee Sanders returned nothing), and a county seat's in-state
    // namesake is usually a different person (an 18th-century SC William Smith).
    // So: county never gets a replacement, and state rows are only listed for a person to check.
    if (r.level === "state") { if (res.img) out.replace.push({ ...row, new: res.img }); else out.review.push(row); continue; }
    if (res.img && r.level !== "county") out.replace.push({ ...row, new: res.img }); else out.clear.push(row);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const show = (x) => `  ${x.where} | ${x.name} | ${commonsFile(x.old)}${x.new ? ` -> ${commonsFile(x.new)}` : ""}`;
console.log(`\nkeep ${out.keep} · replace ${out.replace.length} · clear ${out.clear.length} · state rows for review ${out.review.length} · unchecked ${out.unchecked} · not reached ${out.timedOut}`);
console.log("\nreplace:"); out.replace.forEach((x) => console.log(show(x)));
console.log("\nclear:"); out.clear.forEach((x) => console.log(show(x)));
console.log("\nreview (state, not changed):"); out.review.forEach((x) => console.log(show(x)));

if (APPLY) {
  fs.writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), replace: out.replace, clear: out.clear }, null, 1));
  const now = new Date().toISOString();
  let ok = 0;
  for (const x of out.replace) {
    const { error } = await sb.from("legislators").update({ portrait_url: x.new, portrait_synced_at: now }).eq("id", x.id).eq("portrait_source", "wikidata");
    if (!error) ok++; else console.error(`  ! ${x.id}: ${error.message}`);
  }
  for (const x of out.clear) {
    const { error } = await sb.from("legislators").update({ portrait_url: null, portrait_source: null, portrait_synced_at: now }).eq("id", x.id).eq("portrait_source", "wikidata");
    if (!error) ok++; else console.error(`  ! ${x.id}: ${error.message}`);
  }
  console.log(`\napplied ${ok} of ${out.replace.length + out.clear.length}; undo list: ${BACKUP}`);
}
