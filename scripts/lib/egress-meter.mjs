/**
 * egress-meter.mjs — how much Supabase egress did THIS job cost?
 *
 * WHY (2026-10-05). The free plan's 5 GB/month egress cap is the wall that
 * pauses the cron fleet (egress-gate.mjs) and, at 100%, takes the site down.
 * The only meter was the project's total (check-egress-usage.mjs), and the
 * per-request log API was down, so "which job is expensive" was a guess.
 *
 * Preloaded into every cron script by the workflows:
 *   node --import=./scripts/lib/egress-meter.mjs scripts/<job>.mjs
 * It wraps fetch, counts what each response from the Supabase host cost on the
 * wire, and stamps the running total onto the job's own scraper_runs row as
 * `egress_bytes` (migration 0262) — no script needs to change, and a job added
 * later is metered automatically (tests/egress-meter.test.ts guards the wiring).
 *
 * Wire size = response header bytes + body. Supabase gzips JSON and the body
 * arrives decompressed, so an encoded body is re-gzipped here to estimate what
 * crossed the wire (level 6, close to the server's). Approximate by design and
 * slightly high, which is the safe direction for a budget.
 *
 * Never throws and never changes a response: any failure falls back to the
 * plain fetch. The stamp only adds a field to a scraper_runs insert/update.
 */
import zlib from "node:zlib";

const HOST = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").host || null; }
  catch { return null; }
})();

export const meter = { acc: 0, rowBase: 0, total: 0, requests: 0, pending: new Set() };

export function headerBytes(headers) {
  let n = 17; // status line
  for (const [k, v] of headers) n += k.length + v.length + 4;
  return n;
}

export function bodyWireBytes(buf, encoded) {
  if (!encoded || buf.byteLength === 0) return buf.byteLength;
  return zlib.gzipSync(Buffer.from(buf), { level: 6 }).length;
}

/** Add egress_bytes to a scraper_runs write. POST = a new row; PATCH = the same row, updated. */
export function stamp(body, method, url) {
  const parsed = JSON.parse(body);
  const row = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!row || typeof row !== "object" || "egress_bytes" in row) return { body, url };
  if (method === "POST") {
    row.egress_bytes = Math.round(meter.acc);
    meter.rowBase = meter.acc;
    meter.acc = 0;
  } else {
    row.egress_bytes = Math.round(meter.rowBase + meter.acc);
  }
  // postgrest-js lists an array insert's columns in ?columns=; a key added
  // after that would be dropped silently.
  if (Array.isArray(parsed) && url.searchParams.has("columns")) {
    url.searchParams.set("columns", `${url.searchParams.get("columns")},"egress_bytes"`);
  }
  return { body: JSON.stringify(parsed), url };
}

async function settle() {
  if (!meter.pending.size) return;
  await Promise.race([Promise.allSettled([...meter.pending]), new Promise((r) => setTimeout(r, 3000))]);
}

function count(res) {
  const encoded = /gzip|br|deflate/i.test(res.headers.get("content-encoding") ?? "");
  meter.requests++;
  const add = (n) => { meter.acc += n; meter.total += n; };
  add(headerBytes(res.headers));
  if (!res.body) return;
  const p = res.clone().arrayBuffer()
    .then((buf) => add(bodyWireBytes(buf, encoded)))
    .catch(() => {})
    .finally(() => meter.pending.delete(p));
  meter.pending.add(p);
}

if (HOST && typeof globalThis.fetch === "function" && !globalThis.__egressMeter) {
  globalThis.__egressMeter = meter;
  const plain = globalThis.fetch;
  globalThis.fetch = async function meteredFetch(input, init) {
    let url;
    try { url = new URL(typeof input === "string" || input instanceof URL ? input : input.url); }
    catch { return plain(input, init); }
    if (url.host !== HOST) return plain(input, init);

    const method = String(init?.method ?? "GET").toUpperCase();
    if (url.pathname === "/rest/v1/scraper_runs" && (method === "POST" || method === "PATCH") && typeof init?.body === "string") {
      try {
        await settle();
        const s = stamp(init.body, method, url);
        init = { ...init, body: s.body };
        input = typeof input === "string" ? s.url.toString() : input instanceof URL ? s.url : input;
      } catch { /* unparseable body: send it untouched */ }
    }
    const res = await plain(input, init);
    try { count(res); } catch { /* metering must never break a job */ }
    return res;
  };
  process.on("exit", () => {
    if (meter.total > 0) console.log(`[egress-meter] ${(meter.total / 1048576).toFixed(2)} MB from Supabase in ${meter.requests} requests`);
  });
}
