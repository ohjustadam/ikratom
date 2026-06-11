#!/usr/bin/env node
/**
 * fetch-bill-texts.mjs — populate bills.bill_text_versions from LegiScan.
 *
 * DAM REMOVED (2026-06-11): bill_text_versions (0064) had THREE readers
 * (classifier, cluster detector, journey enricher) and ZERO writers — so
 * ~170 discovered bills could never be classified (no text, no summary).
 * This is the missing tributary: getBill → texts[] → getBillText (base64
 * doc; HTML stripped, PDF via the repo's pdf-parse v2 CJS bridge) → stored
 * as jsonb [{version_id, date, type, text}].
 *
 * Targets kratom-relevant state bills with a legiscan_bill_id and no stored
 * text, thinnest-context first. ~2 LegiScan calls per bill (30k/mo budget).
 *
 *   node --env-file=.env.local scripts/fetch-bill-texts.mjs --limit 200
 *   node --env-file=.env.local scripts/fetch-bill-texts.mjs --limit 5 --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const KEY = process.env.LEGISCAN_API_KEY;
if (!KEY) { console.log("fetch-bill-texts: LEGISCAN_API_KEY empty — nothing to do."); process.exit(0); }

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); const v = args[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : null; };
const LIMIT = parseInt(arg("--limit") ?? "100", 10) || 100;
const DRY = args.includes("--dry-run");
const MAX_CHARS = 60_000;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const t0 = Date.now();
const api = async (params) => {
  const r = await fetch(`https://api.legiscan.com/?key=${KEY}&${params}`, { signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`LegiScan ${r.status}`);
  return r.json();
};

const stripHtml = (h) => h
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

async function decodeDoc(b64, mimeId) {
  const buf = Buffer.from(b64, "base64");
  // LegiScan mime_id: 1=HTML 2=PDF 3=WordPerfect 4=MS Word 5=RTF 6=MS Word 2007
  if (mimeId === 2) {
    try {
      const { PDFParse } = require("pdf-parse");
      const parser = new PDFParse(buf);
      const data = await parser.getText();
      return (data?.text ?? "").replace(/\s+/g, " ").trim();
    } catch (e) { return null; }
  }
  const s = buf.toString("utf8");
  return /<\w+[^>]*>/.test(s) ? stripHtml(s) : s.replace(/\s+/g, " ").trim();
}

// Candidates: kratom-relevant, LegiScan-linked, no stored text yet.
const { data: rows, error } = await sb.from("bills")
  .select("id, state, bill_number, legiscan_bill_id, summary, bill_text_versions")
  .eq("scope", "state")
  .in("kratom_relevance", ["anti", "pro", "neutral"])
  .not("legiscan_bill_id", "is", null)
  .is("bill_text_versions", null)
  .order("last_action_at", { ascending: false, nullsFirst: false })
  .limit(LIMIT);
if (error) { console.error(error.message); process.exit(1); }
console.log(`fetch-bill-texts: ${rows?.length ?? 0} candidate(s)${DRY ? " [DRY]" : ""}`);

let done = 0, failed = 0, noDocs = 0;
for (const b of rows ?? []) {
  try {
    const bill = (await api(`op=getBill&id=${b.legiscan_bill_id}`))?.bill;
    const texts = (bill?.texts ?? []).slice(-2); // latest 1-2 versions
    if (!texts.length) { noDocs++; console.log(`  · ${b.state} ${b.bill_number}: no text docs`); continue; }
    const versions = [];
    for (const t of texts) {
      const doc = (await api(`op=getBillText&id=${t.doc_id}`))?.text;
      if (!doc?.doc) continue;
      const text = await decodeDoc(doc.doc, doc.mime_id ?? t.mime_id);
      if (text && text.length > 200) {
        versions.push({ version_id: t.doc_id, date: t.date ?? null, type: t.type ?? null, text: text.slice(0, MAX_CHARS) });
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    if (!versions.length) { failed++; console.log(`  ✗ ${b.state} ${b.bill_number}: docs undecodable`); continue; }
    if (!DRY) {
      const { error: upErr } = await sb.from("bills").update({ bill_text_versions: versions }).eq("id", b.id);
      if (upErr) { failed++; console.log(`  ✗ ${b.state} ${b.bill_number}: ${upErr.message.slice(0, 60)}`); continue; }
    }
    done++;
    console.log(`  ✓ ${b.state} ${b.bill_number}: ${versions.length} version(s), ${versions[versions.length - 1].text.length} chars`);
    await new Promise((r) => setTimeout(r, 500));
  } catch (e) { failed++; console.log(`  ✗ ${b.state} ${b.bill_number}: ${(e.message || "").slice(0, 60)}`); }
}

console.log(`\nDone${DRY ? " [DRY]" : ""}. texts=${done} no-docs=${noDocs} failed=${failed}`);
if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "fetch_bill_texts", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      status: failed > 0 && done === 0 ? "fail" : "success", rows_updated: done,
      notes: `texts=${done} no-docs=${noDocs} failed=${failed} limit=${LIMIT}`,
    });
  } catch { /* best-effort */ }
}
process.exit(0);
