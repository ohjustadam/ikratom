/**
 * Pure moderation heuristics for the in-admin queue resolver. No I/O.
 * Mirrors the batch janitors' clustering (scripts/lib/topic-key.mjs) and bill
 * terminal-status set (scripts/lib/bill-status.mjs) so the in-site "Auto-resolve"
 * button dedups + judges the SAME way the nightly crons do. Deterministic checks
 * run first (free, instant); only the leftovers go to the grounded AI fact-check.
 */

const KW = /\b(kratom|mitragyna\w*|7-?o?h|gas[- ]?station)\b/i;
const EVENT =
  /\b(ban|restrict|regulat|hearing|schedul|crackdown|ordinance|enact|veto|sign|amend|advance|pass|repeal|reject|warn|classif|control|emergenc|propos|introduc|vote|prohibit|outlaw)/i;

export function normalizeTitle(t: string): string {
  return (t || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Topic-cluster key: `STATE|keyword|event` when both a kratom keyword and an
 * event word parse; otherwise a normalized-title fallback so we only ever
 * collapse TRUE repeats. State-null items cluster under "FED".
 */
export function clusterKey(state: string | null | undefined, title: string): string {
  const t = normalizeTitle(title);
  const kw = (t.match(KW) || [])[1];
  const ev = (t.match(EVENT) || [])[1];
  if (!kw || !ev) return `title:${t}`;
  return `${(state || "FED").toUpperCase()}|${kw}|${ev}`;
}

/** Bill statuses that mean constituent action is moot (dead or already law). */
export const TERMINAL_BILL_STATUSES = new Set(["enacted", "vetoed", "dead", "failed"]);

export function isBillTerminal(status: string | null | undefined): boolean {
  return !!status && TERMINAL_BILL_STATUSES.has(status.toLowerCase());
}
