"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Server actions for the "character" profile fields — the optional
 * data we ask for during onboarding (or anytime via /account/character)
 * that powers AI tailoring + narrative weight on legislator emails.
 *
 * Stored in profiles via migration 0075:
 *   kratom_story        — long-form, used as authentic-voice source
 *                         when AI personalize fires on a campaign
 *   kratom_years        — surfaced in legislator letters
 *   advocate_type       — community filter + default template tone
 *   lose_if_banned      — campaign filler ("what's at stake")
 *   video_url           — YouTube / Vimeo / R2 URL (optional)
 *   video_provider      — auto-detected from URL host
 *   profile_visibility  — public / recruiters_only / private
 */

const VALID_TYPES = [
  "consumer", "shop_owner", "medical_pro", "family",
  "veteran", "researcher", "leader", "other",
] as const;
type AdvocateType = typeof VALID_TYPES[number];

const VALID_VISIBILITY = ["public", "recruiters_only", "private"] as const;
type Visibility = typeof VALID_VISIBILITY[number];

function detectVideoProvider(
  url: string
): "youtube" | "vimeo" | "r2" | "other" | null {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h.includes("youtube.com") || h.includes("youtu.be")) return "youtube";
    if (h.includes("vimeo.com")) return "vimeo";
    // R2 public URLs land on either pub-*.r2.dev or our configured custom
    // domain. Treat anything that matches our configured public base as
    // "r2" so the embed shape stays correct after re-saving the form.
    const r2Base = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
    if (r2Base && url.startsWith(`${r2Base}/`)) return "r2";
    return "other";
  } catch {
    return null;
  }
}

export async function updateProfileCharacter(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const story = ((formData.get("kratom_story") as string) ?? "").trim();
  const yearsStr = ((formData.get("kratom_years") as string) ?? "").trim();
  const advocateType = ((formData.get("advocate_type") as string) ?? "").trim();
  const loseIfBanned = ((formData.get("lose_if_banned") as string) ?? "").trim();
  const videoUrlRaw = ((formData.get("video_url") as string) ?? "").trim();
  const visibility = ((formData.get("profile_visibility") as string) ?? "public").trim();

  // Validate
  if (story.length > 10_000) return { error: "Story must be 10,000 characters or less." };
  if (loseIfBanned.length > 500) return { error: "What's at stake must be 500 characters or less." };

  let years: number | null = null;
  if (yearsStr) {
    const n = parseInt(yearsStr, 10);
    if (!Number.isFinite(n) || n < 0 || n > 80) return { error: "Years using kratom must be 0-80." };
    years = n;
  }

  let type: AdvocateType | null = null;
  if (advocateType) {
    if (!(VALID_TYPES as readonly string[]).includes(advocateType)) {
      return { error: "Invalid advocate type." };
    }
    type = advocateType as AdvocateType;
  }

  let visibilityValue: Visibility = "public";
  if (visibility) {
    if (!(VALID_VISIBILITY as readonly string[]).includes(visibility)) {
      return { error: "Invalid visibility." };
    }
    visibilityValue = visibility as Visibility;
  }

  let videoUrl: string | null = null;
  let videoProvider: "youtube" | "vimeo" | "r2" | "other" | null = null;
  if (videoUrlRaw) {
    if (videoUrlRaw.length > 500) return { error: "Video URL must be 500 characters or less." };
    if (!/^https?:\/\//i.test(videoUrlRaw)) return { error: "Video URL must start with http:// or https://" };
    videoUrl = videoUrlRaw;
    videoProvider = detectVideoProvider(videoUrlRaw);
    if (!videoProvider) return { error: "Could not parse video URL." };
  }

  const update: Record<string, unknown> = {
    kratom_story: story.length > 0 ? story : null,
    kratom_years: years,
    advocate_type: type,
    lose_if_banned: loseIfBanned.length > 0 ? loseIfBanned : null,
    video_url: videoUrl,
    video_provider: videoProvider,
    profile_visibility: visibilityValue,
  };

  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/account");
  revalidatePath("/account/character");
  revalidatePath(`/profile/${user.id}`);
  return { ok: true };
}
