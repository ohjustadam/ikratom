/**
 * Server helper to fetch translated content from content_translations.
 *
 * Returns null on miss — callers fall back to source. Cache is populated
 * by `npm run translate:content`. No Ollama on the request path
 * (Vercel can't reach local Ollama).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type TranslatedContentRef = {
  type: "bill_summary" | "bill_callout" | "story_body" | "thread_title";
  id: string;
};

export async function getTranslation(
  supabase: SupabaseClient,
  content: TranslatedContentRef,
  targetLang: string,
): Promise<string | null> {
  if (targetLang === "en" || !targetLang) return null;
  const { data } = await supabase
    .from("content_translations")
    .select("translated_text")
    .eq("entity_type", content.type)
    .eq("entity_id", content.id)
    .eq("target_lang", targetLang)
    .maybeSingle();
  return (data as { translated_text: string } | null)?.translated_text ?? null;
}
