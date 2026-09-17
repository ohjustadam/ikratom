#!/usr/bin/env node
/**
 * diagnose-cloud-gaps.mjs — prove, from a real GitHub Actions runner, whether
 * the two remaining "owner box only" jobs can move to the cloud.
 *
 * Both registry sources marked `system: "local-box"` in cron-pager-registry.mjs
 * are there for an assumption, not a law:
 *
 *   topic_bill_discovery — LegiScan's getSearch QUERY api was observed to refuse
 *     GitHub Actions datacenter IPs (6/6 connect timeouts, two dispatches). The
 *     getDataset ZIP path works from CI because it is served from a CDN. Probe A
 *     re-measures both from the runner so the claim is evidence, not folklore.
 *
 *   bill_embeddings — compute-bill-embeddings.mjs calls a LOCAL Ollama for
 *     nomic-embed-text (768-dim). Probe B asks every free-tier provider whose
 *     key is already a repo secret whether it will serve an embedding, and at
 *     what dimensionality, so the job can move to a cloud provider instead.
 *
 * Read-only. Touches no database and writes no scraper_runs row — it is a
 * measurement, not a job. Safe to dispatch at any time.
 *
 *   node --env-file=.env.local scripts/diagnose-cloud-gaps.mjs
 *   node scripts/diagnose-cloud-gaps.mjs --only=embed
 *   node scripts/diagnose-cloud-gaps.mjs --only=embed --burst=40
 */

import { EMBED_PROVIDERS, embedWith } from "./lib/embed-router.mjs";

const args = process.argv.slice(2);
const opt = (n) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : null; };
const ONLY = opt("only"); // 'legiscan' | 'embed'
const BURST = parseInt(opt("burst") || "0", 10);

const SAMPLE = "An act relating to kratom; providing for the regulation of kratom products; establishing labeling and age restrictions; providing penalties.";

function line(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(34)} ${detail}`);
}

// ─── Probe A: LegiScan from this IP ──────────────────────────────────────
async function probeLegiscan() {
  console.log("\n=== A. LegiScan reachability from this runner ===");
  const key = process.env.LEGISCAN_API_KEY;
  if (!key) { console.log("  SKIP  LEGISCAN_API_KEY not set"); return; }

  // getDatasetList is the CDN-backed path the kratom sync already uses from CI.
  // It is the CONTROL: if this fails too, the problem is the network, not the
  // query API specifically.
  const cases = [
    ["getDatasetList (control, CDN)", `op=getDatasetList&state=OK`],
    ["getSearch attempt 1", `op=getSearch&state=ALL&query=${encodeURIComponent("kratom")}&page=1`],
    ["getSearch attempt 2", `op=getSearch&state=ALL&query=${encodeURIComponent("cannabis regulation")}&page=1`],
    ["getSearch attempt 3", `op=getSearch&state=ALL&query=${encodeURIComponent("hemp derived")}&page=1`],
  ];

  for (const [label, qs] of cases) {
    const t0 = Date.now();
    try {
      const res = await fetch(`https://api.legiscan.com/?key=${key}&${qs}`, {
        signal: AbortSignal.timeout(20_000),
      });
      const ms = Date.now() - t0;
      const json = await res.json().catch(() => null);
      const status = json?.status ?? `http ${res.status}`;
      const rows = json?.searchresult
        ? Object.keys(json.searchresult).filter((k) => k !== "summary").length
        : json?.datasetlist?.length;
      line(label, status === "OK", `${status} in ${ms}ms${rows != null ? `, ${rows} rows` : ""}`);
    } catch (e) {
      line(label, false, `${String(e?.name ?? "")} ${String(e?.message ?? e).slice(0, 90)} after ${Date.now() - t0}ms`);
    }
  }
}

// ─── Probe B: who will serve an embedding, and at what dimension ─────────
async function probeEmbeddings() {
  console.log("\n=== B. Free-tier embedding providers ===");
  console.log(`  today: 768 dims from nomic-embed-text. Width is a free choice —\n  the column is jsonb and cosine runs in JS — but the whole corpus must share one model.\n`);
  for (const p of EMBED_PROVIDERS) {
    if (!p.configured()) { console.log(`  SKIP  ${p.id.padEnd(34)} no key set`); continue; }
    const t0 = Date.now();
    try {
      const vec = await embedWith(p.id, SAMPLE);
      const ms = Date.now() - t0;
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      // PASS means "this provider will serve us a vector". Width is reported,
      // not judged: the corpus is jsonb + JS cosine, so any consistent width
      // works — see the note in embed-router.mjs.
      line(`${p.id} (${p.model})`, true, `${vec.length} dims, |v|=${norm.toFixed(3)}, ${ms}ms`);
    } catch (e) {
      line(`${p.id} (${p.model})`, false, String(e?.message ?? e).slice(0, 100));
    }
  }
}

// ─── Probe C: can a provider actually carry a corpus re-embed? ──────────
//
// A single successful call proves a key works. It does NOT prove the provider
// will serve ~550 sequential calls, which is what switching the corpus costs.
// That difference matters because a re-embed that dies halfway leaves the
// corpus half one model and half another, and the start-of-run interlock in
// compute-bill-embeddings.mjs cannot catch damage done after it ran.
//
// It also answers a question a single call cannot: whether the embedding
// endpoint has quota SEPARATE from the chat quota. On 2026-09-17 the chat pool
// was returning 429 across every provider while mistral-embed answered in
// 306ms, which suggests separate budgets — this measures it instead.
async function probeBurst(n) {
  console.log(`\n=== C. Sustained burst: ${n} sequential calls per provider ===`);
  for (const p of EMBED_PROVIDERS) {
    if (!p.configured()) continue;
    let ok = 0, throttled = 0, other = 0, firstErr = null;
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      try {
        await embedWith(p.id, `${SAMPLE} (call ${i})`);
        ok++;
      } catch (e) {
        const msg = String(e?.message ?? e);
        if (/\b429\b|rate.?limit|capacity/i.test(msg)) throttled++;
        else other++;
        firstErr ??= msg.slice(0, 80);
      }
    }
    const ms = Date.now() - t0;
    if (ok === 0 && throttled === 0 && other === n) continue; // never reachable; skip noise
    const detail = `${ok}/${n} ok, ${throttled} throttled, ${other} other, ${(ms / n).toFixed(0)}ms/call${firstErr ? ` — ${firstErr}` : ""}`;
    line(`${p.id} burst`, ok === n, detail);
  }
  console.log(`\n  A provider that cannot finish ${n} in a row cannot carry a corpus re-embed.`);
}

if (!ONLY || ONLY === "legiscan") await probeLegiscan();
if (!ONLY || ONLY === "embed") await probeEmbeddings();
if (BURST > 0) await probeBurst(BURST);
console.log("");
