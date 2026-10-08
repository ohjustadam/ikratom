/** The 50 states + DC, as stored in profiles.state. */
export const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

/** The form value for "Prefer not to say". Never a valid state code. */
export const PREFER_NOT_TO_SAY = "NONE";

/**
 * Parse an answer to "which state?". Returns the state to store (NULL for
 * "prefer not to say") or an error. An empty answer is an error: the question
 * is required (owner decision 2026-10-03).
 */
export function parseStateAnswer(raw: unknown): { state: string | null } | { error: string } {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === PREFER_NOT_TO_SAY) return { state: null };
  if ((US_STATE_CODES as readonly string[]).includes(v)) return { state: v };
  return { error: v ? "Choose a US state from the list." : "Choose your state, or “Prefer not to say”." };
}
