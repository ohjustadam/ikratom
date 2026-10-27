"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { checkRateLimit } from "@/lib/rate-limit";
import { detectModerationSignals } from "@/lib/moderation";
import { isAudience } from "@/modules/profile/audience";
import { deletePhotoRow } from "@/modules/profile/photo-upload";
import { COMMENT_MAX, POST_MAX, type WallComment } from "./types";

/**
 * The profile wall (migration 0292). Every rule lives in the database:
 * create_wall_post refuses (null) when you may not post on that wall, and the
 * reads only return what the viewer may see. These actions add the hourly rate
 * limits and refuse phone numbers and emails in text other members read.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result = { ok: true } | { error: string };

async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

function contactInfo(text: string): string | null {
  const s = detectModerationSignals(text);
  return s.phones.length || s.emails.length ? "Remove phone numbers and email addresses before posting." : null;
}

export async function createWallPost(input: { ownerId: string; body: string; photoId?: string | null; audience?: string | null }): Promise<Result> {
  const body = (input.body ?? "").trim();
  if (!UUID_RE.test(input.ownerId)) return { error: "Unknown wall." };
  if (!body || body.length > POST_MAX) return { error: `Write something (up to ${POST_MAX} characters).` };
  if (input.photoId && !UUID_RE.test(input.photoId)) return { error: "That photo didn't upload." };
  if (input.audience && !isAudience(input.audience)) return { error: "Invalid audience." };
  const bad = contactInfo(body);
  if (bad) return { error: bad };
  const { supabase, user } = await me();
  if (!user) return { error: "Sign in to post." };
  if (!(await checkRateLimit(`wall-post:${user.id}`, 20, 3600))) return { error: "You've posted a lot this hour. Try again later." };
  const { data, error } = await supabase.rpc("create_wall_post", {
    p_owner: input.ownerId,
    p_body: body,
    p_photo: input.photoId ?? null,
    p_audience: input.ownerId === user.id ? input.audience ?? null : null,
  });
  if (error || !data) return { error: "You can't post on this wall." };
  revalidatePath(`/profile/${input.ownerId}`);
  return { ok: true };
}

export async function deleteWallPost(postId: string, ownerId: string): Promise<Result> {
  if (!UUID_RE.test(postId) || !UUID_RE.test(ownerId)) return { error: "Unknown post." };
  const { supabase, user } = await me();
  if (!user) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("delete_wall_post", { p_id: postId });
  const rows = (data ?? []) as { photo_id: string | null; photo_owner: string | null }[];
  if (error || rows.length === 0) return { error: "You can't delete that post." };
  // The RPC already stopped serving the photo; drop its R2 object and row too.
  const { photo_id, photo_owner } = rows[0];
  if (photo_id && photo_owner) await deletePhotoRow(createServiceRoleClient(), photo_owner, photo_id);
  revalidatePath(`/profile/${ownerId}`);
  return { ok: true };
}

export async function loadWallComments(postId: string): Promise<WallComment[]> {
  if (!UUID_RE.test(postId)) return [];
  const { supabase } = await me();
  const { data } = await supabase.rpc("get_wall_comments", { p_post: postId });
  return (data ?? []) as WallComment[];
}

export async function createWallComment(postId: string, text: string): Promise<{ ok: true; comments: WallComment[] } | { error: string }> {
  const body = (text ?? "").trim();
  if (!UUID_RE.test(postId)) return { error: "Unknown post." };
  if (!body || body.length > COMMENT_MAX) return { error: `Write a comment (up to ${COMMENT_MAX} characters).` };
  const bad = contactInfo(body);
  if (bad) return { error: bad };
  const { supabase, user } = await me();
  if (!user) return { error: "Sign in to comment." };
  if (!(await checkRateLimit(`wall-comment:${user.id}`, 60, 3600))) return { error: "You've commented a lot this hour. Try again later." };
  const { data, error } = await supabase.rpc("create_wall_comment", { p_post: postId, p_body: body });
  if (error || !data) return { error: "You can't comment on this post." };
  return { ok: true, comments: await loadWallComments(postId) };
}

export async function deleteWallComment(commentId: string): Promise<Result> {
  if (!UUID_RE.test(commentId)) return { error: "Unknown comment." };
  const { supabase, user } = await me();
  if (!user) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("delete_wall_comment", { p_id: commentId });
  if (error || data !== true) return { error: "You can't delete that comment." };
  return { ok: true };
}
