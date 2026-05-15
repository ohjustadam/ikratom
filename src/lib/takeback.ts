/**
 * Pure helpers for the takeback intel rendering.
 *
 * Extracted from src/app/takeback/page.tsx so they're independently
 * testable + reusable on other surfaces (e.g. the /states/[code]
 * takeback badge, or a future /opponents page).
 *
 * All functions in this module are pure — no Supabase, no React, no
 * environment access.
 */

/** Type for the subset of `bills` columns the takeback helpers care about. */
export type TakebackBillSlice = {
  state: string;
  bill_number: string;
  status: string | null;
  opposition_summary_md: string | null;
};

/**
 * Extract the sponsor/mechanism line from opposition_summary_md.
 *
 * The seed in `scripts/seed-banned-state-takeback.mjs` writes each
 * state's content with one of two leading bolded blocks:
 *   - "**Sponsor + push**: ..."     for statutory bans (AL/IN/WI/TN)
 *   - "**Mechanism**: ..."          for admin-rule bans (AR/RI/VT)
 *
 * Captures everything up to the first newline (NOT the first period),
 * then truncates to ~220 chars with ellipsis. The previous regex
 * `[^.\\n]{10,180}` rejected the seed text because it always begins
 * with "Sen." or "Rep." which contain periods.
 *
 * Falls back to "—" when the markdown is missing or doesn't match.
 */
export function extractSponsor(md: string | null, max = 220): string {
  if (!md) return "—";
  const m = md.match(/\*\*Sponsor \+ push\*\*:\s*([^\n]{10,})/i)
    ?? md.match(/\*\*Mechanism\*\*:\s*([^\n]{10,})/i);
  if (!m?.[1]) return "—";
  const trimmed = m[1].trim();
  return trimmed.length > max ? trimmed.slice(0, max) + "…" : trimmed;
}

/**
 * First-paragraph plain-text extract from a markdown blob.
 *
 * Strips bold/italic syntax + newlines for compact card display. Caps at
 * `max` chars with an ellipsis. Returns "" for null/empty input.
 */
export function extractBlurb(md: string | null, max = 240): string {
  if (!md) return "";
  const firstPara = md.split(/\n\s*\n/)[0] ?? "";
  const plain = firstPara
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\n+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

/**
 * Classify a bill's repeal path based on its identifier + status.
 *
 * Returns a structured object with:
 *   - `label`: short tag for the badge
 *   - `cls`:   Tailwind border + bg + text classes
 *   - `note`:  one-line explanation
 *
 * The classification is purely lexical:
 *   - Admin-rule patterns ("DEA-list", "DOH-rule", "Reg-Drugs") → admin-rule
 *   - status='passed_chamber' + state='TN' → imminent
 *   - Everything else → statutory
 *
 * This is good enough for the current 7 banning states. When new bans
 * land we may want to extend the admin-rule pattern list.
 */
export type RepealPath = {
  label: string;
  cls: string;
  note: string;
};

export function repealPath(bill: TakebackBillSlice): RepealPath {
  if (/(DEA-list|DOH-rule|Reg-Drugs)/i.test(bill.bill_number)) {
    return {
      label: "Admin-rule ban",
      cls: "border-emerald-700/40 bg-emerald-950/15 text-emerald-300",
      note: "Repeal does NOT require legislation — a future Health Director can rescind.",
    };
  }
  if (bill.status === "passed_chamber") {
    return {
      label: "Imminent ban",
      cls: "border-amber-700/50 bg-amber-950/15 text-amber-200",
      note: "Phase 1 = pre-signature veto pressure. Phase 2 = post-signature repeal pathway.",
    };
  }
  return {
    label: "Statutory ban",
    cls: "border-zinc-700 bg-zinc-950/40 text-zinc-300",
    note: "Repeal requires a state legislature vote. Harder path.",
  };
}
