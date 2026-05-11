"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getPresignedUploadUrl, isR2Configured } from "@/lib/r2";

const ALLOWED_MIME = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Server action that mints a presigned R2 PUT URL for an advocacy
 * video clip. Client sends the file's content-type + byte size; we
 * validate, rate-limit (3 uploads/hour/user), and return the URL pair.
 *
 * Critical: client cannot pick the key — we mint one keyed on the
 * actor's user_id. That way an attacker can't overwrite another user's
 * clip and abuse is traceable.
 */
export async function requestVideoUpload(input: {
  contentType: string;
  sizeBytes: number;
}): Promise<
  | { ok: true; uploadUrl: string; publicUrl: string; expiresIn: number }
  | { error: string }
> {
  if (!isR2Configured()) {
    return { error: "Video upload isn't enabled on this server. Paste a YouTube or Vimeo URL instead." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to upload." };

  if (!ALLOWED_MIME.has(input.contentType)) {
    return { error: "Only MP4, MOV, or WebM video files are accepted." };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { error: "Invalid file size." };
  }
  if (input.sizeBytes > MAX_BYTES) {
    return { error: `File is too large. Max ${Math.round(MAX_BYTES / 1024 / 1024)} MB.` };
  }

  if (!(await checkRateLimit(`video-upload:${user.id}`, 3, 3600))) {
    return { error: "You've uploaded a few videos already. Try again in an hour." };
  }

  // Build the key. Random suffix so a re-upload doesn't clobber the
  // previous file — leaves the old object orphaned but that's fine
  // (storage is cheap and we'll add a janitor later if needed).
  const ext =
    input.contentType === "video/mp4" ? "mp4"
    : input.contentType === "video/quicktime" ? "mov"
    : "webm";
  const randomId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const key = `videos/${user.id}/${Date.now()}-${randomId}.${ext}`;

  const presigned = await getPresignedUploadUrl({
    key,
    contentType: input.contentType,
    expiresInSeconds: 600,
  });

  return {
    ok: true,
    uploadUrl: presigned.uploadUrl,
    publicUrl: presigned.publicUrl,
    expiresIn: presigned.expiresIn,
  };
}

/**
 * Persist a successfully-uploaded video URL onto the user's profile.
 * Called by the client after the PUT to R2 succeeds. We re-validate
 * that the URL points at our configured R2 public base so a malicious
 * caller can't stamp arbitrary URLs.
 */
export async function setProfileVideoUrl(input: {
  publicUrl: string;
}): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to save." };

  const base = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) return { error: "Video uploads aren't enabled." };
  // Must start with our public base AND mention the user's id in the
  // path. Cheap defense against someone POSTing a foreign R2 URL.
  if (!input.publicUrl.startsWith(`${base}/videos/${user.id}/`)) {
    return { error: "URL did not come from this server's upload flow." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ video_url: input.publicUrl, video_provider: "r2" })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/account/character");
  revalidatePath(`/profile/${user.id}`);
  return { ok: true };
}

/**
 * Expose to the client whether R2 is configured so the UI can show or
 * hide the upload tab. No secrets leak — just a boolean.
 */
export async function getVideoUploadEnabled(): Promise<boolean> {
  return isR2Configured();
}
