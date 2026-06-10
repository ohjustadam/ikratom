#!/usr/bin/env node
/**
 * iKratom — Content translation via local Ollama.
 *
 * Pre-translates bill summaries + advocacy callouts (and stories /
 * thread titles, optional) into Indonesian, Thai, Malay, Vietnamese,
 * Tagalog, Spanish. Stored in content_translations keyed by
 * (entity_type, entity_id, target_lang) with a sha-256 of the source
 * for change detection.
 *
 * Why local Ollama: free, unlimited, runs without API budget. Quality
 * is acceptable for SE Asian languages with llama3.3:70b; llama3.1:8b
 * is mid-quality but fast. We default to 8b for throughput.
 *
 * Run with:
 *   npm run translate:content                       # all + 6 langs
 *   npm run translate:content -- --lang id          # only Indonesian
 *   npm run translate:content -- --type bill_summary
 *   npm run translate:content -- --refresh          # re-translate everything
 *   npm run translate:content -- --model llama3.3:70b
 *
 * Pull the model first if needed: ollama pull llama3.1:8b
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { OLLAMA_NUM_THREAD } from "./lib/ollama-options.mjs";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const args = process.argv.slice(2);
function arg(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; }
const MODEL = arg("--model") || "llama3.1:8b";
const SPECIFIC_LANG = arg("--lang");
const SPECIFIC_TYPE = arg("--type");
const LIMIT = parseInt(arg("--limit") ?? "200");
const REFRESH = args.includes("--refresh");

const TARGET_LANGS = SPECIFIC_LANG
  ? [SPECIFIC_LANG]
  : ["id", "th", "ms", "vi", "tl", "es"];

const LANG_LABEL = {
  id: "Indonesian (Bahasa Indonesia)",
  th: "Thai (ภาษาไทย)",
  ms: "Malay (Bahasa Melayu)",
  vi: "Vietnamese (Tiếng Việt)",
  tl: "Tagalog (Filipino)",
  es: "Spanish (Español)",
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const models = (data.models ?? []).map((m) => m.name);
    if (!models.some((m) => m === MODEL || m.startsWith(MODEL.split(":")[0]))) {
      console.error(`✗ Model "${MODEL}" not found. Available: ${models.join(", ")}`);
      console.error(`  Pull it: ollama pull ${MODEL}`);
      return false;
    }
    return true;
  } catch {
    console.error(`✗ Can't reach Ollama at ${OLLAMA_URL}.`);
    return false;
  }
}

async function translate(text, targetLangCode) {
  const targetLabel = LANG_LABEL[targetLangCode] ?? targetLangCode;
  const system = `You are a professional translator. Translate the user's message to ${targetLabel}. Output ONLY the translated text — no quotes, no explanation, no English commentary. Preserve the tone (advocacy / civic / urgent) and any specialized terms (Schedule II, mitragynine, 7-OH, KCPA, kratom). Use natural ${targetLabel} that a native speaker would write.`;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
      stream: false,
      options: { temperature: 0.2, num_thread: OLLAMA_NUM_THREAD },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = await res.json();
  const out = (data.message?.content ?? "").trim();
  if (!out) throw new Error("Empty translation");
  return out;
}

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Sources to translate — list of { type, query, idField, textField } */
const SOURCES = [
  {
    type: "bill_summary",
    label: "Bill summaries",
    fetch: () => supabase
      .from("bills")
      .select("id, summary_ai, last_action_at")
      .eq("active", true)
      .not("summary_ai", "is", null)
      .order("last_action_at", { ascending: false, nullsFirst: false })
      .limit(LIMIT),
    idField: "id",
    textField: "summary_ai",
  },
  {
    type: "bill_callout",
    label: "Bill advocacy callouts",
    fetch: () => supabase
      .from("bills")
      .select("id, advocacy_callout, last_action_at")
      .eq("active", true)
      .not("advocacy_callout", "is", null)
      .order("last_action_at", { ascending: false, nullsFirst: false })
      .limit(LIMIT),
    idField: "id",
    textField: "advocacy_callout",
  },
  {
    type: "story_body",
    label: "Approved kratom stories",
    fetch: () => supabase
      .from("kratom_stories")
      .select("id, body, created_at")
      .eq("moderation_status", "approved")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    idField: "id",
    textField: "body",
  },
  {
    type: "thread_title",
    label: "Recent forum thread titles",
    fetch: () => supabase
      .from("forum_threads")
      .select("id, title, created_at")
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    idField: "id",
    textField: "title",
  },
];

const targetSources = SPECIFIC_TYPE
  ? SOURCES.filter((s) => s.type === SPECIFIC_TYPE)
  : SOURCES;

console.log(`\nTranslating with Ollama (${MODEL} @ ${OLLAMA_URL})…\n`);
console.log(`Languages: ${TARGET_LANGS.join(", ")}`);
console.log(`Types:     ${targetSources.map((s) => s.type).join(", ")}`);
console.log();

if (!(await checkOllama())) process.exit(1);

let totalDone = 0, totalFailed = 0, totalSkipped = 0;
const tStart = Date.now();

for (const src of targetSources) {
  const { data: rows, error } = await src.fetch();
  if (error) { console.error(`Fetch failed for ${src.type}:`, error.message); continue; }
  console.log(`── ${src.label} (${(rows ?? []).length} rows) ──`);

  for (const row of rows ?? []) {
    const text = row[src.textField];
    if (!text || typeof text !== "string" || text.trim().length < 5) continue;
    const hash = sha256(text);

    for (const lang of TARGET_LANGS) {
      // Skip if cached + source unchanged + not refreshing
      if (!REFRESH) {
        const { data: existing } = await supabase
          .from("content_translations")
          .select("id, source_hash")
          .eq("entity_type", src.type)
          .eq("entity_id", row[src.idField])
          .eq("target_lang", lang)
          .maybeSingle();
        if (existing && existing.source_hash === hash) {
          totalSkipped++;
          continue;
        }
      }

      try {
        process.stdout.write(`  [${src.type}] ${row[src.idField].slice(0, 8)} → ${lang} `);
        const translated = await translate(text, lang);
        await supabase
          .from("content_translations")
          .upsert(
            {
              entity_type: src.type,
              entity_id: row[src.idField],
              target_lang: lang,
              source_hash: hash,
              translated_text: translated.slice(0, 20000),
            },
            { onConflict: "entity_type,entity_id,target_lang" },
          );
        console.log("✓");
        totalDone++;
      } catch (e) {
        console.log(`✗ ${e.message ?? e}`);
        totalFailed++;
      }
    }
  }
}

const elapsed = ((Date.now() - tStart) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${totalDone} translated, ${totalSkipped} skipped (cached), ${totalFailed} failed.`);

// Self-monitoring (standing rule 6) — nightly box step since PR-D.
try {
  await supabase.from("scraper_runs").insert({
    source: "translate_content",
    started_at: new Date(tStart).toISOString(),
    finished_at: new Date().toISOString(),
    status: totalDone === 0 && totalFailed > 0 ? "fail" : "success",
    rows_updated: totalDone,
    notes: `translated=${totalDone} cached=${totalSkipped} failed=${totalFailed} model=${MODEL}`,
  });
} catch { /* best-effort */ }
