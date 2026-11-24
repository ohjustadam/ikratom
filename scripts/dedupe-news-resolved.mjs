#!/usr/bin/env node
/**
 * dedupe-news-resolved.mjs: collapse news_items rows that resolved to the same
 * publisher URL into one row per story.
 *
 * Why: ingest dedupes on the Google News `url`, and one story arrives under
 * several Google URLs that only meet once resolve-news-urls fills resolved_url.
 * The audit on 2026-11-24 found 7,511 such twin rows (about 30% of the table).
 * Migration 0330 stops new ones; this clears the ones already stored.
 *
 * Keeper per resolved_url (scripts/lib/news-resolved-url.mjs, keeperSortKey):
 * active first, then referenced (intel alert, push, legislator mention, press
 * contact, notification link, a duplicate from outside the group), then body
 * extracted, then already canonical, then the oldest.
 *
 * Modes:
 *   (default)  dry-run: print the plan and the counts, write nothing.
 *   --mark     reversible, no deletes: every twin that still shows as its own
 *              story gets duplicate_of = keeper, so feeds list it once.
 *              Writes an undo file.
 *   --apply    THE OWNER'S YES ONLY. Moves every reference onto the keeper
 *              (intel alert link, legislator mentions, press contact,
 *              notification links, duplicates pointing at a twin), then
 *              DELETES the twins. The undo file holds every deleted row in
 *              full, written before the first change.
 *   --restore <file>  replays an undo file from --mark or --apply.
 *
 * Options: --backup <path> (default: <main checkout>/private/backups/
 * news-dedupe-resolved-<mode>-<stamp>.json), --sample N (groups to print).
 *
 * After --apply, VACUUM FULL news_items in a quiet hour (owner's yes) to hand
 * the space back; a plain delete only marks it reusable.
 *
 *   node --env-file=.env.local scripts/dedupe-news-resolved.mjs
 *   node --env-file=.env.local scripts/dedupe-news-resolved.mjs --mark
 *   node --env-file=.env.local scripts/dedupe-news-resolved.mjs --apply
 *   node --env-file=.env.local scripts/dedupe-news-resolved.mjs --restore private/backups/<file>.json
 */
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { newsIdsInLink, planResolvedDedupe, rewriteNewsLink } from "./lib/news-resolved-url.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes("--apply");
const MARK = args.includes("--mark");
const RESTORE = arg("--restore");
const SAMPLE = parseInt(arg("--sample") ?? "5", 10);
if (APPLY && MARK) { console.error("Pick one of --mark or --apply."); process.exit(2); }

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const CHUNK = 100;
const chunks = (arr, n = CHUNK) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

/** private/ lives in the main checkout only (worktrees don't have it). */
function defaultBackupPath(mode) {
  let root = process.cwd();
  try {
    const common = execSync("git rev-parse --path-format=absolute --git-common-dir", { encoding: "utf8" }).trim();
    root = dirname(common);
  } catch { /* not a git checkout: use the cwd */ }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return join(root, "private", "backups", `news-dedupe-resolved-${mode}-${stamp}.json`);
}

function writeBackup(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload));
  console.log(`Undo file: ${path}`);
}

