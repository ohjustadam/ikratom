"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "./actions";
import { recordAdminAction } from "@/lib/audit";

/**
 * Server actions for the in-site mini-CMS.
 *
 * Read path is in `src/lib/editable-content.ts` (public + cached).
 * Write path is here — admin-gated, audit-logged, cache-invalidating.
 */

const KEY_RE = /^[a-z][a-z0-9._-]{2,99}$/;
const VALID_FORMATS = ["markdown", "plain"] as const;
type ContentFormat = typeof VALID_FORMATS[number];

export type SaveResult =
  | { ok: true; key: string }
  | { ok: false; error: string };

export async function saveContent(input: {
  key: string;
  content_md: string;
  format?: ContentFormat;
  label?: string | null;
}): Promise<SaveResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin only." };

  const key = input.key?.trim() ?? "";
  if (!KEY_RE.test(key)) {
    return { ok: false, error: "Invalid key. Use lowercase letters, digits, dots, hyphens, underscores. 3-100 chars." };
  }
  const content = input.content_md ?? "";
  if (content.length > 50_000) {
    return { ok: false, error: "Content too long (max 50,000 characters)." };
  }
  const format: ContentFormat = (input.format && VALID_FORMATS.includes(input.format))
    ? input.format
    : "markdown";
  const label = input.label?.trim().slice(0, 200) || null;

  const sb = await createClient();
  const { error } = await sb
    .from("editable_content")
    .upsert({
      key,
      content_md: content,
      format,
      label,
      updated_by: ctx.userId,
    }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };

  await recordAdminAction({
    action: "content_save",
    targetType: "user",
    targetId: ctx.userId,
    details: { key, format, label, length: content.length },
  });

  // Invalidate the cache so the new value is live within seconds
  // platform-wide (not the 60s default TTL).
  updateTag("editable-content");

  return { ok: true, key };
}

export type DeleteResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteContent(key: string): Promise<DeleteResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin only." };

  if (!KEY_RE.test(key)) {
    return { ok: false, error: "Invalid key." };
  }

  const sb = await createClient();
  const { error } = await sb.from("editable_content").delete().eq("key", key);
  if (error) return { ok: false, error: error.message };

  await recordAdminAction({
    action: "content_delete",
    targetType: "user",
    targetId: ctx.userId,
    details: { key },
  });

  updateTag("editable-content");
  return { ok: true };
}

export type ContentHistoryRow = {
  id: string;
  key: string;
  content_md: string;
  format: string;
  label: string | null;
  changed_by: string | null;
  changed_at: string;
};

/**
 * Fetch the recent edit history for one key. Used by the admin to
 * sanity-check "did I just break this?" and manually roll back.
 */
export async function getContentHistory(key: string, limit = 10): Promise<ContentHistoryRow[]> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return [];
  if (!KEY_RE.test(key)) return [];

  const sb = await createClient();
  const { data } = await sb
    .from("editable_content_history")
    .select("id, key, content_md, format, label, changed_by, changed_at")
    .eq("key", key)
    .order("changed_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ContentHistoryRow[];
}
