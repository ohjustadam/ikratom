import type { SupabaseClient } from "@supabase/supabase-js";
import { isArea, isChangeType, type PatchNoteFigure, type PatchNoteItem } from "@/lib/patch-note-items";
import { publishBlocklistMatches } from "../../../scripts/lib/changelog-safety.mjs";

/**
 * Validation and the safety check for a note's ledger (migration 0323). Kept out
 * of the "use server" module so it can be unit-tested and shared by publish and
 * save.
 */

export const MAX_ITEMS = 200;
export const MAX_FIGURES = 24;

export type ItemInsert = {
  merged_on: string;
  pr: number | null;
  area: string;
  type: string;
  title: string;
  detail: string | null;
  member_report: boolean;
  sort: number;
};

export type FigureInsert = {
  key: string;
  value: number;
  label: string;
  detail: string | null;
  sort: number;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9_]{1,40}$/;
const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");

/** Server-side checks on what the editor sent. Mirrors the table's CHECKs. */
export function validateLedger(
  items: PatchNoteItem[],
  figures: PatchNoteFigure[],
): { ok: true; items: Omit<ItemInsert, "sort">[]; figures: Omit<FigureInsert, "sort">[] } | { error: string } {
  if (!Array.isArray(items) || !Array.isArray(figures)) return { error: "Bad input." };
  if (items.length > MAX_ITEMS) return { error: `At most ${MAX_ITEMS} items.` };
  if (figures.length > MAX_FIGURES) return { error: `At most ${MAX_FIGURES} figures.` };

  const outItems: Omit<ItemInsert, "sort">[] = [];
  for (const [n, i] of items.entries()) {
    const row = `Item ${n + 1}`;
    const title = clean(i.title, 200);
    if (!title) return { error: `${row} needs a title.` };
    if (!YMD.test(i.mergedOn ?? "") || Number.isNaN(Date.parse(i.mergedOn))) return { error: `${row} needs a date.` };
    if (!isArea(i.area)) return { error: `${row} has an unknown area.` };
    if (!isChangeType(i.type)) return { error: `${row} has an unknown type.` };
    const pr = i.pr == null || (i.pr as unknown) === "" ? null : Number(i.pr);
    if (pr !== null && !(Number.isInteger(pr) && pr > 0)) return { error: `${row} has a bad PR number.` };
    outItems.push({
      merged_on: i.mergedOn,
      pr,
      area: i.area,
      type: i.type,
      title,
      detail: clean(i.detail, 500) || null,
      member_report: i.memberReport === true,
    });
  }

  const outFigures: Omit<FigureInsert, "sort">[] = [];
  const keys = new Set<string>();
  for (const [n, f] of figures.entries()) {
    const row = `Figure ${n + 1}`;
    const key = clean(f.key, 40).toLowerCase();
    if (!KEY.test(key)) return { error: `${row} needs a key of letters, digits and _.` };
    if (keys.has(key)) return { error: `${row} repeats the key "${key}".` };
    keys.add(key);
    const value = Number(f.value);
    if (!Number.isFinite(value)) return { error: `${row} needs a number.` };
    const label = clean(f.label, 80);
    if (!label) return { error: `${row} needs a label.` };
    outFigures.push({ key, value, label, detail: clean(f.detail, 200) || null });
  }
  return { ok: true, items: outItems, figures: outFigures };
}

/**
 * The words in a ledger that stop it going public (empty = clean). Same list as
 * the note itself: What's New carries only changes members can see.
 */
export function ledgerBlockedWords(
  items: Array<{ title: string; detail: string | null }>,
  figures: Array<{ label: string; detail: string | null }>,
): string[] {
  const text = [
    ...items.flatMap((i) => [i.title, i.detail ?? ""]),
    ...figures.flatMap((f) => [f.label, f.detail ?? ""]),
  ].join("\n");
  return publishBlocklistMatches(text);
}

/** Why a note's stored ledger can't be public, or null if it can. */
export async function ledgerBlockReason(supabase: SupabaseClient, noteId: string): Promise<string | null> {
  const [items, figures] = await Promise.all([
    supabase.from("patch_note_items").select("title, detail").eq("note_id", noteId),
    supabase.from("patch_note_figures").select("label, detail").eq("note_id", noteId),
  ]);
  // Fail closed: a check that could not read the rows has not passed them.
  if (items.error || figures.error) return `Could not check the items: ${(items.error ?? figures.error)!.message}`;
  const words = ledgerBlockedWords(
    (items.data ?? []) as Array<{ title: string; detail: string | null }>,
    (figures.data ?? []) as Array<{ label: string; detail: string | null }>,
  );
  if (words.length === 0) return null;
  return `What's New is only for changes members can see. Reword or remove in the items: ${words.join(", ")}.`;
}
