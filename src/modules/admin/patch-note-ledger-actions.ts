"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "./actions";
import { requireMfaForMutation } from "./mfa";
import { recordAdminAction } from "@/lib/audit";
import { toItems, type ItemRow, type PatchNoteFigure, type PatchNoteItem } from "@/lib/patch-note-items";
import { ledgerBlockedWords, validateLedger } from "./patch-note-ledger";

/**
 * Read and save a note's ledger items and number tiles (migration 0323) from
 * /admin/whats-new. The generator drafts the items; this is where the owner
 * edits them before Publish. Publish itself checks them again
 * (setPatchNoteStatus → ledgerBlockReason).
 */

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

type Ledger = { items: PatchNoteItem[]; figures: PatchNoteFigure[] };

async function noteBySlug(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patch_notes")
    .select("id, status")
    .eq("slug", slug)
    .maybeSingle();
  return { supabase, note: data as { id: string; status: string } | null, error };
}

export async function getPatchNoteLedger(slug: string): Promise<({ ok: true } & Ledger) | { error: string }> {
  const ctx = await getAdminContext({ require: "edit_site_content" });
  if (!ctx.ok) return { error: "Admins only." };
  if (!SLUG.test(slug)) return { error: "Bad slug." };

  const { supabase, note, error } = await noteBySlug(slug);
  if (error) return { error: error.message };
  if (!note) return { error: "Note not found." };

  const [items, figures] = await Promise.all([
    supabase
      .from("patch_note_items")
      .select("merged_on, pr, area, type, title, detail, member_report, sort")
      .eq("note_id", note.id)
      .order("sort", { ascending: true }),
    supabase
      .from("patch_note_figures")
      .select("key, value, label, detail")
      .eq("note_id", note.id)
      .order("sort", { ascending: true }),
  ]);
  if (items.error || figures.error) return { error: (items.error ?? figures.error)!.message };
  return {
    ok: true,
    items: toItems((items.data ?? []) as ItemRow[]),
    figures: ((figures.data ?? []) as PatchNoteFigure[]).map((f) => ({ ...f, value: Number(f.value) })),
  };
}

/**
 * Replace a note's items and tiles with what the editor holds. New rows go in
 * first and the old ones are removed after, so a failed insert leaves the old
 * ledger in place instead of an empty one.
 */
export async function savePatchNoteLedger(input: { slug: string } & Ledger): Promise<{ ok: true } | { error: string }> {
  const ctx = await getAdminContext({ require: "edit_site_content" });
  if (!ctx.ok) return { error: "Admins only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };
  const slug = input.slug?.trim() ?? "";
  if (!SLUG.test(slug)) return { error: "Bad slug." };

  const v = validateLedger(input.items, input.figures);
  if ("error" in v) return v;

  const { supabase, note, error } = await noteBySlug(slug);
  if (error) return { error: error.message };
  if (!note) return { error: "Note not found." };

  // A draft may hold anything while it is being curated. Live copy may not.
  if (note.status === "published") {
    const words = ledgerBlockedWords(v.items, v.figures);
    if (words.length) return { error: `What's New is only for changes members can see. Reword or remove: ${words.join(", ")}.` };
  }

  const [oldItems, oldFigures] = await Promise.all([
    supabase.from("patch_note_items").select("id").eq("note_id", note.id),
    supabase.from("patch_note_figures").select("id").eq("note_id", note.id),
  ]);
  if (oldItems.error || oldFigures.error) return { error: (oldItems.error ?? oldFigures.error)!.message };

  // Figures are UNIQUE (note_id, key), so the old tiles must go before the new.
  const oldFigureIds = (oldFigures.data ?? []).map((r) => r.id as string);
  if (oldFigureIds.length) {
    const del = await supabase.from("patch_note_figures").delete().in("id", oldFigureIds);
    if (del.error) return { error: del.error.message };
  }
  if (v.figures.length) {
    const ins = await supabase
      .from("patch_note_figures")
      .insert(v.figures.map((f, sort) => ({ ...f, sort, note_id: note.id })));
    if (ins.error) return { error: ins.error.message };
  }
  if (v.items.length) {
    const ins = await supabase
      .from("patch_note_items")
      .insert(v.items.map((i, sort) => ({ ...i, sort, note_id: note.id })));
    if (ins.error) return { error: ins.error.message };
  }
  const oldItemIds = (oldItems.data ?? []).map((r) => r.id as string);
  if (oldItemIds.length) {
    const del = await supabase.from("patch_note_items").delete().in("id", oldItemIds);
    if (del.error) return { error: `Saved, but the old items are still there too: ${del.error.message}` };
  }

  await recordAdminAction({
    action: "patch_note.save_ledger",
    details: { slug, items: v.items.length, figures: v.figures.length },
  });
  revalidatePath("/admin/whats-new");
  revalidatePath("/whats-new");
  revalidatePath(`/whats-new/${slug}`);
  return { ok: true };
}
