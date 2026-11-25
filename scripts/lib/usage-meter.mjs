// usage-meter.mjs — the ONE place that knows which host's usage meter the crawl
// brake and the crawl-stage tool read. Everything downstream (evaluateBrake,
// liftAllowed in scripts/lib/crawl-brake.mjs) takes one shape and never names a host:
//
//   { ok: boolean, reason?: string, total: number, used: number,
//     daily: [{ date: "YYYY-MM-DD", total: number, passive: number }] }
//
// `daily` is oldest first, the last entry is today (partial), and `passive`
// excludes the cost of our own deploys. `total` and `used` are in the host's own
// unit for the period (Netlify: credits per month).
//
// WHY (2026-11-25, owner: "make it easy when we do move hosts"). The brake that
// stops a crawl lift from eating the month was wired straight to Netlify's credit
// reader in two scripts. A host move would have left it blind (and paging) on day
// one. Now a move is: write one adapter below, set HOST_METER, done. Until then a
// host with no adapter reads as BLIND, which the brake already handles loudly (it
// pages on the third blind run), never as "all clear".
//
// To add a host (docs/RUNBOOK_host_move.md, step 6): add a key to ADAPTERS that
// returns the shape above, then set HOST_METER=<key> in GitHub Actions + .env.local.
import { readTrueCredits } from "./netlify-credits.mjs";

export const ADAPTERS = {
  netlify: () => readTrueCredits({
    token: process.env.NETLIFY_AUTH_TOKEN,
    accountSlug: process.env.NETLIFY_ACCOUNT_SLUG || "ohjustadam",
  }),
};

export const meterName = () => (process.env.HOST_METER || "netlify").trim().toLowerCase();

/** @returns {Promise<{ ok: boolean, reason?: string, total?: number, used?: number, daily?: any[] }>} */
export async function readUsageMeter() {
  const name = meterName();
  const adapter = ADAPTERS[name];
  if (!adapter) return { ok: false, reason: `no usage meter for host "${name}" (add an adapter in scripts/lib/usage-meter.mjs, then set HOST_METER)` };
  try {
    return await adapter();
  } catch (e) {
    return { ok: false, reason: `usage meter "${name}" threw: ${String(e?.message ?? e).slice(0, 120)}` };
  }
}
