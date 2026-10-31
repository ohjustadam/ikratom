"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { rewordUseAdmissions } from "@/lib/use-admission";
import { getSafeMode } from "./safe-mode";

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
  /** 0 the first time; 1, 2… for each press after a success (a "reroll"). */
  take?: number;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to use personalization." };
  if (typeof input.campaignBody !== "string" || input.campaignBody.length > 8_000) {
    return { error: "That letter is too long to personalize. Trim it and try again." };
  }
  const take = Math.max(0, Math.min(20, Math.floor(Number(input.take) || 0)));

  // Rate-limit: 8 personalizations per hour per user
  const ok = await checkRateLimit(`ai-personalize:user:${user.id}`, 8, 3_600);
  if (!ok) return { error: "Slow down. 8 personalizations per hour limit. Try again in an hour." };

  // Pull the user's character fields
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, state, kratom_story, kratom_years, advocate_type, lose_if_banned, banned_state_safe_mode")
    .eq("id", user.id)
    .single();

  if (!profile) return { error: "Profile not found." };
  // Banned-state safe mode (0275): the letter must not say they use kratom now.
  const safeMode = await getSafeMode(supabase, profile.state, profile.banned_state_safe_mode);
  const banned = safeMode?.active ? safeMode.stateName : null;

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
    // Safe mode withholds the state: the model can't add "as a Louisiana
    // resident" if it never sees it (Paul, 10-27). The template's own place names stay.
    `  State: ${banned ? "(withheld for the member's safety)" : profile.state ?? "(not provided)"}`,
    banned
      ? `  Years used kratom before the ban: ${profile.kratom_years ?? "(not provided)"}`
      : `  Years using kratom: ${profile.kratom_years ?? "(not provided)"}`,
    `  Advocate type: ${profile.advocate_type ?? "(consumer)"}`,
    `  What's at stake if banned: ${(profile as { lose_if_banned?: string | null }).lose_if_banned ?? "(not provided)"}`,
    "",
    `User's kratom story (authentic voice source):`,
    "---",
    storyExcerpt(story, take),
    "---",
    "",
    // A reroll sends back the letter it already wrote, and at the router's low
    // temperature that came back word for word, so a reroll looked broken.
    ...(take > 0
      ? [
          "This letter has already been personalized once. Write a FRESH take: build it around a different",
          "detail from the story than the one already in it, and change the wording. Keep the same requests",
          "and every {{placeholder}}.",
          "",
        ]
      : []),
    ...(banned
      ? [
          `SAFETY: kratom is banned in ${banned}, where this user lives. Write about their kratom use ONLY in the`,
          "past tense, as life before the ban. Never say or imply they use, buy or have kratom now.",
          "Do NOT add where the user lives (no state, city or region), even if their story mentions it. Keep any",
          "place names already in the template exactly as they are.",
          "",
        ]
      : []),
    "Rewrite the template in this user's voice. Output the JSON now.",
  ].join("\n");

  // Try the AI router — falls back through providers as needed
  try {
    // Dynamic import — this is server-side anyway
    const { aiRouter } = await import("../../../scripts/lib/ai-router.mjs");
    // A web request can't wait out a throttled pool: the router's default
    // maxWaitMs (75 s) outlived the function, so the member saw "check your
    // connection" while a provider cooled down (Paul, 10-27). No waiting, a
    // reply budget that fits a letter (fewer Groq TPM 413s), and a hard deadline
    // inside the function limit.
    const r = await Promise.race([
      // tier "member": the Groq model kept for members. The background jobs spend
      // the main model's daily allowance by mid-morning (198,983 of 200,000 used
      // on 10-31), which is why Personalize failed for Paul nearly every time.
      // hedgeMs: a member is waiting, so a slow provider gets a second one racing it.
      // reasoningEffort "low": a rewrite needs little thinking, and gpt-oss's
      // thinking tokens share Groq's per-minute budget with the reply.
      aiRouter({
        systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 1200, maxWaitMs: 0, verbose: false,
        tier: "member", hedgeMs: 3_000, reasoningEffort: "low",
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("PERSONALIZE_TIMEOUT")), 9_000)),
    ]);
    const personalized = r.parsed?.personalized_body;
    const whatChanged = r.parsed?.what_changed;
    if (typeof personalized !== "string" || personalized.length < 100) {
      return { error: "The AI writer sent back an incomplete letter. Your letter is unchanged: tap Personalize again." };
    }
    return {
      ok: true,
      // Belt and braces: models don't always obey the tense instruction.
      personalized_body: banned ? rewordUseAdmissions(personalized) : personalized,
      what_changed: whatChanged ?? "Tailored to your voice.",
      provider: r.provider,
    };
  } catch (e) {
    // Whatever went wrong is a provider's problem, not the member's. The raw
    // error ("nvidia 404: Function … not found for account") told Paul nothing
    // he could act on, so it goes to the log and he gets the same plain answer.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[personalize] AI router failed:", msg.slice(0, 200));
    return { error: "The free AI writers are busy right now. Your letter is unchanged: try again in a minute, or add a line about yourself and send it." };
  }
}

/**
 * About 2,000 characters of the member's story, cut at a word. Stories run to
 * ~5,000 characters; with the template that was most of Groq's 8k-tokens-per-
 * minute budget, so a reroll inside the same minute was refused. ONE personal
 * detail is all the prompt asks for. The first take reads the opening; each
 * reroll reads a later stretch, so it has new material to draw on.
 */
const STORY_CHARS = 2_000;
function storyExcerpt(story: string, take = 0): string {
  if (story.length <= STORY_CHARS) return story;
  let from = take > 0 ? Math.round(((take * 0.45) % 1) * (story.length - STORY_CHARS)) : 0;
  const sentence = story.indexOf(". ", from);
  if (from > 0 && sentence !== -1 && sentence < from + 300) from = sentence + 2;
  const cut = story.slice(from, from + STORY_CHARS).replace(/\s+\S*$/, "");
  return (from > 0 ? "… " : "") + cut + (from + STORY_CHARS < story.length ? " …" : "");
}
