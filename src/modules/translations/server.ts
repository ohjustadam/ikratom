import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { runAi } from "@/lib/ai/jobs";

/**
 * Server-side translation: callable from cron contexts where the local
 * Ollama isn't reachable. Mirrors scripts/translate-content.mjs but
 * uses the AI router (Ollama → Groq → Gemini fallback chain).
 *
 * Flow per item:
 *   1. Hash the source text. If the cached row's source_hash matches +
 *      target_lang matches, skip.
 *   2. Otherwise call runAi() with the translate prompt + target lang
 *      and upsert the result into content_translations.
 *
 * Capped at TRANSLATIONS_PER_RUN per cron invocation. The local script
 * stays the workhorse for big batches; this module is the trickle-fill
 * layer that keeps newly-arrived content current.
 */

const TRANSLATIONS_PER_RUN = 50;

const LANG_NAMES: Record<string, string> = {
  id: "Indonesian (Bahasa Indonesia)",
  th: "Thai (ภาษาไทย)",
  ms: "Malay (Bahasa Melayu)",
  vi: "Vietnamese (Tiếng Việt)",
  tl: "Tagalog (Filipino)",
  es: "Spanish (Español)",
};

const TARGET_LANGS = Object.keys(LANG_NAMES);

const SYSTEM_BASE =
  "You are a professional translator specialized in civic-action content. " +
  "Translate the user's text from English into TARGET_LANG.\n\n" +
  "Rules:\n" +
  "- Preserve advocacy tone and urgency.\n" +
  "- Keep technical kratom terms in canonical English form (kratom, mitragynine, 7-OH-mitragynine, AKA, KCPA) unless the target locale has a widely-used native form.\n" +
  "- Keep ALL-CAPS bill numbers (e.g. \"OK SB 1234\") exactly as they appear.\n" +
  "- No commentary, no explanation, no source-language echo. Return ONLY the translated text.\n" +
  "- If the source text is already in the target language, return it unchanged.";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Translate one piece of content. Returns the cached translation if
 * source_hash hasn't changed. Otherwise calls the AI and upserts.
 */
export async function translateOne(
  supabase: SupabaseClient,
  input: {
    entity_type: "bill_summary" | "bill_callout" | "story_body" | "thread_title";
    entity_id: string;
    source_text: string;
    target_lang: string;
  },
): Promise<{ ok: true; cached: boolean; text: string } | { error: string }> {
  if (!TARGET_LANGS.includes(input.target_lang)) {
    return { error: `Unsupported target lang: ${input.target_lang}` };
  }
  const trimmed = (input.source_text ?? "").slice(0, 4000).trim();
  if (!trimmed) return { error: "Empty source text" };

  const hash = sha256(trimmed);

  // Check cache
  const { data: existing } = await supabase
    .from("content_translations")
    .select("translated_text, source_hash")
    .eq("entity_type", input.entity_type)
    .eq("entity_id", input.entity_id)
    .eq("target_lang", input.target_lang)
    .maybeSingle();

  if (existing && existing.source_hash === hash) {
    return { ok: true, cached: true, text: existing.translated_text };
  }

  // Run the AI
  const langFull = LANG_NAMES[input.target_lang];
  const system = SYSTEM_BASE.replace("TARGET_LANG", langFull);

  let result;
  try {
    result = await runAi(
      "translate",
      [
        { role: "system", content: system },
        { role: "user", content: trimmed },
      ],
      {
        caller: "cron:translate-server",
        metadata: { entity_type: input.entity_type, entity_id: input.entity_id, target_lang: input.target_lang },
      },
      {}, // default routing
      { temperature: 0.2, maxTokens: 2000 },
    );
  } catch (e) {
    return { error: (e as Error).message };
  }

  const translated = result.text.trim();
  if (!translated) return { error: "Empty translation" };

  // Upsert into cache
  await supabase
    .from("content_translations")
    .upsert(
      {
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        target_lang: input.target_lang,
        source_hash: hash,
        translated_text: translated,
      },
      { onConflict: "entity_type,entity_id,target_lang" },
    );

  return { ok: true, cached: false, text: translated };
}

/**
 * Cron entrypoint — finds bills with non-null summary_ai/advocacy_callout
 * that don't have translations into all target langs yet, and trickles
 * through them until per-run cap. Returns aggregate result for the
 * cron's log.
 */
export async function sweepTranslations(
  supabase: SupabaseClient,
): Promise<{ considered: number; translated: number; cached: number; failed: number }> {
  const result = { considered: 0, translated: 0, cached: 0, failed: 0 };

  // Pull bills that have AI fields populated but may be missing translations
  const { data: bills } = await supabase
    .from("bills")
    .select("id, summary_ai, advocacy_callout")
    .not("summary_ai", "is", null)
    .order("enriched_at", { ascending: false })
    .limit(50);

  if (!bills || bills.length === 0) return result;

  // For each (bill, lang, field) tuple, attempt translation up to the cap.
  for (const b of bills as Array<{ id: string; summary_ai: string | null; advocacy_callout: string | null }>) {
    for (const lang of TARGET_LANGS) {
      for (const field of [
        { type: "bill_summary" as const, text: b.summary_ai },
        { type: "bill_callout" as const, text: b.advocacy_callout },
      ]) {
        if (!field.text) continue;
        if (result.translated + result.cached + result.failed >= TRANSLATIONS_PER_RUN) {
          return result;
        }
        result.considered++;
        const r = await translateOne(supabase, {
          entity_type: field.type,
          entity_id: b.id,
          source_text: field.text,
          target_lang: lang,
        });
        if ("error" in r) result.failed++;
        else if (r.cached) result.cached++;
        else result.translated++;
      }
    }
  }

  return result;
}
