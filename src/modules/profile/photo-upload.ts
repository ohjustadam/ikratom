import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { stripImageMetadata } from "@/lib/image-strip";
import { deleteMemberPhoto, putMemberPhoto } from "@/lib/media-store";
import { isAudience, type Audience } from "./audience";

/**
 * Store one member photo: strip metadata → R2 → index row → avatar/cover
 * pointer. Called by POST /api/media/upload after auth, origin and rate-limit
 * checks. Row writes use the service role on purpose: members have no INSERT
 * on member_photos and no privilege on the avatar/cover pointers (0286), so a
 * forged request can never index someone else's object or adopt their photo.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_ALBUM_PHOTOS = 60;
export type PhotoKind = "avatar" | "cover" | "album";

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const AUDIENCE_KEYS = ["profile_audience", "bio_audience", "story_audience", "links_audience", "interests_audience",
  "photos_default_audience", "friends_audience", "activity_audience"] as const;

export async function storeMemberPhoto(input: {
  userClient: SupabaseClient;
  userId: string;
  kind: PhotoKind;
  bytes: Uint8Array;
  caption: string | null;
  audience: string | null;
}): Promise<{ ok: true; id: string } | { error: string; status: number }> {
  const stripped = stripImageMetadata(input.bytes);
  if (!stripped.ok) return { error: stripped.reason, status: 400 };

  // The caller's settings, with the safe defaults applied (0285).
  const { data: mineRows } = await input.userClient.rpc("get_my_profile_social");
  const mine = ((mineRows ?? []) as Record<string, unknown>[])[0] ?? {};
  const fallback: Audience = input.kind === "album" && isAudience(mine.photos_default_audience) ? mine.photos_default_audience : input.kind === "album" ? "friends" : "members";
  const audience: Audience = isAudience(input.audience) ? input.audience : fallback;

  const svc = createServiceRoleClient();
  if (input.kind === "album") {
    const { count } = await svc.from("member_photos").select("id", { count: "exact", head: true })
      .eq("owner_id", input.userId).eq("kind", "album");
    if ((count ?? 0) >= MAX_ALBUM_PHOTOS) return { error: `Your album is full (${MAX_ALBUM_PHOTOS} photos). Delete one to add another.`, status: 400 };
  }

  const id = crypto.randomUUID();
  const key = `photos/${input.userId}/${id}.${EXT[stripped.contentType]}`;
  try {
    await putMemberPhoto(key, stripped.bytes, stripped.contentType);
  } catch {
    return { error: "Photo storage is unavailable right now. Please try again.", status: 503 };
  }
  const { error } = await svc.from("member_photos").insert({
    id, owner_id: input.userId, kind: input.kind, r2_key: key, content_type: stripped.contentType,
    bytes: stripped.bytes.length, width: stripped.width, height: stripped.height, caption: input.caption, audience,
  });
  if (error) {
    await deleteMemberPhoto(key);
    return { error: "Could not save the photo. Please try again.", status: 500 };
  }

  if (input.kind !== "album") await pointAt(svc, input.userId, input.kind, id, mine);
  return { ok: true, id };
}

/** Point the avatar/cover at the new photo and delete the one it replaces. */
async function pointAt(svc: SupabaseClient, userId: string, kind: "avatar" | "cover", id: string, mine: Record<string, unknown>) {
  const col = kind === "avatar" ? "avatar_photo_id" : "cover_photo_id";
  const { data: row } = await svc.from("profile_social").select("avatar_photo_id, cover_photo_id").eq("user_id", userId).maybeSingle();
  const previous = (row as Record<string, string | null> | null)?.[col] ?? null;
  if (row) {
    await svc.from("profile_social").update({ [col]: id }).eq("user_id", userId);
  } else {
    // First row: carry the member's effective audiences so nothing widens.
    const seed: Record<string, unknown> = { user_id: userId, [col]: id };
    for (const k of AUDIENCE_KEYS) if (isAudience(mine[k])) seed[k] = mine[k];
    await svc.from("profile_social").insert(seed);
  }
  if (kind === "avatar") await svc.from("profiles").update({ avatar_url: `/api/media/${id}` }).eq("id", userId);
  if (previous && previous !== id) await deletePhotoRow(svc, userId, previous);
}

/** Delete a photo row (owner-checked) and its R2 object; clear the avatar cache. */
export async function deletePhotoRow(svc: SupabaseClient, ownerId: string, photoId: string): Promise<boolean> {
  const { data } = await svc.from("member_photos").select("r2_key, owner_id").eq("id", photoId).maybeSingle();
  const row = data as { r2_key: string; owner_id: string } | null;
  if (!row || row.owner_id !== ownerId) return false;
  const { error } = await svc.from("member_photos").delete().eq("id", photoId);
  if (error) return false;
  await svc.from("profiles").update({ avatar_url: null }).eq("id", ownerId).eq("avatar_url", `/api/media/${photoId}`);
  await deleteMemberPhoto(row.r2_key);
  return true;
}
