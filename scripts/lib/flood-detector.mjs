// flood-detector.mjs — pure spike detection over Cloudflare origin-seconds.
//
// WHY (2026-11-11): a residential-proxy crawl (1,171 IPs, max 25 req/IP, 2023
// Chrome/Firefox UAs) cost 5,105 origin-seconds in 13:30-13:40Z. The same
// crawler has hit ~13:00-13:40Z on 6 of the last 7 days (11-05 3,909s,
// 11-06 2,435s, 11-07 1,531s, 11-08 1,717s, 11-09 2,425s per 5 min).
// Normal 5-min bucket: p50 14s, p99 132s, worst non-flood 363s.
// Normal hour: p50 243s, p90 476s, worst non-flood 774s.
//
// origin-seconds = sum{originResponseDurationMs} over requests that REACHED the
// origin (originResponseDurationMs_gt:0). Do NOT use count(all) x avg: that
// counts challenged/cached requests too and read 15,526 for the 11-11 hour.
//
// Thresholds are clamp(floor, k x robust percentile of the last 7 days, ceiling).
// Percentiles (not mean/sigma) so the daily floods in the baseline don't raise
// the bar; the CEILING so a baseline poisoned by a week of floods can never
// silence the alarm (guards must guard themselves).
export const STEP_MS = 5 * 60_000;
export const DEFAULTS = {
  // Ceilings ~2.5-3x the worst normal bucket (363s) and hour (774s). A 1,500
  // ceiling let the baseline that held the 11-03 crawl lift the bar to 1,500
  // and nearly hide the 11-07 (1,531s) burst.
  bucketK: 5, bucketPct: 0.99, bucketFloor: 600, bucketCeil: 900,
  hourK: 3, hourPct: 0.9, hourFloor: 1500, hourCeil: 2400,
};

export const floor5 = (ms) => Math.floor(ms / STEP_MS) * STEP_MS;

export function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** Dense 5-min grid [{t, sec}] from sparse rows (Cloudflare omits empty buckets). */
export function densify(rows, fromMs, toMs) {
  const by = new Map(rows.map((r) => [floor5(Date.parse(r.t)), r.sec]));
  const out = [];
  for (let t = floor5(fromMs); t < toMs; t += STEP_MS) out.push({ t, sec: by.get(t) ?? 0 });
  return out;
}

const rolling12 = (grid) => grid.map((_, i) =>
  i < 11 ? null : grid.slice(i - 11, i + 1).reduce((s, b) => s + b.sec, 0));
const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));

export function thresholds(baselineGrid, o = DEFAULTS) {
  const bucketBase = percentile(baselineGrid.map((b) => b.sec), o.bucketPct);
  const hourBase = percentile(rolling12(baselineGrid).filter((v) => v != null), o.hourPct);
  return {
    bucketBase, hourBase,
    bucket: clamp(o.bucketFloor, o.bucketK * bucketBase, o.bucketCeil),
    hour: clamp(o.hourFloor, o.hourK * hourBase, o.hourCeil),
  };
}

/**
 * grid = baseline buckets followed by the scan buckets (dense, ascending);
 * scanFromMs marks where the scan starts. Returns firing bursts in the scan.
 */
export function detect(grid, scanFromMs, o = DEFAULTS) {
  const baseline = grid.filter((b) => b.t < scanFromMs);
  const th = thresholds(baseline, o);
  const roll = rolling12(grid);
  const hits = [];
  grid.forEach((b, i) => {
    if (b.t < scanFromMs) return;
    const bucketHit = b.sec > th.bucket;
    // A bucket joins an hour-rule burst only if it carries its share of the
    // hourly limit; otherwise the quiet buckets after a spike stay "in" the
    // rolling hour for 55 minutes and stretch the reported window.
    const hourHit = roll[i] != null && roll[i] > th.hour && b.sec > th.hour / 12;
    if (bucketHit || hourHit) hits.push({ t: b.t, sec: b.sec, hour: roll[i], bucketHit, hourHit });
  });
  // Merge adjacent firing buckets into bursts.
  const bursts = [];
  for (const h of hits) {
    const last = bursts.at(-1);
    if (last && h.t - last.end <= 0) { last.end = h.t + STEP_MS; last.sec += h.sec; last.peak = Math.max(last.peak, h.sec); last.peakHour = Math.max(last.peakHour, h.hour ?? 0); }
    else bursts.push({ start: h.t, end: h.t + STEP_MS, sec: h.sec, peak: h.sec, peakHour: h.hour ?? 0 });
  }
  const scanned = grid.filter((b) => b.t >= scanFromMs);
  const avgDaySec = baseline.length ? (baseline.reduce((s, b) => s + b.sec, 0) * 288) / baseline.length : 0;
  return { thresholds: th, bursts, avgDaySec, scanSec: scanned.reduce((s, b) => s + b.sec, 0), maxBucket: Math.max(0, ...scanned.map((b) => b.sec)) };
}

/** Self-healing scan window: everything since the last scan, at least 1h, at most 24h. */
export function planScan(lastScannedToIso, nowMs) {
  const to = floor5(nowMs - STEP_MS); // newest complete bucket, Cloudflare lags a few minutes
  const last = lastScannedToIso ? Date.parse(lastScannedToIso) : NaN;
  let from = Number.isFinite(last) ? floor5(last) : to - 3600e3;
  from = Math.min(from, to - 3600e3);
  from = Math.max(from, to - 24 * 3600e3);
  return { from, to };
}

/** /legislators/abc-123/briefing -> /legislators/*\/briefing */
export function pathFamily(p) {
  const segs = String(p || "/").split("?")[0].split("/").filter(Boolean);
  if (segs[0] === "cdn-cgi") return "/cdn-cgi/* (Cloudflare)";
  return "/" + segs.slice(0, 3).map((s, i) => (i > 0 && /[0-9]/.test(s) ? "*" : s)).join("/");
}

export function rollupPaths(rows, top = 5) {
  const m = new Map();
  for (const r of rows) {
    const f = pathFamily(r.path);
    const e = m.get(f) ?? { family: f, n: 0, sec: 0, distinct: 0 };
    e.n += r.n; e.sec += r.sec ?? 0; e.distinct++;
    m.set(f, e);
  }
  return [...m.values()].sort((a, b) => b.sec - a.sec || b.n - a.n).slice(0, top);
}

/** "Mozilla/5.0 (Windows NT 10.0; ...) ... Firefox/121.0" -> "Firefox/121 Windows" */
export function shortUA(ua) {
  const s = String(ua || "");
  const b = s.match(/(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/);
  const os = (s.match(/Windows|Mac OS X|Android|iPhone|iPad|CrOS|Linux/) || ["?"])[0].replace("Mac OS X", "Mac");
  if (!b) return s.slice(0, 60) || "(none)";
  const name = b[1] === "Version" ? "Safari" : b[1] === "Edg" ? "Edge" : b[1] === "OPR" ? "Opera" : b[1];
  return `${name}/${b[2]} ${os}`;
}

// securityAction "unknown" = no rule acted. Anything that challenged or blocked counts.
export function challengedShare(rows) {
  const total = rows.reduce((s, r) => s + r.n, 0);
  const hit = rows.filter((r) => /challenge|block|close|drop/i.test(r.action) && !/solved|bypass|skip/i.test(r.action))
    .reduce((s, r) => s + r.n, 0);
  return total ? hit / total : 0;
}
