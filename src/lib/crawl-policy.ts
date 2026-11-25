/**
 * crawl-policy.ts — the single source of truth for what crawlers are invited to.
 *
 * WHY THIS EXISTS (2026-09-18). robots.txt and sitemap.xml are two halves of one
 * decision, and they were drifting apart. robots.ts disallowed sixteen
 * high-cardinality prefixes while sitemap.ts advertised pages it forbade.
 * Advertising a URL you also forbid is incoherent in both directions: a
 * compliant crawler ignores the sitemap entry, and a non-compliant one takes the
 * invitation. Both files now read the policy from this module, so the sitemap
 * cannot advertise what robots forbids.
 *
 * STAGED SWITCH (2026-11-24, replaces the 2027-01-16 self-lifting date).
 * The block used to lift ALL sixteen families at once on a code date. That is
 * the wrong shape for two reasons:
 *   - Some families should never lift: member content (/forum, /coalitions,
 *     /profile, /i) cannot be pulled back out of a search index, and /alerts and
 *     /campaigns are thin, perishable and high-cardinality.
 *   - A lift needs a brake that works without a deploy. A deploy is 15 Netlify
 *     credits, and Google caches robots.txt for about a day.
 * So the lift is now a stage number, `site_config.crawl_stage`, read by
 * robots.ts and sitemap.ts (src/lib/crawl-stage.ts). It defaults to 0, which is
 * exactly the old blocked list, and anything unreadable also means 0. Only a
 * human raises it (`scripts/crawl-stage.mjs set <n>`). The hourly
 * `crawl_brake` job (scripts/crawl-brake.mjs) can only LOWER it, to 0, when the
 * credit meter says the crawl is costing too much. Runbook:
 * docs/RUNBOOK_crawl_lift.md.
 */

/** Highest stage. Each stage lifts the families listed under it, plus those below. */
export const CRAWL_STAGE_MAX = 3;

/**
 * Families lifted at each stage. Ordered by value per credit: bills and papers
 * answer the searches nobody owns ("what is TN HB 1649?", "kratom research"),
 * and their reads go through R2 snapshots / unstable_cache.
 *   1 — bills + research        2 — legislators + briefings
 *   3 — library + topics (render per viewer in places; check before raising)
 */
export const CRAWL_STAGES: Record<1 | 2 | 3, readonly string[]> = {
  1: ["/research/", "/bills/"],
  2: ["/legislators/", "/briefings/"],
  3: ["/library/", "/topics/"],
};

/**
 * Never lifted by the stage flag. Changing this list is a deliberate edit with a
 * reason, not a number someone types at a prompt.
 *   /forum /coalitions /profile /i /partners /meetings — member-written or
 *       member-linked content; once indexed or cached it cannot be recalled
 *       (public anonymity, CLAUDE.md).
 *   /alerts /campaigns — thousands of thin pages that expire (a campaign for a
 *       dead bill still reads as live); every hit is a live render.
 *   /intel /academy — admin or per-viewer sections render per request.
 */
export const NEVER_LIFTED_PATHS = [
  "/alerts/",
  "/campaigns/",
  "/forum/",
  "/meetings/",
  "/coalitions/",
  "/intel/",
  "/academy/",
  "/partners/",
  "/profile/",
  "/i/",
] as const;

/**
 * Private surfaces — never indexed, never advertised, at any stage. These are
 * not cost control.
 */
export const PRIVATE_PATHS = [
  "/admin/",
  "/api/",
  "/account/",
  "/messages/",
  "/dashboard/",
  "/pitch",
] as const;

/** Every staged family, in stage order. The Cloudflare brake covers exactly these. */
export const STAGED_PATHS: readonly string[] = [
  ...CRAWL_STAGES[1],
  ...CRAWL_STAGES[2],
  ...CRAWL_STAGES[3],
];

/**
 * Every cost-control prefix: what is blocked at stage 0.
 *
 * NOTE THE TRAILING SLASHES, and what they do NOT cover: "/campaigns/" blocks
 * /campaigns/<slug> but leaves /campaigns itself crawlable. That is deliberate
 * for the index pages that are genuinely cheap (/campaigns is ISR 900s, /news
 * is 1800s, the state hubs are SSG).
 */
export const COST_CONTROL_PATHS: readonly string[] = [...STAGED_PATHS, ...NEVER_LIFTED_PATHS];

/**
 * Review date, not an expiry. Nothing lifts on this date any more; a test goes
 * red two weeks before it (tests/robots-cost-control.test.ts) so somebody looks
 * at the stage, the credit meter and this file and decides, instead of a number
 * sitting at 0 or 1 for a year because nobody remembered it was there.
 * A cycle boundary, past the owner's 60-day-untouched window (2027-01-16).
 */
export const CRAWL_POLICY_REVIEW_BY = Date.UTC(2027, 0, 16);

/** Anything that is not a whole number from 0 to CRAWL_STAGE_MAX is stage 0 (fail closed). */
export function normalizeStage(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return 0;
  return n >= 0 && n <= CRAWL_STAGE_MAX ? n : 0;
}

/** Everything robots.txt disallows at this stage. */
export function disallowedPaths(stage: unknown = 0): string[] {
  const s = normalizeStage(stage);
  const stillBlocked = ([1, 2, 3] as const).filter((n) => n > s).flatMap((n) => [...CRAWL_STAGES[n]]);
  return [...PRIVATE_PATHS, ...stillBlocked, ...NEVER_LIFTED_PATHS];
}

/**
 * Does robots.txt forbid this URL at this stage?
 *
 * Accepts an absolute URL or a bare path; anything unparseable is treated as
 * NOT disallowed, so a malformed entry fails toward being advertised rather
 * than silently disappearing from the sitemap.
 */
export function isDisallowed(urlOrPath: string, stage: unknown = 0): boolean {
  let pathname = urlOrPath;
  if (/^https?:\/\//i.test(urlOrPath)) {
    try { pathname = new URL(urlOrPath).pathname; } catch { return false; }
  }
  return disallowedPaths(stage).some((p) => pathname.startsWith(p));
}
