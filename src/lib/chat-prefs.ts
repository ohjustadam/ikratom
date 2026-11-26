/**
 * A member's Lounge settings (B8): keep the chat open across pages, plus the
 * reading-comfort choices. Saved to the account (table lounge_prefs, mig
 * 0336) and mirrored in the browser so the chat can apply them before the
 * account row has loaded. Window position and size are per device and live in
 * src/lib/chat-window.ts instead.
 *
 * Themes are a short list checked for contrast, not a free color picker: many
 * members are older and the point is reading comfort.
 */

export const CHAT_THEMES = ["forest", "ocean", "paper", "dusk"] as const;
export type ChatTheme = (typeof CHAT_THEMES)[number];

export type LoungePrefs = {
  keepOpen: boolean;
  textSize: number;
  easyFont: boolean;
  highContrast: boolean;
  theme: ChatTheme;
};

export const DEFAULT_PREFS: LoungePrefs = {
  keepOpen: false,
  textSize: 0,
  easyFont: false,
  highContrast: false,
  theme: "forest",
};

/** Text size steps in px, A- / A+. Step 0 is today's size. */
export const TEXT_SIZE_PX = [14, 16, 18, 20, 23] as const;
export const MAX_TEXT_SIZE = TEXT_SIZE_PX.length - 1;

export function sanitizePrefs(input: unknown): LoungePrefs {
  const x = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const size = Number(x.textSize);
  return {
    keepOpen: x.keepOpen === true,
    textSize: Number.isFinite(size) ? Math.min(MAX_TEXT_SIZE, Math.max(0, Math.round(size))) : 0,
    easyFont: x.easyFont === true,
    highContrast: x.highContrast === true,
    theme: (CHAT_THEMES as readonly string[]).includes(x.theme as string) ? (x.theme as ChatTheme) : "forest",
  };
}

export type LoungePrefsRow = {
  keep_open: boolean;
  text_size: number;
  easy_font: boolean;
  high_contrast: boolean;
  theme: string;
};

export function prefsFromRow(row: Partial<LoungePrefsRow> | null | undefined): LoungePrefs {
  if (!row) return { ...DEFAULT_PREFS };
  return sanitizePrefs({
    keepOpen: row.keep_open,
    textSize: row.text_size,
    easyFont: row.easy_font,
    highContrast: row.high_contrast,
    theme: row.theme,
  });
}

export function prefsToRow(p: LoungePrefs): LoungePrefsRow {
  const s = sanitizePrefs(p);
  return { keep_open: s.keepOpen, text_size: s.textSize, easy_font: s.easyFont, high_contrast: s.highContrast, theme: s.theme };
}

type Palette = {
  bg: string; surface: string; border: string; text: string; muted: string;
  name: string; admin: string; accent: string; onAccent: string; mention: string;
};

/**
 * "Standard" follows the site's own light/dark switch (it uses the same zinc
 * variables the rest of the site does). The others are fixed palettes whose
 * text and muted colors clear WCAG AA (4.5:1) on their background.
 */
export const THEMES: Record<ChatTheme, { label: string; swatch: string; palette: Palette }> = {
  forest: {
    label: "Standard",
    swatch: "#10b981",
    palette: {
      bg: "var(--color-zinc-950)", surface: "var(--color-zinc-900)", border: "var(--color-zinc-800)",
      text: "var(--color-zinc-200)", muted: "var(--color-zinc-400)",
      // --lc-std-* are darkened for the site's light mode in globals.css.
      name: "var(--lc-std-name, var(--color-emerald-400))", admin: "var(--lc-std-admin, var(--color-amber-400))", accent: "var(--color-emerald-500)", onAccent: "#09090b",
      mention: "rgba(16,185,129,0.18)",
    },
  },
  ocean: {
    label: "Deep blue",
    swatch: "#38bdf8",
    palette: {
      bg: "#0b1220", surface: "#13203a", border: "#24406a", text: "#e2e8f0", muted: "#a5b4c8",
      name: "#7dd3fc", admin: "#fcd34d", accent: "#38bdf8", onAccent: "#0b1220", mention: "rgba(56,189,248,0.2)",
    },
  },
  paper: {
    label: "Light",
    swatch: "#f4f1e8",
    palette: {
      bg: "#fffdf7", surface: "#f4f1e8", border: "#cfcabb", text: "#1c1917", muted: "#57534e",
      name: "#065f46", admin: "#92400e", accent: "#047857", onAccent: "#ffffff", mention: "rgba(4,120,87,0.14)",
    },
  },
  dusk: {
    label: "Plum",
    swatch: "#e879f9",
    palette: {
      bg: "#1a1220", surface: "#261a2e", border: "#45324f", text: "#f3ecf6", muted: "#bfaecb",
      name: "#f0abfc", admin: "#fcd34d", accent: "#e879f9", onAccent: "#1a1220", mention: "rgba(232,121,249,0.2)",
    },
  },
};

const HIGH_CONTRAST: Palette = {
  bg: "#000000", surface: "#000000", border: "#ffffff", text: "#ffffff", muted: "#e5e5e5",
  name: "#ffe600", admin: "#7df9ff", accent: "#ffe600", onAccent: "#000000", mention: "rgba(255,230,0,0.28)",
};

/** The CSS variables the chat window reads (bg-[var(--lc-bg)] and friends). */
export function chatStyleVars(p: LoungePrefs): Record<string, string> {
  const c = p.highContrast ? HIGH_CONTRAST : THEMES[p.theme].palette;
  return {
    "--lc-bg": c.bg, "--lc-surface": c.surface, "--lc-border": c.border, "--lc-text": c.text,
    "--lc-muted": c.muted, "--lc-name": c.name, "--lc-admin": c.admin, "--lc-accent": c.accent,
    "--lc-on-accent": c.onAccent, "--lc-mention": c.mention,
    "--lc-size": `${TEXT_SIZE_PX[sanitizePrefs(p).textSize]}px`,
  };
}
