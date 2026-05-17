/**
 * Second-pass abstract backfill — AI extraction from publisher URLs.
 *
 * Runs AFTER scripts/backfill-research-abstracts.mjs (which is PubMed-
 * based and recovers abstracts that PubMed now has but didn't at
 * ingest time). For the residual papers where PubMed STILL doesn't
 * have an abstract (preprints, conference posters, retraction notices,
 * etc.), this script fetches the publisher's full_text_url + asks
 * Groq to extract the verbatim abstract or write a 2-3 sentence summary.
 *
 * Mirrors the auto-enrich logic from PR #316 (lib/research-enrich-ai.ts)
 * but standalone so we can run it manually + safely against the
 * existing 46 NULL-abstract rows.
 *
 * Usage:
 *   node --env-file=.env.local scripts/ai-extract-missing-abstracts.mjs
 *   node --env-file=.env.local scripts/ai-extract-missing-abstracts.mjs --limit 20
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit"));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1] ?? args[args.indexOf(limitArg) + 1] ?? "100", 10) : 100;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

async function callGroq(messages) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages, temperature: 0.1, max_tokens: 2000,
    }),
  });
  if (!r.ok) throw new Error(`groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).choices[0]?.message?.content ?? "";
}

const { data: papers } = await sb
  .from("research_papers")
  .select("id, title, full_text_url, pdf_url, admin_notes_md")
  .is("abstract", null).eq("is_active", true)
  .limit(LIMIT);

console.log(`AI-extracting abstracts for ${papers?.length ?? 0} papers (PubMed couldn't provide them)\n`);

let updated = 0, skipped = 0, failed = 0;

for (const p of papers ?? []) {
  const url = p.full_text_url ?? p.pdf_url;
  if (!url) { console.log(`  ✗ ${p.title?.slice(0, 50)} — no URL`); skipped++; continue; }
  process.stdout.write(`  ${p.title?.slice(0, 50).padEnd(50)} `);

  let html;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "iKratom Research Bot (research@ikratom.org)" } });
    if (!r.ok) { console.log(`✗ HTTP ${r.status}`); failed++; continue; }
    html = await r.text();
    if (html.length < 500) { console.log(`○ too short`); skipped++; continue; }
  } catch (e) { console.log(`✗ fetch: ${e.message.slice(0, 40)}`); failed++; continue; }

  const pageText = stripHtml(html).slice(0, 200_000);
  let aiText;
  try {
    aiText = await callGroq([
      { role: "system", content: "Extract research-paper abstracts from raw page text. Output ONLY the abstract — no preamble. Return verbatim original if present. Otherwise a 2-3 sentence summary prefixed '[AI summary, no abstract on source page]:'. If neither, respond NO_ABSTRACT_FOUND." },
      { role: "user", content: `Title: ${p.title ?? ""}\nURL: ${url}\n\nPage text:\n${pageText}` },
    ]);
  } catch (e) {
    console.log(`✗ AI: ${e.message.slice(0, 40)}`); failed++;
    if (/429|rate/i.test(e.message)) { console.log("  (rate-limited, backing off 30s)"); await new Promise(r => setTimeout(r, 30_000)); }
    continue;
  }

  const extracted = aiText.trim().slice(0, 6000);
  if (extracted === "NO_ABSTRACT_FOUND" || extracted.length < 80) { console.log(`○ no abstract`); skipped++; await new Promise(r => setTimeout(r, 1500)); continue; }

  const provenance = `AI-backfilled abstract via groq on ${new Date().toISOString().slice(0, 10)} (${extracted.length} chars)`;
  const newNotes = p.admin_notes_md ? `${p.admin_notes_md}\n\n${provenance}` : provenance;
  const { error } = await sb.from("research_papers").update({ abstract: extracted, admin_notes_md: newNotes.slice(0, 8000) }).eq("id", p.id);

  if (error) { console.log(`✗ update: ${error.message.slice(0, 50)}`); failed++; }
  else { console.log(`✓ ${extracted.length}c`); updated++; }
  await new Promise(r => setTimeout(r, 1800));
}

console.log(`\n=== updated ${updated} · skipped ${skipped} · failed ${failed} ===`);
