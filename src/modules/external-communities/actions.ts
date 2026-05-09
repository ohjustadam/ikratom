"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import type { ExtCategory } from "./labels";
import { CATEGORIES as VALID_CATEGORIES } from "./labels";

/**
 * CRUD for the third-party communities listed on /communities
 * (Facebook / Reddit / Discord / Podcasts / etc.). Distinct from
 * forum_communities (internal iKratom topical forums).
 *
 * All mutations require admin. Public readers see only active rows
 * via RLS.
 *
 * Pure-data exports (CATEGORY_LABELS, CATEGORIES, type ExtCategory)
 * live in ./labels — Next.js forbids non-function exports from
 * "use server" files.
 */

export type ExternalCommunity = {
  id: string;
  category: ExtCategory;
  name: string;
  href: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function validate(input: {
  category?: string;
  name?: string;
  href?: string;
  description?: string | null;
  sort_order?: number;
}): string | null {
  if (input.category !== undefined && !(VALID_CATEGORIES as string[]).includes(input.category)) {
    return `Category must be one of: ${VALID_CATEGORIES.join(", ")}`;
  }
  if (input.name !== undefined) {
    const n = String(input.name).trim();
    if (n.length < 2 || n.length > 100) return "Name: 2-100 chars.";
  }
  if (input.href !== undefined) {
    const h = String(input.href).trim();
    if (!/^https?:\/\//i.test(h)) return "URL must start with http:// or https://";
    if (h.length > 500) return "URL: 500 chars max.";
  }
  if (input.description !== undefined && input.description !== null) {
    if (String(input.description).length > 500) return "Description: 500 chars max.";
  }
  if (input.sort_order !== undefined) {
    if (!Number.isFinite(input.sort_order) || input.sort_order < 0 || input.sort_order > 10000) {
      return "Sort order: 0-10000.";
    }
  }
  return null;
}

// ── Public read ─────────────────────────────────────────────

export async function listActiveExternalCommunities(): Promise<ExternalCommunity[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("external_communities")
    .select("id, category, name, href, description, sort_order, is_active, created_at, updated_at")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as ExternalCommunity[];
}

// ── Admin read (includes archived) ──────────────────────────

export async function listAllExternalCommunities(): Promise<
  { ok: true; rows: ExternalCommunity[] } | { error: string }
> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("external_communities")
    .select("id, category, name, href, description, sort_order, is_active, created_at, updated_at")
    .order("is_active", { ascending: false })
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return { error: error.message };
  return { ok: true, rows: (data ?? []) as ExternalCommunity[] };
}

// ── Admin mutations ─────────────────────────────────────────

export async function createExternalCommunity(input: {
  category: ExtCategory;
  name: string;
  href: string;
  description?: string;
  sort_order?: number;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  const err = validate(input);
  if (err) return { error: err };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("external_communities")
    .insert({
      category: input.category,
      name: input.name.trim(),
      href: input.href.trim(),
      description: input.description?.trim() || null,
      sort_order: input.sort_order ?? 100,
      is_active: true,
      created_by: ctx.userId,
    })
    .select("id, name")
    .single();
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "external_community.create",
    targetType: "external_community",
    targetId: data.id,
    details: { category: input.category, name: data.name, href: input.href },
  });
  revalidatePath("/admin/external-communities");
  revalidatePath("/communities");
  return { ok: true, id: data.id };
}

export async function updateExternalCommunity(input: {
  id: string;
  category?: ExtCategory;
  name?: string;
  href?: string;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  if (!input.id) return { error: "Missing id." };
  const err = validate(input);
  if (err) return { error: err };

  const patch: Record<string, unknown> = {};
  if (input.category !== undefined) patch.category = input.category;
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.href !== undefined) patch.href = input.href.trim();
  if (input.description !== undefined) patch.description = input.description?.toString().trim() || null;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("external_communities")
    .update(patch)
    .eq("id", input.id);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "external_community.update",
    targetType: "external_community",
    targetId: input.id,
    details: patch,
  });
  revalidatePath("/admin/external-communities");
  revalidatePath("/communities");
  return { ok: true };
}

export async function archiveExternalCommunity(input: { id: string }) {
  return updateExternalCommunity({ id: input.id, is_active: false });
}

export async function unarchiveExternalCommunity(input: { id: string }) {
  return updateExternalCommunity({ id: input.id, is_active: true });
}

/**
 * Permanent delete. Unlike forum_communities (which has FK refs from
 * forum_threads), external_communities has nothing depending on it,
 * so a hard delete is safe with no orphan-handling.
 */
export async function deleteExternalCommunity(input: {
  id: string;
  confirmName: string;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  const supabase = await createClient();

  const { data: existing, error: readErr } = await supabase
    .from("external_communities")
    .select("id, category, name, href, is_active")
    .eq("id", input.id)
    .single();
  if (readErr || !existing) return { error: "Not found." };

  if (input.confirmName !== existing.name) {
    return { error: `Confirmation didn't match (expected "${existing.name}").` };
  }

  const { error: delErr } = await supabase
    .from("external_communities")
    .delete()
    .eq("id", input.id);
  if (delErr) return { error: delErr.message };

  await recordAdminAction({
    action: "external_community.delete",
    targetType: "external_community",
    targetId: input.id,
    details: {
      category: existing.category,
      name: existing.name,
      href: existing.href,
      was_active: existing.is_active,
    },
  });
  revalidatePath("/admin/external-communities");
  revalidatePath("/communities");
  return { ok: true };
}
