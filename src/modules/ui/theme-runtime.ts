"use client";

/**
 * Shared client-side theme runtime — the single source of truth for applying
 * theme / accent / custom-color / mode to <html data-*> and persisting the
 * choice (localStorage every device + profile via saveUiPrefs for signed-in
 * users, which no-ops for anon).
 *
 * Before this module the ramp math lived in THREE places that had to stay in
 * sync (globals.css presets, AppearanceControls, and the no-flash inline
 * script in layout.tsx). AppearanceControls + the new ThemeQuickControls now
 * both import from here. The inline no-flash script in layout.tsx is a
 * hand-minified mirror of `rampVars()` below — if you change the ramp math,
 * change it there too (it must run before paint, so it can't import this).
 *
 * Custom-accent + light-mode fix: the emerald ramp's light tiers (-200/-300/
 * -400) double as TEXT across the app. In light mode a bright custom accent
 * would render those as near-invisible light text on white. `rampVars()`
 * clamps those specific tiers dark when the active theme is light, mirroring
 * the static remap globals.css does for the default/preset accents.
 */

import { saveUiPrefs } from "./actions";

export const LS = {
  theme: "ikratom-theme",
  accent: "ikratom-accent",
  accentHex: "ikratom-accent-hex",
  mode: "ikratom-mode",
} as const;

// --- color helpers (HSL <-> hex), self-contained, no deps ---
export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const c = ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// Lightness deltas (percentage points off the base L) that turn one chosen
// color into the full emerald ramp. Applied as inline --color-emerald-* vars
// on <html>. Mirrors the ramp in layout.tsx's no-flash script.
export const EMERALD_DELTAS: Record<number, number> = {
  500: 0, 400: 8, 300: 18, 200: 30, 100: 42, 50: 50, 600: -8, 700: -16, 800: -24, 900: -32, 950: -40,
};

// In light mode these tiers are used as TEXT — cap their lightness so a bright
// custom accent still reads on a white page (mirrors the static light remap).
const LIGHT_TEXT_TIER_MAX: Record<number, number> = { 400: 40, 300: 34, 200: 30 };

/** Compute the {tier: "hsl(...)"} map for a base HSL, theme-aware. */
export function rampVars(h: number, s: number, l: number, isLight: boolean): Record<number, string> {
  const out: Record<number, string> = {};
  for (const key of Object.keys(EMERALD_DELTAS)) {
    const tier = Number(key);
    let ll = Math.max(0, Math.min(100, l + EMERALD_DELTAS[tier]));
    const cap = LIGHT_TEXT_TIER_MAX[tier];
    if (isLight && cap != null) ll = Math.min(ll, cap);
    out[tier] = `hsl(${h} ${s}% ${ll}%)`;
  }
  return out;
}

function isLightNow(): boolean {
  return document.documentElement.dataset.theme === "light";
}

/** Apply a custom accent ramp from an HSL triple (live; no persistence). */
export function applyRamp(h: number, s: number, l: number) {
  const d = document.documentElement;
  d.dataset.accent = "custom";
  d.style.setProperty("--accent", hslToHex(h, s, l));
  const vars = rampVars(h, s, l, isLightNow());
  for (const tier of Object.keys(vars)) {
    d.style.setProperty(`--color-emerald-${tier}`, vars[Number(tier)]);
  }
}

/** Remove any inline custom ramp (back to a named preset / default). */
export function clearRamp() {
  const d = document.documentElement;
  d.style.removeProperty("--accent");
  for (const tier of Object.keys(EMERALD_DELTAS)) {
    d.style.removeProperty(`--color-emerald-${tier}`);
  }
}

/** Read the live appearance state off <html>. */
export function readAppearance(): {
  theme: "dark" | "light";
  accent: string;
  mode: "normal" | "war-room";
  customHex: string | null;
} {
  const d = document.documentElement;
  const accent = d.dataset.accent || "emerald";
  const customHex = accent === "custom" ? d.style.getPropertyValue("--accent").trim() || null : null;
  return {
    theme: d.dataset.theme === "light" ? "light" : "dark",
    accent,
    mode: d.dataset.mode === "war-room" ? "war-room" : "normal",
    customHex,
  };
}

/** Set light/dark. Re-applies a live custom ramp so its light-mode text tiers
 *  re-clamp correctly when toggling theme while on a custom accent. */
export function setTheme(next: "dark" | "light") {
  const d = document.documentElement;
  d.dataset.theme = next;
  if (d.dataset.accent === "custom") {
    const hsl = hexToHsl(d.style.getPropertyValue("--accent"));
    if (hsl) applyRamp(hsl.h, hsl.s, hsl.l);
  }
  try { localStorage.setItem(LS.theme, next); } catch {}
  void saveUiPrefs({ theme: next }).catch(() => {});
}

/** Pick a named preset accent (clears any custom ramp). */
export function setAccentPreset(next: string) {
  const d = document.documentElement;
  clearRamp();
  d.dataset.accent = next;
  try {
    localStorage.setItem(LS.accent, next);
    localStorage.removeItem(LS.accentHex);
  } catch {}
  void saveUiPrefs({ accent: next, accentHex: null }).catch(() => {});
}

/** Commit a custom hex accent (persists). */
export function setCustomHex(hex: string) {
  const hsl = hexToHsl(hex);
  if (!hsl) return;
  applyRamp(hsl.h, hsl.s, hsl.l);
  try {
    localStorage.setItem(LS.accent, "custom");
    localStorage.setItem(LS.accentHex, hex);
  } catch {}
  void saveUiPrefs({ accentHex: hex }).catch(() => {});
}

/** Set the density/framing mode. */
export function setMode(next: "normal" | "war-room") {
  document.documentElement.dataset.mode = next;
  try { localStorage.setItem(LS.mode, next); } catch {}
  void saveUiPrefs({ mode: next }).catch(() => {});
}
