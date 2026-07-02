"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Persist a recording's metadata after the client uploaded the binary
 * to Supabase Storage. Returns the public URL the campaign email body
 * can include.
 */
export async function recordAttachmentMetadata(input: {
  kind: "audio" | "video";
  storagePath: string;
  durationSeconds?: number;
  sizeBytes?: number;
  transcript?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  if (!["audio", "video"].includes(input.kind)) return { error: "Invalid kind." };
  if (!input.storagePath || !input.storagePath.startsWith(`${user.id}/`)) {
    return { error: "Storage path must be in your folder." };
  }

  // Rate-limit metadata writes (the insert isn't tied to a verified upload, so
  // it's otherwise an unbounded self-scoped row-insert loop). Mirrors recordShare.
  if (!(await checkRateLimit(`attach:meta:user:${user.id}`, 30, 3600))) {
    return { error: "Too many attachments — slow down a moment." };
  }

  const { data: row, error } = await supabase
    .from("campaign_attachments")
    .insert({
      user_id: user.id,
      kind: input.kind,
      storage_path: input.storagePath,
      duration_seconds: input.durationSeconds && input.durationSeconds > 0
        ? Math.min(600, Math.floor(input.durationSeconds))
        : null,
      size_bytes: input.sizeBytes && input.sizeBytes > 0
        ? Math.min(100 * 1024 * 1024, Math.floor(input.sizeBytes))
        : null,
      transcript: input.transcript ? input.transcript.slice(0, 10000) : null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // Build public URL — bucket is public, the path is unguessable
  const { data: publicData } = supabase.storage
    .from("campaign-attachments")
    .getPublicUrl(input.storagePath);

  return {
    ok: true,
    id: row.id,
    publicUrl: publicData.publicUrl,
  };
}

export async function withdrawAttachment(attachmentId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: att } = await supabase
    .from("campaign_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .eq("user_id", user.id)
    .single();
  if (!att) return { error: "Not found." };

  // Soft-delete the metadata row + remove the file from storage
  const path = (att as { storage_path: string }).storage_path;
  await supabase.storage.from("campaign-attachments").remove([path]);
  const { error } = await supabase
    .from("campaign_attachments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", attachmentId);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function recordShare(input: {
  platform: "facebook" | "x" | "reddit" | "sms" | "threads" | "copy_link";
  campaignId?: string;
  billId?: string;
  storyId?: string;
}) {
  const valid = ["facebook", "x", "reddit", "sms", "threads", "copy_link"];
  if (!valid.includes(input.platform)) return { error: "Invalid platform." };
  const targets = [input.campaignId, input.billId, input.storyId].filter(Boolean);
  if (targets.length !== 1) return { error: "Pick exactly one target." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Anon shares are allowed (we count them), but the INSERT RLS is open
  // (check(true)), so rate-limit per-user + per-IP to stop a bot flooding
  // campaign_shares with millions of rows.
  const rlKey = user ? `share:user:${user.id}` : `share:ip:${await getClientIp()}`;
  if (!(await checkRateLimit(rlKey, 30, 60))) {
    return { error: "Too many shares — slow down a moment." };
  }
  const { error } = await supabase.from("campaign_shares").insert({
    user_id: user?.id ?? null,
    platform: input.platform,
    campaign_id: input.campaignId ?? null,
    bill_id: input.billId ?? null,
    story_id: input.storyId ?? null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}
