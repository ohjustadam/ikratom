"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateProfileInput, type ProfileInput } from "./validate";

/**
 * Save the caller's social profile (bio, story, interests, links) and every
 * section audience. Writes go through the user's own session: profile_social
 * and profile_links are own-row RLS (0283), so this can never touch anyone
 * else's row even if the input were forged.
 */
export async function saveProfileSocial(input: ProfileInput): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to edit your profile." };

  const v = validateProfileInput(input);
  if ("error" in v) return v;

  if (!(await checkRateLimit(`profile-save:${user.id}`, 30, 3600))) {
    return { error: "You've saved a lot in the last hour. Try again shortly." };
  }

  const { bio, story, interests, links, audiences } = v.value;
  const { error } = await supabase.from("profile_social").upsert(
    { user_id: user.id, bio, story, interests, ...audiences, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) return { error: "Could not save your profile. Please try again." };

  // Links: upsert by position, then drop any positions past the new list.
  if (links.length) {
    const { error: le } = await supabase.from("profile_links").upsert(
      links.map((l, position) => ({ user_id: user.id, position, label: l.label, url: l.url })),
      { onConflict: "user_id,position" },
    );
    if (le) return { error: "Your profile saved, but the links did not. Check them and save again." };
  }
  await supabase.from("profile_links").delete().eq("user_id", user.id).gte("position", links.length);

  revalidatePath("/account/profile");
  revalidatePath(`/profile/${user.id}`);
  return { ok: true };
}
