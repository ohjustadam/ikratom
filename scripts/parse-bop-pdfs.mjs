#!/usr/bin/env node
/**
 * Layer 1.5 of the BoP classifier pipeline. The regex pass reads link
 * text only and misses anything buried in a PDF agenda packet. This
 * script downloads each PDF-URL finding, extracts text via pdf-parse,
 * and re-runs the regex classifier on (title + pdf_text) so PDF-only
 * kratom rules can graduate from "unrelated" to "kratom_direct" and
 * become eligible for AI classification.
 *
 * Runs daily on GitHub Actions (cron-daily.yml: parse-bop-pdfs job)
 * BEFORE the AI classifier so freshly-promoted candidates flow in.
 * Also runnable locally:
 *
 *   node --env-file=.env.local scripts/parse-bop-pdfs.mjs --limit 30
 *
 * Idempotent — only picks up findings where pdf_parsed_at IS NULL.
 *
 * SSRF defense at download time (same shape as the BoP adapters):
 *   - http/https only
 *   - block private IPv4 / IPv6, loopback, link-local, IMDS
 *   - block non-standard ports
 *   - block embedded credentials
 */

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";

const requireCjs = createRequire(import.meta.url);
const { PDFParse } = requireCjs("pdf-parse");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const args = process.argv.slice(2);
const arg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const LIMIT = parseInt(arg("--limit") ?? "30", 10);
const SPECIFIC = arg("--finding");

// Match generic_html's hardened header set so .gov PDF endpoints don't
// 403 us.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Accept: "application/pdf,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.google.com/",
};

const MAX_BYTES = 20 * 1024 * 1024; // 20MB cap — anything bigger is suspect
const PDF_TEXT_CAP = 50_000; // 50KB of extracted text — enough for re-classify

// SSRF defense (same shape as the adapter checks)
function isSafeForFetch(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (u.port && u.port !== "80" && u.port !== "443") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "metadata.google.internal") return false;
    if (/\.(local|internal|lan|home|corp|intra)$/.test(h)) return false;
    const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const [a, b] = v4.slice(1).map(Number);
      if (a === 10 || a === 127 || a === 0) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Classifier patterns — KEEP IN SYNC with scripts/lib/bop-engine.mjs
// and src/modules/bop/classify.ts. We can't import the .mjs engine
// here directly since the script needs to also do raw regex over the
// title + pdf_text concatenation, not just title.
const DIRECT_RE =
  /\b(kratom|mitragyna\w*|7\s*-?\s*OH\b|7\s*-?\s*hydroxy(?:mitragynine)?)\b/i;
const ADJACENT_RE =
  /\b(novel\s+psychoactive\s+substance|emerging\s+(?:drug|substance)|scheduling\s+petition|new\s+controlled\s+substance|botanical\s+(?:medicine|substance)|herbal\s+supplement)\b/i;
const HOSTILE_RE =
  /\b(ban|prohibit|add\s+to\s+schedule|emergency\s+rule|criminaliz|adulterated|illegal\s+drug)\b/i;
const SUPPORTIVE_RE =
  /\b(consumer\s+protection|labeling|age\s+limit|kratom\s+consumer\s+protection|kcpa)\b/i;

function reclassify(parts) {
  const text = parts.filter(Boolean).join(" ");
  let relevance = "unrelated";
  if (DIRECT_RE.test(text)) relevance = "kratom_direct";
  else if (ADJACENT_RE.test(text)) relevance = "kratom_adjacent";

  let severity = "unknown";
  if (relevance !== "unrelated") {
    if (HOSTILE_RE.test(text)) severity = "hostile_proposal";
    else if (SUPPORTIVE_RE.test(text)) severity = "supportive";
    else severity = "discussion_only";
  }
  return { relevance, severity };
}

async function downloadPdf(url) {
  if (!isSafeForFetch(url)) {
    return { status: "rejected_unsafe", buf: null, contentType: null };
  }
  let res;
  try {
    res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });
  } catch (e) {
    return { status: "fetch_failed", buf: null, error: String(e?.message ?? e) };
  }
  if (!res.ok) {
    return {
      status: "fetch_failed",
      buf: null,
      error: `HTTP ${res.status} ${res.statusText}`,
    };
  }
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  // Some .gov sites return text/html with embedded JS to redirect to the
  // actual PDF. Accept application/pdf only.
  if (!contentType.startsWith("application/pdf") && !contentType.startsWith("application/octet-stream")) {
    return { status: "not_pdf", buf: null, contentType };
  }
  // Content-Length check first; some servers don't send it, so we also
  // size-check after the body arrives.
  const clHeader = res.headers.get("content-length");
  if (clHeader && parseInt(clHeader, 10) > MAX_BYTES) {
    return { status: "too_large", buf: null };
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_BYTES) {
    return { status: "too_large", buf: null };
  }
  return { status: "ok", buf: Buffer.from(ab), contentType };
}

