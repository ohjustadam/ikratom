"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateProfileInput, type ProfileInput } from "./validate";
import { SECTION_AUDIENCES, isAudience, type Audience, type SectionAudienceKey } from "./audience";

const DISCOVERABILITY = ["public", "recruiters_only", "private"] as const;

/**
 * Save the caller's social profile (bio, story, interests, links) and every
 * section audience. Writes go through the user's own session: profile_social
 * and profile_links are own-row RLS (0285), so this can never touch anyone
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

/**
 * /account/privacy: every section audience, plus the legacy discoverability
 * switch (profiles.profile_visibility — whether your @handle shows on your
 * posts and in member search). Leaves bio/story/interests untouched.
 */
export async function savePrivacySettings(input: {
  audiences: Partial<Record<SectionAudienceKey, string>>;
  discoverability: string;
}): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };
  if (!DISCOVERABILITY.includes(input.discoverability as (typeof DISCOVERABILITY)[number])) return { error: "Invalid choice." };
  const audiences: Partial<Record<SectionAudienceKey, Audience>> = {};
  for (const { key } of SECTION_AUDIENCES) {
    const v = input.audiences[key];
    if (!isAudience(v)) return { error: "Invalid privacy level." };
    audiences[key] = v;
  }
  if (!(await checkRateLimit(`profile-save:${user.id}`, 30, 3600))) {
    return { error: "You've saved a lot in the last hour. Try again shortly." };
  }

  const { error } = await supabase.from("profile_social").upsert(
    { user_id: user.id, ...audiences, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) return { error: "Could not save your privacy settings." };
  const { error: pe } = await supabase.from("profiles").update({ profile_visibility: input.discoverability }).eq("id", user.id);
  if (pe) return { error: "Your section settings saved, but discoverability did not. Try again." };

  revalidatePath("/account/privacy");
  revalidatePath("/account/profile");
  revalidatePath(`/profile/${user.id}`);
  return { ok: true };
}
