/**
 * Group cover themes (migration 0284: coalitions.cover_theme). A preset
 * banner instead of an uploaded photo: no storage, no egress, nothing to
 * moderate. The class strings are literal so Tailwind keeps them.
 */

export const COVER_THEMES = ["emerald", "leaf", "forest", "ocean", "sunrise", "violet", "flag", "slate"] as const;
export type CoverTheme = (typeof COVER_THEMES)[number];

export const COVER_CLASS: Record<CoverTheme, string> = {
  emerald: "bg-gradient-to-br from-emerald-600 via-emerald-900 to-zinc-950",
  leaf: "bg-gradient-to-br from-lime-500 via-green-700 to-emerald-950",
  forest: "bg-gradient-to-br from-green-700 via-emerald-950 to-zinc-950",
  ocean: "bg-gradient-to-br from-sky-500 via-blue-800 to-indigo-950",
  sunrise: "bg-gradient-to-br from-amber-400 via-rose-600 to-purple-900",
  violet: "bg-gradient-to-br from-violet-500 via-fuchsia-800 to-zinc-950",
  flag: "bg-gradient-to-br from-red-600 via-slate-200/30 to-blue-800",
  slate: "bg-gradient-to-br from-slate-400 via-slate-700 to-zinc-900",
};

export const COVER_LABEL: Record<CoverTheme, string> = {
  emerald: "Emerald", leaf: "Leaf", forest: "Forest", ocean: "Ocean",
  sunrise: "Sunrise", violet: "Violet", flag: "Red, white & blue", slate: "Slate",
};

export function coverClass(theme: string | null | undefined): string {
  return COVER_CLASS[(COVER_THEMES as readonly string[]).includes(theme ?? "") ? (theme as CoverTheme) : "emerald"];
}

/** The letter in a member's avatar circle: the first letter of their @handle. */
export function handleInitial(handle: string): string {
  const ch = handle.replace(/^@/, "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}
