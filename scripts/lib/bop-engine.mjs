/**
 * BoP (Board of Pharmacy) scraper engine.
 *
 * Walks `bop_sources` rows with enabled=true, calls the matching
 * adapter (per `source.adapter`), and persists results into
 * `bop_findings`. Idempotent — the (source_id, dedupe_key) unique
 * index drops re-runs to no-ops.
 *
 * Adapter contract:
 *   import { scrape } from "./bop-adapters/<key>.mjs";
 *   const findings = await scrape({ source });
 *   // findings: { title, snippet?, url?, meeting_date?, raw? }[]
 *
 * The engine itself does the keyword classification + DB writes — the
 * adapter only has to produce raw findings. This keeps adapters tiny.
 */

// Keyword bank for first-pass classification. Tuned for high recall —
// we'd rather over-flag and triage manually than miss a hostile rule
// proposal. Admin can mark borderline cases "unrelated" via the UI.
//
// CAREFUL: the original 7-OH alternative had every sub-group optional
// (`7-?(?:hydroxy)?(?:mitragynine)?`) which collapsed to "any 7
// followed by optional dash" — so titles like "June 7-8, 2006"
// classified as kratom_direct. The fix below makes the OH/hydroxy
// part REQUIRED in the 7-OH branches.
const DIRECT_RE =
  /\b(kratom|mitragyna\w*|7\s*-?\s*OH\b|7\s*-?\s*hydroxy(?:mitragynine)?)\b/i;
const ADJACENT_RE =
  /\b(novel\s+psychoactive|emerging\s+substance|schedule\s+[IVX]+\b|controlled\s+substance|"botanical")\b/i;
const HOSTILE_RE =
  /\b(ban|prohibit|schedule\s+[IVX]+|add\s+to\s+schedule|controlled|adulterated|emergency\s+rule)\b/i;
const SUPPORTIVE_RE =
  /\b(consumer\s+protection|labeling|age\s+limit|standards|kcpa)\b/i;

function classify(textParts) {
  const text = textParts.filter(Boolean).join(" ");
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

async function loadAdapter(name) {
  // Adapters live in scripts/lib/bop-adapters/<name>.mjs. Dynamic
  // import so adding an adapter doesn't require touching this file.
  try {
    const mod = await import(`./bop-adapters/${name}.mjs`);
    if (typeof mod.scrape !== "function") {
      throw new Error(`Adapter "${name}" does not export a scrape function`);
    }
    return mod;
  } catch (e) {
    throw new Error(`Failed to load adapter "${name}": ${e?.message ?? e}`);
  }
}

/**
 * Walk one source and persist its findings. Internal — called by
 * runBopEngine and by the admin "Scrape now" action.
 */
async function scrapeOne({ source, supabase }) {
  const startedAt = new Date();
  try {
    const adapter = await loadAdapter(source.adapter);
    const raw = await adapter.scrape({ source });
    const items = (Array.isArray(raw) ? raw : []).filter(
      (i) => i && typeof i.title === "string" && i.title.trim().length > 0
    );

    const rows = items.map((item) => {
      const { relevance, severity } = classify([item.title, item.snippet ?? ""]);
      return {
        source_id: source.id,
        state: source.state,
        title: String(item.title).slice(0, 500).trim(),
        snippet: item.snippet ? String(item.snippet).slice(0, 2000) : null,
        url: item.url ? String(item.url).slice(0, 1000) : null,
        meeting_date: item.meeting_date ?? null,
        classified_relevance: relevance,
        classified_severity: severity,
        raw: item.raw ?? null,
      };
    });

    let inserted = 0;
    if (rows.length > 0) {
      const { data, error: insErr } = await supabase
        .from("bop_findings")
        .upsert(rows, { onConflict: "source_id,dedupe_key", ignoreDuplicates: true })
        .select("id");
      if (insErr) throw new Error(`bop_findings insert failed: ${insErr.message}`);
      inserted = data?.length ?? 0;
    }

    await supabase.from("bop_sources").update({
      last_scraped_at: startedAt.toISOString(),
      last_status: inserted > 0 ? "ok" : "no_findings",
      last_error: null,
      last_finding_count: inserted,
    }).eq("id", source.id);

    return {
      source: source.board_name,
      state: source.state,
      status: inserted > 0 ? "ok" : "no_findings",
      inserted,
    };
  } catch (e) {
    const msg = String(e?.message ?? e).slice(0, 500);
    await supabase.from("bop_sources").update({
      last_scraped_at: startedAt.toISOString(),
      last_status: "error",
      last_error: msg,
    }).eq("id", source.id);
    return {
      source: source.board_name,
      state: source.state,
      status: "error",
      error: msg,
    };
  }
}

/**
 * Walk all enabled sources, scrape, persist findings.
 * Concurrency is intentional — 50+ states sequentially would blow
 * the Vercel function budget. Each source is fully independent
 * (own URL, own DB writes) so parallelizing is safe.
 *
 * Default concurrency 8 keeps us polite (no single state's gov
 * server sees >1 connection from us) and well under any reasonable
 * outbound-fetch budget.
 *
 * Options:
 *   excludeAdapters: skip sources whose adapter is in this list.
 *     Vercel cron passes ['playwright_browser'] since serverless
 *     can't launch Chromium.
 *   onlyAdapters: opposite — only walk sources using these adapters.
 *     The GitHub Actions browser job passes ['playwright_browser']
 *     so it just picks up the TLS-blocked sites.
 */
export async function runBopEngine({
  supabase,
  limit = 75,
  concurrency = 8,
  excludeAdapters = [],
  onlyAdapters = null,
} = {}) {
  let q = supabase
    .from("bop_sources")
    .select("*")
    .eq("enabled", true)
    .order("last_scraped_at", { ascending: true, nullsFirst: true });
  if (onlyAdapters && onlyAdapters.length > 0) {
    q = q.in("adapter", onlyAdapters);
  } else if (excludeAdapters.length > 0) {
    q = q.not("adapter", "in", `(${excludeAdapters.map((a) => `"${a}"`).join(",")})`);
  }
  q = q.limit(limit);

  const { data: sources, error } = await q;
  if (error) throw new Error(`bop_sources read failed: ${error.message}`);

  const queue = [...(sources ?? [])];
  const results = [];
  // If any of the sources use the playwright adapter, pre-warm it once
  // up front so subsequent scrapes reuse the browser instance.
  const usesPlaywright = (sources ?? []).some(
    (s) => s.adapter === "playwright_browser"
  );
  if (usesPlaywright) {
    try {
      const pw = await import("./bop-adapters/playwright_browser.mjs");
      await pw.preWarmBrowser();
    } catch (e) {
      // If playwright isn't installed (e.g. someone enabled a
      // playwright source on a non-CI environment), each affected
      // scrape will fail with a clear error from the adapter and the
      // other generic_html sources will still run.
      void e;
    }
  }
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const source = queue.shift();
        if (!source) return;
        const r = await scrapeOne({ source, supabase });
        results.push(r);
      }
    })
  );
  if (usesPlaywright) {
    try {
      const pw = await import("./bop-adapters/playwright_browser.mjs");
      await pw.closeBrowser();
    } catch { /* best-effort */ }
  }
  return results;
}

// Re-export classify so tests / one-off scripts can use it.
export { classify as classifyBopText };
