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
// A national action (FDA/DEA/HHS/…) is ONE story even when 20 outlets run it and
// the per-outlet RSS mis-tags it to the outlet's home state. Collapse those.
const FED_SIGNAL = /\b(fda|dea|doj|hhs|justice department|congress(?:ional)?|nationwide|federal government|controlled substances act)\b/i;
// Trailing " - Publisher" / " | Publisher" / " – Publisher" — the same headline
// from WIRED, The Hill, FOX21… differs only by this suffix; strip before keying.
const OUTLET_SUFFIX = /\s+[-–—|]\s+[^-–—|]{2,45}$/;

export function normalizeTitle(t: string): string {
  return (t || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function coarseFederalEvent(raw: string): string | null {
  // Distinct pro-kratom / event TYPES first so "move to repeal the ban" doesn't
  // collapse into the anti-kratom "restrict" bucket. Mirrors topic-key.mjs.
  if (/\brepeal/i.test(raw)) return "repeal";
  if (/\bveto/i.test(raw)) return "veto";
  if (/\bhearing/i.test(raw)) return "hearing";
  if (/\b(ban|restrict|schedul|classif|prohibit|crackdown|control|outlaw|seeks? to|moves? to|recommend|urges?|pushes?)/i.test(raw)) return "restrict";
  return null;
}

/**
 * Topic-cluster key used to collapse duplicates before we act on a queue.
 * Order (broadest signal first):
 *   1. FEDERAL story (kratom + FDA/DEA/HHS/nationwide signal) → one coarse
 *      `fed|kratom|<event>` bucket REGARDLESS of the (often mis-tagged) state —
 *      this is what was letting the DEA 7-OH story approve once per outlet.
 *   2. `STATE|keyword|event` when both parse (after stripping the outlet suffix).
 *   3. normalized-title fallback (outlet stripped) so only TRUE repeats collapse.
 * Mirrors scripts/lib/topic-key.mjs (federalTopicKey + normalizedTitleKey).
 */
export function clusterKey(state: string | null | undefined, title: string): string {
  const raw = String(title || "");
  if (KW.test(raw) && FED_SIGNAL.test(raw)) {
    const ev = coarseFederalEvent(raw);
    if (ev) return `fed|kratom|${ev}`;
  }
  const t = normalizeTitle(raw.replace(OUTLET_SUFFIX, ""));
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