async function extractText(buf) {
  const parser = new PDFParse({ data: buf });
  const out = await parser.getText();
  // pdf-parse v2 returns { text, numpages, ... }
  return (out?.text ?? "").trim();
}

async function processFinding(finding) {
  console.log(`\n--- ${finding.state} | ${(finding.title ?? "").slice(0, 80)}`);
  console.log(`    url: ${finding.url}`);

  const dl = await downloadPdf(finding.url);
  if (dl.status !== "ok") {
    console.log(`    ✗ ${dl.status}${dl.error ? `: ${dl.error.slice(0, 100)}` : ""}`);
    await sb
      .from("bop_findings")
      .update({
        pdf_status: dl.status,
        pdf_error: dl.error?.slice(0, 500) ?? null,
        pdf_parsed_at: new Date().toISOString(),
      })
      .eq("id", finding.id);
    return { status: dl.status };
  }

  let text;
  try {
    text = await extractText(dl.buf);
  } catch (e) {
    console.log(`    ✗ parse_failed: ${String(e?.message ?? e).slice(0, 100)}`);
    await sb
      .from("bop_findings")
      .update({
        pdf_status: "parse_failed",
        pdf_error: String(e?.message ?? e).slice(0, 500),
        pdf_byte_count: dl.buf.byteLength,
        pdf_parsed_at: new Date().toISOString(),
      })
      .eq("id", finding.id);
    return { status: "parse_failed" };
  }

  const truncated = text.slice(0, PDF_TEXT_CAP);
  const status = truncated.length > 0 ? "ok" : "empty";

  // Re-classify on title + extracted text. If new classification is
  // STRONGER than the current (unrelated → adjacent → direct), update it.
  // Only upgrade; don't downgrade — admin reviewer override always wins
  // and we filter to reviewed_at IS NULL.
  const newClass = reclassify([finding.title, truncated]);
  const currentRel = finding.classified_relevance;
  const rank = (r) =>
    r === "kratom_direct" ? 2 : r === "kratom_adjacent" ? 1 : 0;
  const upgradeRelevance = rank(newClass.relevance) > rank(currentRel);

  const patch = {
    pdf_text: truncated,
    pdf_byte_count: dl.buf.byteLength,
    pdf_parsed_at: new Date().toISOString(),
    pdf_status: status,
    pdf_error: null,
  };

  if (upgradeRelevance) {
    patch.classified_relevance = newClass.relevance;
    patch.classified_severity = newClass.severity;
    console.log(
      `    ✓ ${truncated.length}c · UPGRADED ${currentRel} → ${newClass.relevance} (${newClass.severity})`
    );
  } else {
    console.log(`    ✓ ${truncated.length}c · class unchanged (${currentRel})`);
  }

  await sb.from("bop_findings").update(patch).eq("id", finding.id);
  return { status, upgraded: upgradeRelevance };
}

// ---- main ----
let findings;
if (SPECIFIC) {
  const { data } = await sb
    .from("bop_findings")
    .select("id, state, title, url, classified_relevance")
    .eq("id", SPECIFIC)
    .single();
  findings = data ? [data] : [];
} else {
  const { data } = await sb
    .from("bop_findings")
    .select("id, state, title, url, classified_relevance")
    .is("pdf_parsed_at", null)
    .is("reviewed_at", null)
    .not("url", "is", null)
    .ilike("url", "%.pdf%")
    .order("found_at", { ascending: false })
    .limit(LIMIT);
  findings = data ?? [];
}

if (findings.length === 0) {
  console.log("Nothing to parse.");
  process.exit(0);
}
console.log(`Parsing ${findings.length} PDF finding(s)…`);

let ok = 0, upgraded = 0, failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const f of findings) {
  try {
    const r = await processFinding(f);
    if (r.status === "ok" || r.status === "empty") ok++;
    else failed++;
    if (r.upgraded) upgraded++;
  } catch (e) {
    console.log(`    ✗ unexpected: ${String(e?.message ?? e).slice(0, 100)}`);
    failed++;
  }
  // 500ms pacing — polite to state gov endpoints + leaves CPU/network
  // headroom for the other daily jobs running in parallel.
  await sleep(500);
}

console.log(
  `\nDone. ${ok} parsed, ${failed} failed, ${upgraded} re-classified.`
);
process.exit(0);
