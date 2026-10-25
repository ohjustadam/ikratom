import type { Stance } from "./legislator-action-plan";

/**
 * Champion / sympathetic / hostile labels on NAMED officials are retired
 * (trunk call 2026-10-25, applying the owner's standing decision from #813:
 * a strictly neutral tracker, never an ally/opponent label, never an
 * unreviewed stance on a named legislator; memory stance-neutral-tracker-decision).
 *
 * Why: every kratom row in legislator_stance (migration 0221) was written by
 * the AI drafter (scripts/draft-legislator-stance.mjs; last_updated_by is
 * null on all of them), and effectiveStance() turned "sponsored a bill the AI
 * tagged anti" into "hostile". Neither is a reviewed fact.
 *
 * What stays: the table and its data (admin review at /admin/stance still
 * reads them), and the official kratom record: bills sponsored and recorded
 * votes, on the natural-leaf and 7-OH axes (src/lib/kratom-record.ts).
 *
 * Every member-facing reader passes a stance through publishedStance(), so
 * this one switch decides what is shown. Turning it back on needs a human
 * review path first.
 */
export const STANCE_LABELS_RETIRED: boolean = true;

const KNOWN = new Set(["champion", "sympathetic", "neutral", "hostile"]);

/** The stance a member-facing surface may show: "unknown" while labels are retired. */
export function publishedStance(raw: string | null | undefined): Stance {
  if (STANCE_LABELS_RETIRED) return "unknown";
  return (raw && KNOWN.has(raw) ? raw : "unknown") as Stance;
}
