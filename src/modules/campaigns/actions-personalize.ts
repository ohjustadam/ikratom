"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * AI personalization for campaign emails.
 *
 * Takes the campaign body template + the user's character fields
 * (kratom_story, kratom_years, advocate_type, lose_if_banned from
 * /account/character) and rewrites the body in the user's authentic
 * voice. Returns the personalized text for the user to review +
 * edit before sending — never auto-sends.
 *
 * Privacy: the user's story is sent to the AI provider in-flight
 * but never stored on the AI side. We strip address + ZIP from the
 * prompt (only state stays, which is needed for narrative weight).
 *
 * Rate-limited 8/hour per user to keep costs predictable.
 *
 * Uses the multi-provider router so Mistral / Cloudflare / Groq /
 * Gemini share the load with cooldown handling. Falls back to
 * returning the original template if all providers fail.
 */

const SYSTEM_PROMPT = `You rewrite advocacy emails to sound like the real person sending them.

Input:
  - A template email about kratom legislation
  - The user's profile: kratom story (long-form), years using, advocate type, what's at stake for them

Your job:
  1. Keep the substantive policy arguments (KCPA framework, distinction between natural-leaf and 7-OH, etc.) intact
  2. Replace generic phrases with the user's authentic voice from their story
  3. Add ONE specific personal detail near the top — something only this person would say
  4. Keep length similar to original (do not bloat)
  5. Preserve template placeholders ({{recipient_title}}, {{recipient_last_name}}, etc.) as-is
  6. Match the user's tone — if their story is clinical, stay clinical; if heartfelt, stay heartfelt
  7. NEVER fabricate facts. Only use what the user wrote.
  8. NEVER mention you're an AI or that this is rewritten

Output STRICT JSON:
{
  "personalized_body": "the rewritten email body",
  "what_changed": "one sentence about what you tailored"
}`;

export async function personalizeCampaignBody(input: {
  campaignBody: string;
  campaignTitle: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to use personalization." };

  // Rate-limit: 8 personalizations per hour per user
  const ok = await checkRateLimit(`ai-personalize:user:${user.id}`, 8, 3_600);
  if (!ok) return { error: "Slow down. 8 personalizations per hour limit. Try again in an hour." };

  // Pull the user's character fields
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, state, kratom_story, kratom_years, advocate_type, lose_if_banned")
    .eq("id", user.id)
    .single();

  if (!profile) return { error: "Profile not found." };

  const story = (profile as { kratom_story?: string | null }).kratom_story ?? "";
  if (!story.trim() || story.length < 80) {
    return {
      error: "Add your kratom story on /account/character first (at least 80 characters). " +
        "Personalization needs your authentic voice as source material.",
    };
  }

  // Build the user prompt — note we DO NOT send street address, city, zip, phone, or any
  // address-component. State stays because it gives the email narrative weight ('from Toledo, OH').
  const userPrompt = [
    `Campaign title: ${input.campaignTitle}`,
    "",
    `Template email body:`,
    "---",
    input.campaignBody,
    "---",
    "",
    `User's profile:`,
    `  Name: ${profile.full_name ?? "(not provided)"}`,
    `  State: ${profile.state ?? "(not provided)"}`,
    `  Years using kratom: ${profile.kratom_years ?? "(not provided)"}`,
    `  Advocate type: ${profile.advocate_type ?? "(consumer)"}`,
    `  What's at stake if banned: ${(profile as { lose_if_banned?: string | null }).lose_if_banned ?? "(not provided)"}`,
    "",
    `User's kratom story (authentic voice source):`,
    "---",
    story,
    "---",
    "",
    "Rewrite the template in this user's voice. Output the JSON now.",
  ].join("\n");

  // Try the AI router — falls back through providers as needed
  try {
    // Dynamic import — this is server-side anyway
    const { aiRouter } = await import("../../../scripts/lib/ai-router.mjs");
    const r = await aiRouter({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 2048,
      verbose: false,
    });
    const personalized = r.parsed?.personalized_body;
    const whatChanged = r.parsed?.what_changed;
    if (typeof personalized !== "string" || personalized.length < 100) {
      return { error: "Personalization returned an empty or too-short result. Try again." };
    }
    return {
      ok: true,
      personalized_body: personalized,
      what_changed: whatChanged ?? "Tailored to your voice.",
      provider: r.provider,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Personalization failed: ${msg.slice(0, 200)}. Try again or send the template as-is.` };
  }
}
