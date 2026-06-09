/**
 * Single source of truth for kratom legal-status presentation.
 *
 * Both the home-page map (`StateLegalMap`, server) and the forum map
 * (`USMap`, client) import these so they CANNOT drift apart again — they used
 * to hard-code different palettes and different "unknown" handling (the forum
 * map painted unconfirmed states as "Legal", the home map left them grey).
 *
 * The status values come from `state_status.admin_leaf_status` — the
 * admin-confirmed natural-leaf legal status. Color = degree of PROTECTION,
 * not merely "is it legal today": a state with no kratom law is unprotected
 * (blue), not safe-green. Green is reserved for an enacted KCPA. Grey = still
 * verifying — we never guess a color.
 */
export type LegalStatus =
  | "banned"
  | "restricted"
  | "legal"
  | "incoming"
  | "kcpa"
  | "protected";

export const LEGAL_STATUS_FILL: Record<string, string> = {
  banned: "#991b1b", // red-800 — statewide leaf ban
  restricted: "#b45309", // amber-700 — partial restriction (age limit / 7-OH only)
  legal: "#2563eb", // blue-600 — legal but UNPROTECTED (no kratom law on the books)
  incoming: "#0d9488", // teal-600 — protection approved but not yet in force
  kcpa: "#15803d", // green-700 — enacted protection (KCPA)
  protected: "#15803d",
};

/** Grey — tracking, not yet admin-confirmed. Shown for any unknown status. */
export const LEGAL_STATUS_UNKNOWN = "#27272a"; // zinc-800

export const LEGAL_STATUS_LABEL: Record<string, string> = {
  banned: "Banned",
  restricted: "Restricted",
  legal: "Legal · no protections",
  incoming: "Protection incoming",
  kcpa: "Protected · KCPA",
  protected: "Protected",
};

/** Resolve a (possibly null/unknown) status to its fill color. */
export function legalStatusFill(status?: string | null): string {
  return status ? LEGAL_STATUS_FILL[status] ?? LEGAL_STATUS_UNKNOWN : LEGAL_STATUS_UNKNOWN;
}

/** Resolve a (possibly null/unknown) status to its human label. */
export function legalStatusLabel(status?: string | null): string {
  return status ? LEGAL_STATUS_LABEL[status] ?? status : "Tracking";
}