async function pageAll(build, label) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(`${label}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function must(promise, what) {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// ─────────────────────────────── restore ───────────────────────────────
if (RESTORE) {
  const undo = JSON.parse(readFileSync(resolve(RESTORE), "utf8"));
  console.log(`Restoring ${undo.kind} from ${RESTORE} (${undo.created_at})…`);
  if (undo.kind === "apply") {
    // 1. Put the deleted rows back without links first (a row may point at
    //    another restored row), then set every recorded duplicate_of.
    for (const c of chunks(undo.deleted_rows)) {
      const rows = c.map((r) => ({ ...r, duplicate_of: null, duplicate_count: 0 }));
      await must(sb.from("news_items").upsert(rows, { onConflict: "id", ignoreDuplicates: true }), "re-insert");
    }
    for (const r of undo.deleted_rows) {
      await must(sb.from("news_items").update({ duplicate_of: r.duplicate_of }).eq("id", r.id), "relink");
    }
    for (const k of undo.keepers) {
      await must(sb.from("news_items").update({ duplicate_of: k.duplicate_of, policy_alert_id: k.policy_alert_id }).eq("id", k.id), "keeper");
    }
    for (const m of undo.moved_mentions) await must(sb.from("legislator_news_mentions").update({ news_item_id: m.news_item_id }).eq("id", m.id), "mention");
    for (const p of undo.moved_press) await must(sb.from("press_contacts").update({ news_item_id: p.news_item_id }).eq("id", p.id), "press");
    for (const c of chunks(undo.dropped_mentions)) await must(sb.from("legislator_news_mentions").upsert(c, { onConflict: "id", ignoreDuplicates: true }), "mention rows");
    for (const c of chunks(undo.dropped_press)) await must(sb.from("press_contacts").upsert(c, { onConflict: "id", ignoreDuplicates: true }), "press rows");
  }
  // Both kinds: duplicate_of and notification links as they were. Rows that
  // were canonical go first: once a row becomes a duplicate again, the 0330
  // fold trigger moves its duplicates to its parent, so the rows that point
  // at it are set last.
  const relinked = [...(undo.relinked ?? [])].sort((a, b) => (a.duplicate_of ? 1 : 0) - (b.duplicate_of ? 1 : 0));
  for (const r of relinked) {
    await must(sb.from("news_items").update({ duplicate_of: r.duplicate_of }).eq("id", r.id), "relinked");
  }
  for (const n of undo.notifications ?? []) {
    await must(sb.from("notifications").update({ link: n.link }).eq("id", n.id), "notification");
  }
  console.log("Restored.");
  process.exit(0);
}

// ─────────────────────────────── load ──────────────────────────────────
const mode = APPLY ? "apply" : MARK ? "mark" : "dry-run";
console.log(`dedupe-news-resolved [${mode.toUpperCase()}]: loading news_items…`);

const rows = await pageAll(() => sb.from("news_items")
  .select("id, resolved_url, duplicate_of, active, scraped_at, body_extracted_at, policy_alert_id, auto_pushed_at")
  .order("id"), "news_items");
const mentions = await pageAll(() => sb.from("legislator_news_mentions")
  .select("id, legislator_id, news_item_id, matched_field").order("id"), "mentions");
const press = await pageAll(() => sb.from("press_contacts")
  .select("id, news_item_id").not("news_item_id", "is", null).order("id"), "press");
const notes = await pageAll(() => sb.from("notifications")
  .select("id, link").ilike("link", "%/news/%").order("id"), "notifications");
console.log(`  ${rows.length} rows, ${mentions.length} mentions, ${press.length} press contacts, ${notes.length} notification links`);

const byId = new Map(rows.map((r) => [r.id, r]));
const refWeight = new Map();
const bump = (id) => refWeight.set(id, (refWeight.get(id) ?? 0) + 1);
for (const m of mentions) bump(m.news_item_id);
for (const p of press) bump(p.news_item_id);
for (const n of notes) for (const id of newsIdsInLink(n.link)) bump(id);
// A duplicate from another story counts; a twin inside the same group doesn't.
for (const r of rows) {
  if (!r.duplicate_of) continue;
  const parent = byId.get(r.duplicate_of);
  if (parent && parent.resolved_url !== r.resolved_url) bump(r.duplicate_of);
}

const plan = planResolvedDedupe(rows, refWeight);
const { groups, deleteIds, holdIds, alertMoves, loserToKeeper } = plan;
const keeperIds = new Set(groups.map((g) => g.keeper));
const deleteSet = new Set(deleteIds);

// ─────────────────────────────── report ────────────────────────────────
const twinsShowing = [...deleteIds, ...holdIds].filter((id) => {
  const r = byId.get(id);
  return r.active && !r.duplicate_of;
});
const keeperUndup = groups.filter((g) => {
  const k = byId.get(g.keeper);
  return k.duplicate_of && (deleteSet.has(k.duplicate_of) || holdIds.includes(k.duplicate_of));
});
const inactiveKeeperActiveLoser = groups.filter((g) => !byId.get(g.keeper).active && g.losers.some((id) => byId.get(id).active));
const unextractedKeeper = groups.filter((g) => !byId.get(g.keeper).body_extracted_at && g.losers.some((id) => byId.get(id).body_extracted_at));
const outsideChildren = rows.filter((r) => r.duplicate_of && deleteSet.has(r.duplicate_of) && !deleteSet.has(r.id));
const keeperMentionKeys = new Set(mentions.filter((m) => keeperIds.has(m.news_item_id)).map((m) => `${m.legislator_id}|${m.news_item_id}|${m.matched_field}`));
const loserMentions = mentions.filter((m) => deleteSet.has(m.news_item_id));
const movedMentions = [], droppedMentions = [];
for (const m of loserMentions) {
  const key = `${m.legislator_id}|${loserToKeeper.get(m.news_item_id)}|${m.matched_field}`;
  if (keeperMentionKeys.has(key)) droppedMentions.push(m);
  else { keeperMentionKeys.add(key); movedMentions.push(m); }
}
const keeperHasPress = new Set(press.filter((p) => keeperIds.has(p.news_item_id)).map((p) => p.news_item_id));
const movedPress = [], droppedPress = [];
for (const p of press.filter((x) => deleteSet.has(x.news_item_id))) {
  const keeper = loserToKeeper.get(p.news_item_id);
  if (keeperHasPress.has(keeper)) droppedPress.push(p);
  else { keeperHasPress.add(keeper); movedPress.push(p); }
}
const noteRewrites = notes
  .map((n) => ({ id: n.id, link: n.link, next: rewriteNewsLink(n.link, loserToKeeper) }))
  .filter((n) => n.next);
/** Rows the fold trigger (0330) moves when `parents` stop being canonical. */
const foldedChildren = (parents) => {
  const set = new Set(parents);
  return rows.filter((r) => r.duplicate_of && set.has(r.duplicate_of) && !deleteSet.has(r.id))
    .map((r) => ({ id: r.id, duplicate_of: r.duplicate_of }));
};

console.log(`
Twin groups (same resolved_url):         ${groups.length}
Rows to delete (--apply):                ${deleteIds.length}
Rows held back (tied to another alert):  ${holdIds.length}
Unusable resolved_url left out:          ${plan.skippedUnusable}
Twins still showing as their own story:  ${twinsShowing.length}   (--mark hides these)
Intel-alert links moved to the keeper:   ${alertMoves.length}
Keepers freed from a twin parent:        ${keeperUndup.length}
Duplicates re-pointed from outside:      ${outsideChildren.length}
Legislator mentions moved / dropped:     ${movedMentions.length} / ${droppedMentions.length}
Press contacts moved / dropped:          ${movedPress.length} / ${droppedPress.length}
Notification links rewritten:            ${noteRewrites.length}
Check: inactive keeper, active twin:     ${inactiveKeeperActiveLoser.length}   (should be 0)
Check: keeper has no body, twin has one: ${unextractedKeeper.length}`);

for (const g of groups.slice(0, SAMPLE)) {
  const k = byId.get(g.keeper);
  console.log(`\n  ${g.resolved_url.slice(0, 90)}\n    keep   ${k.id} active=${k.active} body=${!!k.body_extracted_at} alert=${!!k.policy_alert_id} refs=${refWeight.get(k.id) ?? 0}`);
  for (const id of g.losers) { const r = byId.get(id); console.log(`    delete ${id} active=${r.active} body=${!!r.body_extracted_at} dup_of=${r.duplicate_of ? r.duplicate_of.slice(0, 8) : "-"}`); }
  for (const id of g.held) console.log(`    hold   ${id} (its own alert)`);
}

if (!APPLY && !MARK) {
  console.log("\nDry run: nothing written. --mark hides the twins (reversible); --apply deletes them (owner's yes).");
  process.exit(0);
}

// ─────────────────────────────── mark ──────────────────────────────────
if (MARK) {
  // Every twin that still shows as its own story becomes a duplicate of its
  // keeper. The undo file lists every row this can touch, written first.
  const path = arg("--backup") ?? defaultBackupPath("mark");
  const byKeeper = new Map();
  for (const g of groups) {
    const ids = [...g.losers, ...g.held].filter((id) => !byId.get(id).duplicate_of);
    if (ids.length) byKeeper.set(g.keeper, ids);
  }
  const undo = {
    kind: "mark",
    created_at: new Date().toISOString(),
    relinked: [
      ...keeperUndup.map((g) => ({ id: g.keeper, duplicate_of: byId.get(g.keeper).duplicate_of })),
      ...[...byKeeper.values()].flat().map((id) => ({ id, duplicate_of: null })),
      ...foldedChildren([...byKeeper.values()].flat()),
    ],
  };
  writeBackup(path, undo);
  // A keeper that is a duplicate of one of its own twins is freed first, or
  // the two would end up pointing at each other.
  for (const g of keeperUndup) await must(sb.from("news_items").update({ duplicate_of: null }).eq("id", g.keeper), "free keeper");
  let n = 0, step = 0;
  for (const [keeper, ids] of byKeeper) {
    const done = await must(sb.from("news_items").update({ duplicate_of: keeper }).in("id", ids).is("duplicate_of", null).select("id"), "mark");
    n += done?.length ?? 0;
    if (++step % 250 === 0) console.log(`  ${step}/${byKeeper.size} groups, ${n} marked…`);
  }
  console.log(`\nMarked ${n} twins as duplicates of their keeper. Undo: --restore ${path}`);
  process.exit(0);
}

// ─────────────────────────────── apply ─────────────────────────────────
const path = arg("--backup") ?? defaultBackupPath("apply");
console.log("\nAPPLY: saving every row to be deleted before the first change…");
const deletedRows = [];
for (const c of chunks(deleteIds, 200)) {
  const data = await must(sb.from("news_items").select("*").in("id", c), "backup rows");
  for (const r of data) { delete r.search_tsv; deletedRows.push(r); } // generated column
}
if (deletedRows.length !== deleteIds.length) {
  console.error(`Backup read ${deletedRows.length} of ${deleteIds.length} rows; stopping before any change.`);
  process.exit(1);
}
const droppedMentionRows = [];
for (const c of chunks(droppedMentions.map((m) => m.id), 200)) droppedMentionRows.push(...(await must(sb.from("legislator_news_mentions").select("*").in("id", c), "mention backup")));
const droppedPressRows = [];
for (const c of chunks(droppedPress.map((p) => p.id), 200)) droppedPressRows.push(...(await must(sb.from("press_contacts").select("*").in("id", c), "press backup")));

const undo = {
  kind: "apply",
  created_at: new Date().toISOString(),
  deleted_rows: deletedRows,
  keepers: groups.map((g) => ({ id: g.keeper, duplicate_of: byId.get(g.keeper).duplicate_of, policy_alert_id: byId.get(g.keeper).policy_alert_id })),
  relinked: [
    ...outsideChildren.map((r) => ({ id: r.id, duplicate_of: r.duplicate_of })),
    ...holdIds.map((id) => ({ id, duplicate_of: byId.get(id).duplicate_of })),
    ...foldedChildren(holdIds.filter((id) => !byId.get(id).duplicate_of)),
  ],
  moved_mentions: movedMentions.map((m) => ({ id: m.id, news_item_id: m.news_item_id })),
  moved_press: movedPress.map((p) => ({ id: p.id, news_item_id: p.news_item_id })),
  dropped_mentions: droppedMentionRows,
  dropped_press: droppedPressRows,
  notifications: noteRewrites.map((n) => ({ id: n.id, link: n.link })),
};
writeBackup(path, undo);

// 1. Keepers: off any twin parent, and holding the group's intel alert.
for (const g of keeperUndup) await must(sb.from("news_items").update({ duplicate_of: null }).eq("id", g.keeper), "free keeper");
for (const m of alertMoves) await must(sb.from("news_items").update({ policy_alert_id: m.policy_alert_id }).eq("id", m.keeper), "alert move");
// 2. Held rows (their own alert) stay, as duplicates of the keeper.
for (const id of holdIds) {
  const keeper = groups.find((g) => g.held.includes(id)).keeper;
  await must(sb.from("news_items").update({ duplicate_of: keeper }).eq("id", id), "hold");
}
// 3. Duplicates from other stories that point at a twin: onto the keeper.
for (const r of outsideChildren) {
  const keeper = loserToKeeper.get(r.duplicate_of);
  await must(sb.from("news_items").update({ duplicate_of: keeper === r.id ? null : keeper }).eq("id", r.id), "re-point duplicate");
}
// 4. Mentions, press contacts, notification links.
for (const m of movedMentions) await must(sb.from("legislator_news_mentions").update({ news_item_id: loserToKeeper.get(m.news_item_id) }).eq("id", m.id), "mention");
for (const p of movedPress) await must(sb.from("press_contacts").update({ news_item_id: loserToKeeper.get(p.news_item_id) }).eq("id", p.id), "press");
for (const n of noteRewrites) await must(sb.from("notifications").update({ link: n.next }).eq("id", n.id), "notification");
// 5. Delete the twins.
let deleted = 0;
for (const c of chunks(deleteIds)) {
  const done = await must(sb.from("news_items").delete().in("id", c).select("id"), "delete");
  deleted += done?.length ?? 0;
  if (deleted % 1000 < CHUNK) console.log(`  deleted ${deleted}…`);
}
console.log(`\nDeleted ${deleted} of ${deleteIds.length} twin rows. Undo: --restore ${path}`);
console.log("Next, on the owner's yes in a quiet hour: VACUUM FULL public.news_items;");
process.exit(deleted === deleteIds.length ? 0 : 1);
