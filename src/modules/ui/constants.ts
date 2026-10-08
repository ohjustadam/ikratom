/**
 * UI preference enums (theme / brand accent / mode).
 *
 * These live in a plain module — NOT in actions.ts — because a
 * "use server" file may only export async functions. Exporting these
 * const arrays from the action file triggered Next's
 * `invalid-use-server-value` error (digest @E352), which 500'd every
 * server-action page re-render that pulled this module into its graph
 * (ThemeQuickControls is in the root layout → on every page).
 */
export const UI_THEMES = ["dark", "light"] as const;
export const UI_ACCENTS = ["emerald", "blue", "violet", "amber", "rose"] as const;
export const UI_MODES = ["normal", "war-room"] as const;
