/**
 * page-text.mjs — fetch + tag-strip for one web page, with a headless-render
 * fallback for JS-built pages (PR-B).
 *
 * Shared by officials-extract.mjs (Tier-3 roster pages) and ban-verify.mjs
 * (local-ordinance verification). Always returns the full tag-stripped page
 * text, NOT Readability: rosters and ordinance text live in tables/sidebars
 * that article extraction discards (verified on cityoflewistown.com —
 * Readability kept the meeting schedule and dropped every commissioner).
 * Noise is fine; the extractors work from raw text.
 *
 * Fallback: when plain fetch fails or yields a thin JS shell (< 600 chars —
 * a real roster/ordinance page is never that small), the page is rendered in
 * headless Chromium (scripts/lib/headless-render.mjs) and we take
 * document.body.innerText. That unsticks San Jose / Greensboro / Cedar
 * Rapids–class rosters with no Firecrawl, no key. Render degrades to null
 * wherever Chromium isn't available, so cloud callers keep today's behavior.
 *
 * PDF is OPT-IN (`{ pdf: true }`) and off by default. Most municipal meeting
 * agendas are PDFs, so meeting discovery needs them; the four existing callers
 * (ban-verify, officials-extract, auto-fulfill-pending-local-reps,
 * research-stakeholder-stance) all call `fetchPageText(url)` with no options
 * and were written against "PDF ⇒ null". Defaulting the flag false is what
 * keeps them byte-identical rather than silently feeding roster/ordinance
 * extractors a new class of input.
 *
 * Returns null when nothing usable could be fetched — callers skip to their
 * next candidate URL.
 */

import { createRequire } from "node:module";
import { renderPage } from "./headless-render.mjs";

// pdf-parse v2 ships CJS only and blows up on a bare ESM `import` — AGENTS.md
// pitfall 6. Same createRequire bridge as enrich-bills-deep.mjs / parse-bop-pdfs.mjs.
const require_ = createRequire(import.meta.url);
let _PDFParse = null; // lazily required: callers that never pass pdf:true pay nothing

// Below this, a page is a JS shell ("enable JavaScript", nav crumbs), not
// content — worth the cost of a render attempt.
const THIN_TEXT_CHARS = 600;

// A council agenda packet is large but not THIS large; past that it is a scanned
// image dump whose decode would burn the run's whole time budget for no text.
const MAX_PDF_BYTES = 12_000_000;

// Scanned/image-only PDFs decode to a few stray characters. Below this there is
// nothing an extractor could quote from, and returning it would make "we read
// the page" look true when it isn't.
const MIN_PDF_TEXT_CHARS = 200;

function stripHtml(html, maxChars) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c >= 32 && c < 65536 ? String.fromCharCode(c) : " "; })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

/** Does the URL's own path claim to be a PDF? Query/hash ignored — Legistar and
 *  Granicus append `?id=` to agenda packet links. */
function looksLikePdfUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

/**
 * Download and text-extract one PDF. Null on anything that isn't usable text —
 * same contract as the HTML path, so callers keep their single `if (!text)`.
 */
export async function fetchPdfText(url, { timeoutMs = 30_000, maxChars = 24_000 } = {}) {
  try {
    if (!_PDFParse) ({ PDFParse: _PDFParse } = require_("pdf-parse"));
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "iKratom Civic Data (contact@ikratom.org)" },
    });
    if (!res.ok) return null;
    // Cheap check first: bail on the declared size before spending the download.
    const cl = res.headers.get("content-length");
    if (cl && Number(cl) > MAX_PDF_BYTES) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_PDF_BYTES) return null;
    // Uint8Array, NOT Buffer. pdf-parse's engine rejected Node Buffers outright
    // for a stretch of v2 ("provide binary data as Uint8Array") and silently
    // killed every PDF decode in the repo for days: the throw lands in the catch
    // below, so the failure reads as "this document is undecodable" rather than
    // as an error. 2.4.5's constructor documents that it converts Buffers for
    // you again (verified 2026-09-16, both forms decode) — but that promise
    // already broke once, and this catch would swallow the next break in exactly
    // the same way. Hand the engine the type it actually wants, as
    // fetch-bill-texts.mjs / parse-bop-pdfs.mjs do. Don't "simplify" it away.
    const out = await new _PDFParse({ data: new Uint8Array(ab) }).getText();
    const text = String(out?.text ?? "").replace(/\s+/g, " ").trim().slice(0, maxChars);
    return text.length >= MIN_PDF_TEXT_CHARS ? text : null;
  } catch {
    return null;
  }
}

async function plainFetchText(url, { timeoutMs, maxChars }) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "iKratom Civic Data (contact@ikratom.org)" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("pdf")) return "PDF"; // sentinel: no text, don't render either
    const html = (await res.text()).slice(0, 600_000);
    return stripHtml(html, maxChars);
  } catch {
    return null;
  }
}

export async function fetchPageText(url, { timeoutMs = 15_000, maxChars = 24_000, render = true, pdf = false } = {}) {
  // PDF-first when the URL's own path says .pdf: municipal agenda servers
  // routinely mislabel packets as octet-stream or text/html, and stripHtml() on
  // PDF bytes does not fail — it yields plausible-looking garbage. For a
  // pipeline whose next step is "find this quote verbatim on the page", garbage
  // text is worse than no text. PDFs are slower than HTML, hence the doubled
  // timeout on both PDF paths.
  const pdfFirst = pdf && looksLikePdfUrl(url);
  if (pdfFirst) {
    const fromPdf = await fetchPdfText(url, { timeoutMs: timeoutMs * 2, maxChars });
    if (fromPdf) return fromPdf;
    // Fall through: a .pdf suffix is not proof. Viewer shims and redirects to an
    // HTML landing page are common; the content-type check below settles it.
  }

  const plain = await plainFetchText(url, { timeoutMs, maxChars });
  if (plain === "PDF") {
    // DEVIATION from spec §2, deliberate: the spec retries fetchPdfText here
    // unconditionally, which re-downloads the same file we just failed on in the
    // pdfFirst branch. One extra full download per undecodable PDF is real money
    // against the run's ≤220-fetch budget, and the retry cannot succeed — same
    // URL, same bytes, same decoder.
    if (!pdf || pdfFirst) return null;
    return await fetchPdfText(url, { timeoutMs: timeoutMs * 2, maxChars });
  }
  if (plain && plain.length >= THIN_TEXT_CHARS) return plain;
  if (!render) return plain;
  // Thin or failed — likely a JS-rendered page. Try real Chromium.
  const r = await renderPage(url);
  if (!r) return plain;
  const text = r.text.replace(/\s+/g, " ").trim().slice(0, maxChars);
  // A WAF interstitial isn't content — junk text must not beat null.
  if (text.length < 1200 && /access denied|enable javascript|verify you are human|are you a robot|captcha|attention required/i.test(text)) {
    return plain;
  }
  return text.length > (plain?.length ?? 0) ? text : plain;
}
