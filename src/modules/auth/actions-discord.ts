"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { recordAdminAction } from "@/lib/audit";

/**
 * Manage Discord account linkage. The actual OAuth flow lives in
 * /api/oauth/discord/{start,callback}; this is just for unlinking
 * + reading current state from server components.
 */

export type DiscordLink = {
  linked: boolean;
  username: string | null;
  avatar_url: string | null;
  linked_at: string | null;
};

export async function getDiscordLink(): Promise<DiscordLink> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { linked: false, username: null, avatar_url: null, linked_at: null };

  const { data } = await supabase
    .from("profiles")
    .select("discord_id, discord_username, discord_avatar_url, discord_linked_at")
    .eq("id", user.id)
    .single();
  return {
    linked: !!data?.discord_id,
    username: data?.discord_username ?? null,
    avatar_url: data?.discord_avatar_url ?? null,
    linked_at: data?.discord_linked_at ?? null,
  };
}

export async function unlinkDiscord() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };

  const { error } = await supabase
    .from("profiles")
    .update({
      discord_id: null,
      discord_username: null,
      discord_avatar_url: null,
      discord_linked_at: null,
    })
    .eq("id", user.id);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "user.discord_unlink",
    targetType: "user",
    targetId: user.id,
  });
  revalidatePath("/account");
  return { ok: true };
}
