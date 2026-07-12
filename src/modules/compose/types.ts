/** Shared prop shapes for the uniform email composer. */

export type ComposeOfficial = {
  /** legislators.id — null/undefined for non-tracked recipients (stakeholders, local_meta officials) */
  id?: string | null;
  name: string;
  role?: string | null;
  title?: string | null;
  state?: string | null;
  /** Real inbox, or an http(s) contact-form URL (the sync-congress convention), or null */
  email: string | null;
  /** Official site — last-resort contact channel when no inbox/form exists */
  website?: string | null;
};

/**
 * A targetable group of officials for a bill-level send (all Representatives,
 * all Senators, the executive trio). `emailable` = real inbox (to+bcc batch);
 * `formOnly` = webform/website-only officials that can't be batched and are
 * contacted one at a time via the single-official contact-form flow.
 */
export type ComposeGroup = {
  key: "representatives" | "senators" | "executives" | "my_delegation";
  label: string;
  /** Salutation for the batch letter, e.g. "Members of the Michigan House". */
  greeting: string;
  emailable: ComposeOfficial[];
  formOnly: ComposeOfficial[];
};

export type ComposeContext = {
  kind?: "legislator" | "bill" | "stakeholder" | "local";
  billId?: string | null;
  /** Posture toward the bill — shapes the ask (oppose/support/improve). */
  stance?: "oppose" | "support" | "improve" | "neutral" | null;
  /** Extra one-line instruction for this recipient, e.g. a committee chair's
   *  scheduling ask. Woven into the letter + the AI prompt. */
  ask?: string | null;
};
