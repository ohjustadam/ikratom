"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "./actions";
import { recordAdminAction } from "@/lib/audit";

/**
 * Curate the public changelog (`patch_notes`, migration 0250).
 *
 * The daily cron writes DRAFTS. This module is the only path by which a draft
 * becomes public, and that separation is the point: generator output is a
 * starting point, never publishable copy. Raw commit subjects once carried an
 * editor instruction onto the public page (PR #691), so a human reads every
 * note before it ships.
 *
 * Publishing costs nothing now — no branch, no PR, no Netlify build — which is
 * the whole reason the changelog moved off files.
 */

const MAX_TITLE = 200;
const MAX_SUMMARY = 500;
const MAX_BODY = 60_000;

export type AdminPatchNote = {
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  published_on: string;
  total_commits: number | null;
  status: string;
  updated_at: string;
};

export async function listPatchNotesForAdmin(): Promise<
  { ok: true; rows: AdminPatchNote[] } | { error: string }
> {
  const ctx = await getAdminContext({ require: "edit_site_content" });
  if (!ctx.ok) return { error: "Admins only." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patch_notes")
    .select("slug, title, summary, body_md, published_on, total_commits, status, updated_at")
    .order("published_on", { ascending: false })
    .limit(100);
  if (error) return { error: error.message };
  return { ok: true, rows: (data ?? []) as AdminPatchNote[] };
}

/** Save curated copy. Allowed in any status — a published typo is still a typo. */
export async function savePatchNote(input: {
  slug: string;
  title: string;
  summary: string;
  bodyMd: string;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await getAdminContext({ require: "edit_site_content" });
  if (!ctx.ok) return { error: "Admins only." };

  const slug = input.slug.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) return { error: "Bad slug." };

  const title = input.title.trim().slice(0, MAX_TITLE);
  if (!title) return { error: "A note needs a title." };
  const body = input.bodyMd.slice(0, MAX_BODY);
  if (!body.trim()) return { error: "A note needs a body." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("patch_notes")
    .update({
      title,
      summary: input.summary.trim().slice(0, MAX_SUMMARY) || null,
      body_md: body,
    })
    .eq("slug", slug);
  if (error) return { error: error.message };

  await recordAdminAction({ action: "patch_note.save", details: { slug } });
  revalidatePath("/admin/whats-new");
  revalidatePath("/whats-new");
  revalidatePath(`/whats-new/${slug}`);
  return { ok: true };
}

/**
 * Publish or unpublish. This is the one-click that used to be a squash-merge.
 *
 * Unpublish sets 'archived' rather than back to 'draft': a note that has been
 * public and was pulled is a different thing from one never reviewed, and the
 * generator refuses to overwrite anything that is not a draft — so returning
 * it to 'draft' would let the next morning's run silently replace curated copy
 * with raw commit subjects.
 */
export async function setPatchNoteStatus(input: {
  slug: string;
  publish: boolean;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await getAdminContext({ require: "edit_site_content" });
  if (!ctx.ok) return { error: "Admins only." };

  const slug = input.slug.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) return { error: "Bad slug." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("patch_notes")
    .update(
      input.publish
        ? {
            status: "published",
            published_by: user?.id ?? null,
            published_at: new Date().toISOString(),
          }
        : { status: "archived" },
    )
    .eq("slug", slug);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: input.publish ? "patch_note.publish" : "patch_note.unpublish",
    details: { slug },
  });
  revalidatePath("/admin/whats-new");
  revalidatePath("/whats-new");
  revalidatePath(`/whats-new/${slug}`);
  return { ok: true };
}
