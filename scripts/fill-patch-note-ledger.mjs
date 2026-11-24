#!/usr/bin/env node
/**
 * Fill a What's New note's ledger items and number tiles (migration 0323) from
 * scripts/data/patch-notes/<slug>.json.
 *
 * Additive and reversible. It never touches the note itself, so body_md stays
 * the fallback, and it refuses a note that already has items unless --replace.
 *
 *   node --env-file=.env.local scripts/fill-patch-note-ledger.mjs --slug 2026-11-17-update            # dry run
 *   node --env-file=.env.local scripts/fill-patch-note-ledger.mjs --slug 2026-11-17-update --apply
 *   node --env-file=.env.local scripts/fill-patch-note-ledger.mjs --slug 2026-11-17-update --undo     # remove them again
 *
 * Every line is checked against scripts/lib/changelog-safety.mjs first, the same
 * list Publish uses: What's New carries only changes members can see.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkLedgerFile } from "./lib/patch-note-ledger-file.mjs";

const args = process.argv.slice(2);
const slug = args[args.indexOf("--slug") + 1];
const apply = args.includes("--apply");
const undo = args.includes("--undo");
const replace = args.includes("--replace");

if (!slug || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) {
  console.error("Usage: fill-patch-note-ledger.mjs --slug <slug> [--apply | --undo] [--replace]");
  process.exit(1);
}

const data = JSON.parse(readFileSync(join("scripts", "data", "patch-notes", `${slug}.json`), "utf8"));
const problems = checkLedgerFile(data);
if (problems.length) {
  console.error(`✗ ${slug}.json:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`${slug}: ${data.items.length} items, ${data.figures.length} figures, all clean.`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (run with --env-file=.env.local).");
  process.exit(1);
}
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: note, error } = await sb.from("patch_notes").select("id, status").eq("slug", slug).maybeSingle();
if (error) throw new Error(error.message);
if (!note) {
  console.error(`No patch_notes row for ${slug}.`);
  process.exit(1);
}

const count = async (table) => {
  const { count: n, error: e } = await sb.from(table).select("id", { count: "exact", head: true }).eq("note_id", note.id);
  if (e) throw new Error(`${table}: ${e.message}`);
  return n ?? 0;
};
const before = { items: await count("patch_note_items"), figures: await count("patch_note_figures") };
console.log(`Note is ${note.status}. Now: ${before.items} items, ${before.figures} figures.`);

const removeLedger = async () => {
  for (const table of ["patch_note_items", "patch_note_figures"]) {
    const { error: e } = await sb.from(table).delete().eq("note_id", note.id);
    if (e) throw new Error(`${table}: ${e.message}`);
  }
};
const hasLedger = before.items + before.figures > 0;

if (undo) {
  await removeLedger();
  console.log(`Removed the ledger of ${slug}. The note renders its markdown again.`);
  process.exit(0);
}
if (hasLedger && !replace) {
  console.error("This note already has a ledger. Pass --replace to swap it, or --undo to remove it.");
  process.exit(1);
}
if (!apply) {
  console.log(`Dry run${hasLedger ? " (would replace the current ledger)" : ""}. Pass --apply to write.`);
  process.exit(0);
}
if (hasLedger) await removeLedger();

const items = data.items.map((it, sort) => ({ ...it, detail: it.detail || null, sort, note_id: note.id }));
const figures = data.figures.map((f, sort) => ({ ...f, detail: f.detail || null, sort, note_id: note.id }));
const a = await sb.from("patch_note_items").insert(items);
if (a.error) throw new Error(`patch_note_items: ${a.error.message}`);
const b = await sb.from("patch_note_figures").insert(figures);
if (b.error) throw new Error(`patch_note_figures: ${b.error.message} (items went in; --undo removes them)`);

const after = { items: await count("patch_note_items"), figures: await count("patch_note_figures") };
console.log(`✓ ${slug}: ${after.items} items, ${after.figures} figures. Undo: --undo.`);
