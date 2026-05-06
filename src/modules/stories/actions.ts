"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";

const VALID_TAGS = [
  "pain", "recovery", "mental_health", "energy", "medical_pro",
  "shop_owner", "family", "veteran", "other",
] as const;

export async function submitStory(input: {
  title: string;
  body: string;
  anonymous: boolean;
  displayName?: string;
  state?: string | null;
  tags: string[];
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to submit a story." };

  const title = input.title.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 10_000);
  if (!title || title.length < 8) return { error: "Title must be at least 8 characters." };
  if (!body || body.length < 80) return { error: "Story body must be at least 80 characters." };

  const tags = Array.isArray(input.tags)
    ? input.tags.filter((t) => (VALID_TAGS as readonly string[]).includes(t)).slice(0, 5)
    : [];

  const stateRaw = (input.state ?? "").trim().toUpperCase();
  const state = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null;

  let displayName: string | null = null;
  if (!input.anonymous) {
    if (input.displayName && input.displayName.trim()) {
      displayName = input.displayName.trim().slice(0, 80);
    } else {
      // Fall back to profile full_name
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single();
      displayName = (profile as { full_name: string | null } | null)?.full_name ?? null;
    }
  }

  const { error, data: row } = await supabase
    .from("kratom_stories")
    .insert({
      author_id: user.id,
      title,
      body,
      anonymous: input.anonymous,
      display_name: displayName,
      state,
      tags,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  return { ok: true, id: row.id };
}

export async function withdrawStory(storyId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("kratom_stories")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", storyId)
    .eq("author_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/stories");
  return { ok: true };
}

// ── Admin moderation ─────────────────────────────────────

export async function moderateStory(input: {
  storyId: string;
  decision: "approved" | "rejected";
  note?: string;
}) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Admin or leader only." };
  const supabase = await createClient();

  const update: Record<string, unknown> = {
    moderation_status: input.decision,
    moderation_note: input.note?.slice(0, 500) ?? null,
    approved_by: ctx.userId,
    approved_at: input.decision === "approved" ? new Date().toISOString() : null,
  };
  const { error } = await supabase
    .from("kratom_stories")
    .update(update)
    .eq("id", input.storyId);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: input.decision === "approved" ? "story_approved" : "story_rejected",
    targetType: "post",
    targetId: input.storyId,
    details: { note: input.note ?? null },
  });

  revalidatePath("/admin/stories");
  revalidatePath("/stories");
  return { ok: true };
}

export async function listPublicStories(input?: { state?: string; tag?: string; limit?: number }) {
  const supabase = await createClient();
  let q = supabase
    .from("kratom_stories")
    .select("id, title, body, anonymous, display_name, state, tags, upvote_count, created_at")
    .eq("moderation_status", "approved")
    .is("deleted_at", null);

  if (input?.state && /^[A-Z]{2}$/.test(input.state)) {
    q = q.eq("state", input.state);
  }
  if (input?.tag && (VALID_TAGS as readonly string[]).includes(input.tag)) {
    q = q.contains("tags", [input.tag]);
  }
  const { data } = await q
    .order("created_at", { ascending: false })
    .limit(input?.limit ?? 30);
  return data ?? [];
}

export async function listPendingStoriesForAdmin() {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("kratom_stories")
    .select("id, author_id, title, body, anonymous, display_name, state, tags, moderation_status, created_at")
    .eq("moderation_status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  return data ?? [];
}
