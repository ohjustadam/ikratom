/**
 * Call badges, earned on /calls by tracked phone calls. One copy, read by
 * /calls, /account/calls and the public Roles and badges page (/roles).
 */
export const CALL_BADGES: Record<string, { emoji: string; title: string; desc: string }> = {
  first_call: { emoji: "🎉", title: "First call", desc: "You made your first tracked call. The hardest one is done." },
  capital_seven: { emoji: "🏛️", title: "Capital Seven", desc: "Reached 7 distinct legislators." },
  coast_to_coast: { emoji: "🗺️", title: "Coast to Coast", desc: "Calls placed in 5+ states." },
  century_club: { emoji: "💯", title: "Century Club", desc: "100 tracked calls." },
};
