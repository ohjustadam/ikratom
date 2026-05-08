"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";

/**
 * Topical communities (Veterans, Shop owners, etc.) — admin-only CRUD.
 * Public read goes through listActiveCommunities; admin-only read uses
 * listAllCommunities (includes archived).
 *
 * Why server actions and not REST endpoints: every mutation needs the
 * admin guard + audit log + cache revalidation. Bundling that in one
 * place keeps drift impossible.
 */

const SLUG_RX = /^[a-z0-9-]{2,40}$/;

export type Community = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function listActiveCommunities(): Promise<Community[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("forum_communities")
    .select("id, slug, name, description, icon, sort_order, is_active, created_at, updated_at")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as Community[];
}

export async function listAllCommunities(): Promise<{ ok: true; rows: Community[] } | { error: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("forum_communities")
    .select("id, slug, name, description, icon, sort_order, is_active, created_at, updated_at")
    .order("is_active", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return { error: error.message };
  return { ok: true, rows: (data ?? []) as Community[] };
}

export async function getCommunityBySlug(slug: string): Promise<Community | null> {
  if (!SLUG_RX.test(slug)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("forum_communities")
    .select("id, slug, name, description, icon, sort_order, is_active, created_at, updated_at")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();
  return (data as Community) ?? null;
}

function validateInput(input: {
  slug?: string;
  name?: string;
  description?: string | null;
  icon?: string | null;
  sort_order?: number;
}): string | null {
  if (input.slug !== undefined) {
    if (typeof input.slug !== "string" || !SLUG_RX.test(input.slug)) {
      return "Slug: 2-40 chars, lowercase letters/digits/hyphens only.";
    }
  }
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.length < 2 || input.name.length > 60) {
      return "Name: 2-60 chars.";
    }
  }
  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== "string" || input.description.length > 500) {
      return "Description: 500 chars max.";
    }
  }
  if (input.icon !== undefined && input.icon !== null) {
    if (typeof input.icon !== "string" || input.icon.length > 8) {
      return "Icon: short string only (one emoji recommended).";
    }
  }
  if (input.sort_order !== undefined) {
    if (!Number.isFinite(input.sort_order) || input.sort_order < 0 || input.sort_order > 10000) {
      return "Sort order: 0-10000.";
    }
  }
  return null;
}

export async function createCommunity(input: {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  sort_order?: number;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };

  const err = validateInput(input);
  if (err) return { error: err };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("forum_communities")
    .insert({
      slug: input.slug,
      name: input.name,
      description: input.description?.trim() || null,
      icon: input.icon?.trim() || null,
      sort_order: input.sort_order ?? 100,
      is_active: true,
      created_by: ctx.userId,
    })
    .select("id, slug")
    .single();

  if (error) {
    // 23505 unique violation — give a clean message instead of the raw
    // Postgres "duplicate key value violates unique constraint" string.
    if (error.code === "23505") return { error: "Slug already taken." };
    return { error: error.message };
  }

  await recordAdminAction({
    action: "forum_community.create",
    targetType: "forum_community",
    targetId: data.id,
    details: { slug: data.slug, name: input.name },
  });
  revalidatePath("/admin/communities");
  revalidatePath("/forum");
  return { ok: true, id: data.id };
}

export async function updateCommunity(input: {
  id: string;
  slug?: string;
  name?: string;
  description?: string | null;
  icon?: string | null;
  sort_order?: number;
  is_active?: boolean;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  if (!input.id) return { error: "Missing id." };

  const err = validateInput(input);
  if (err) return { error: err };

  const patch: Record<string, unknown> = {};
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description?.toString().trim() || null;
  if (input.icon !== undefined) patch.icon = input.icon?.toString().trim() || null;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.from("forum_communities").update(patch).eq("id", input.id);
  if (error) {
    if (error.code === "23505") return { error: "Slug already taken." };
    return { error: error.message };
  }

  await recordAdminAction({
    action: "forum_community.update",
    targetType: "forum_community",
    targetId: input.id,
    details: patch,
  });
  revalidatePath("/admin/communities");
  revalidatePath("/forum");
  if (typeof patch.slug === "string") revalidatePath(`/forum/c/${patch.slug}`);
  return { ok: true };
}

/**
 * Soft delete — flips is_active=false. We keep the row so existing
 * forum_threads.community_id references stay intact (the slug just
 * stops resolving to a public page). Hard delete is intentionally
 * NOT exposed to admins; rebuild via the same slug if needed.
 */
export async function archiveCommunity(input: { id: string }) {
  return updateCommunity({ id: input.id, is_active: false });
}

export async function unarchiveCommunity(input: { id: string }) {
  return updateCommunity({ id: input.id, is_active: true });
}
