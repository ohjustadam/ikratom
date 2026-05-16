/**
 * One-off: re-run the new metadata + AI-enrichment flow on a specific
 * research_papers row that was submitted before the upgrade.
 *
 * Usage: node --env-file=.env.local scripts/reenrich-research-paper.mjs <paper_id>
 *
 * Owner directive 2026-05-16: paper 1c38910f got submitted via the
 * /research/submit URL flow and only captured 316 chars of truncated
 * abstract + no authors / journal / DOI / year. New extractor handles
 * citation_* meta tags + auto-AI-enriches truncated abstracts. This
 * script applies it to the existing row.
 */

import { createClient } from "@supabase/supabase-js";

const TRACKING = new Set([
  "fbclid","gclid","msclkid","twclid","yclid","_gl",
  "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
  "mc_eid","mc_cid","vero_id","vero_conv","ref","ref_src","igshid","ocid",
]);

function stripTracking(rawUrl) {
  try {
    const u = new URL(rawUrl);
    for (const k of [...u.searchParams.keys()]) {
      if (TRACKING.has(k) || /^utm_/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString().replace(/\?$/, "");
  } catch { return rawUrl; }
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function extractAllMeta(html, namePattern, limit = 50) {
  const out = []; const seen = new Set();
  const re = /<meta\b[^>]*>/gi; let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    if (!namePattern.test(tag)) continue;
    const c = /content=["']([^"']{1,1000})["']/i.exec(tag);
    if (!c) continue;
    const v = decodeEntities(c[1]).trim();
    if (!v || seen.has(v)) continue;
    seen.add(v); out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}
function extractOne(html, p, cap = 4000) {
  const a = extractAllMeta(html, p, 1);
  return a[0]?.slice(0, cap) ?? null;
}

function extractMeta(html) {
  const title = extractOne(html, /name=["']citation_title["']/i, 500)
    ?? extractOne(html, /property=["']og:title["']/i, 500)
    ?? html.match(/<title[^>]*>([^<]{3,500})<\/title>/i)?.[1]?.trim() ?? null;
  let authors = extractAllMeta(html, /name=["']citation_author["']/i, 50);
  if (authors.length === 0) {
    const fb = extractOne(html, /name=["']author["']/i, 500);
    if (fb) authors = [fb];
  }
  const journal = extractOne(html, /name=["']citation_journal_title["']/i, 200)
    ?? extractOne(html, /name=["']citation_journal_abbrev["']/i, 100);
  const doi = extractOne(html, /name=["']citation_doi["']/i, 100);
  const dateRaw = extractOne(html, /name=["']citation_publication_date["']/i, 50)
    ?? extractOne(html, /name=["']citation_online_date["']/i, 50)
    ?? extractOne(html, /name=["']citation_date["']/i, 50)
    ?? extractOne(html, /name=["']citation_year["']/i, 50);
  let year = null; let isoDate = null;
  if (dateRaw) {
    const ym = dateRaw.match(/(19|20)\d{2}/);
    year = ym ? parseInt(ym[0], 10) : null;
    const im = dateRaw.match(/(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
    if (im) isoDate = `${im[1]}-${im[2].padStart(2,"0")}-${im[3].padStart(2,"0")}`;
  }
  const pdfUrl = extractOne(html, /name=["']citation_pdf_url["']/i, 1000);
  let abstract = extractOne(html, /name=["']citation_abstract["']/i, 8000)
    ?? extractOne(html, /property=["']og:description["']/i, 4000)
    ?? extractOne(html, /name=["']description["']/i, 4000);
  const abstractLikelyTruncated = !!abstract && abstract.length < 600;
  return { title, authors, journal, doi, year, isoDate, pdfUrl, abstract, abstractLikelyTruncated };
}

function stripHtmlToText(html) {
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

async function callGroq(prompt) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: prompt,
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });
  if (!r.ok) throw new Error(`groq ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.choices[0]?.message?.content ?? "";
}

const paperId = process.argv[2] || "1c38910f-e0be-4cc3-a393-c8976c1ac7f3";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: paper } = await sb.from("research_papers").select("id, title, abstract, authors, journal, doi, publication_year, full_text_url, admin_notes_md").eq("id", paperId).single();
if (!paper) { console.error("paper not found"); process.exit(1); }

const cleanUrl = stripTracking(paper.full_text_url);
console.log("paper:", paper.id, "title:", paper.title?.slice(0, 60));
console.log("old url:", paper.full_text_url);
console.log("new url (tracking-stripped):", cleanUrl);
console.log("old abstract len:", (paper.abstract ?? "").length);
console.log("old authors:", JSON.stringify(paper.authors));

const r = await fetch(cleanUrl, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "iKratom Research Bot (research@ikratom.org)" } });
if (!r.ok) { console.error("fetch failed:", r.status); process.exit(1); }
const html = await r.text();
console.log("fetched bytes:", html.length);

const meta = extractMeta(html);
console.log("\n--- extracted meta ---");
console.log("title:", meta.title?.slice(0, 80));
console.log("authors:", meta.authors);
console.log("journal:", meta.journal);
console.log("doi:", meta.doi);
console.log("year:", meta.year, "iso:", meta.isoDate);
console.log("pdf:", meta.pdfUrl);
console.log("abstract len:", (meta.abstract ?? "").length, "truncated?", meta.abstractLikelyTruncated);

let finalAbstract = meta.abstract;
let enrichmentNote = "";
if (!finalAbstract || meta.abstractLikelyTruncated) {
  console.log("\n--- running AI enrichment ---");
  const pageText = stripHtmlToText(html).slice(0, 200_000);
  const aiText = await callGroq([
    { role: "system", content: "You extract research-paper abstracts from raw page text. Output ONLY the abstract — no preamble, no markdown. Return verbatim original if present; otherwise a 2-3 sentence summary prefixed '[AI summary, no abstract on source page]:'. If neither, respond NO_ABSTRACT_FOUND." },
    { role: "user", content: `Title: ${meta.title}\nURL: ${cleanUrl}\n\nPage text (truncated):\n\n${pageText}` },
  ]);
  if (aiText && aiText !== "NO_ABSTRACT_FOUND" && aiText.length >= 80) {
    finalAbstract = aiText.slice(0, 8000);
    enrichmentNote = ` AI-extracted abstract via groq (${finalAbstract.length} chars; original meta only had ${meta.abstractLikelyTruncated ? "truncated og:description" : "no abstract"}).`;
    console.log("AI returned:", aiText.length, "chars");
  } else {
    console.log("AI returned NO_ABSTRACT_FOUND or too-short");
  }
}

const newAdminNotes = `${paper.admin_notes_md ?? ""}\n\nRe-enriched on ${new Date().toISOString().slice(0, 10)} (script: reenrich-research-paper.mjs).${enrichmentNote}`.trim();

const update = {
  title: meta.title?.slice(0, 500) ?? paper.title,
  abstract: finalAbstract?.slice(0, 8000) ?? paper.abstract,
  authors: meta.authors.length > 0 ? meta.authors.slice(0, 50) : paper.authors,
  journal: meta.journal ?? paper.journal,
  doi: meta.doi ?? paper.doi,
  publication_year: meta.year ?? paper.publication_year,
  publication_date: meta.isoDate,
  full_text_url: cleanUrl,
  pdf_url: meta.pdfUrl,
  admin_notes_md: newAdminNotes.slice(0, 8000),
};
console.log("\n--- updating row ---");
const { error } = await sb.from("research_papers").update(update).eq("id", paperId);
if (error) { console.error("update failed:", error.message); process.exit(1); }
console.log("✓ updated");
console.log("new authors:", update.authors);
console.log("new journal:", update.journal);
console.log("new doi:", update.doi);
console.log("new year:", update.publication_year);
console.log("new abstract len:", update.abstract?.length);
