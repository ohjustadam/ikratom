"use client";

import { useEffect, useRef, useState } from "react";
import {
  readAppearance,
  setTheme,
  setAccentPreset,
  setCustomHex,
} from "@/modules/ui/theme-runtime";

/**
 * ThemeQuickControls — a compact appearance popover surfaced in two places:
 *   - the top toolbar (replaces the old light/dark-only ThemeToggle), and
 *   - a floating icon on every screen (mounted in the root layout, sitting
 *     right above the Feedback tab).
 * Both triggers open the same panel: light/dark + the five brand-color presets
 * + a full-spectrum custom picker. The heavy Theme Studio (HSL sliders, war-room)
 * still lives at /account/appearance, linked from the panel footer.
 *
 * All state is applied through the shared theme runtime, so a change here is
 * identical to a change on the settings page and persists to localStorage +
 * profile the same way.
 */

const PRESETS: { id: string; label: string; swatch: string }[] = [
  { id: "emerald", label: "Emerald", swatch: "#10b981" },
  { id: "blue", label: "Blue", swatch: "#3b82f6" },
  { id: "violet", label: "Violet", swatch: "#8b5cf6" },
  { id: "amber", label: "Amber", swatch: "#f59e0b" },
  { id: "rose", label: "Rose", swatch: "#f43f5e" },
];

export function ThemeQuickControls({ placement }: { placement: "toolbar" | "floating" }) {
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState<"dark" | "light">("dark");
  const [accent, setAccentState] = useState<string>("emerald");
  const [customHex, setCustomHexState] = useState<string>("#10b981");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Sync React state from the live DOM whenever we open (another surface — the
  // settings page or the other trigger — may have changed it since last time).
  function syncFromDom() {
    const a = readAppearance();
    setThemeState(a.theme);
    setAccentState(a.accent);
    if (a.customHex) setCustomHexState(a.customHex);
  }

  useEffect(() => {
    syncFromDom();
  }, []);

  // Outside-click + Escape to close; restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleOpen() {
    if (!open) syncFromDom();
    setOpen((v) => !v);
  }

  function pickTheme(next: "dark" | "light") {
    setTheme(next);
    setThemeState(next);
  }
  function pickPreset(id: string) {
    setAccentPreset(id);
    setAccentState(id);
  }
  function pickCustom(hex: string) {
    setCustomHex(hex);
    setCustomHexState(hex);
    setAccentState("custom");
  }

  const triggerClass =
    placement === "toolbar"
      ? "inline-flex items-center rounded px-2 py-1 text-zinc-200 transition-colors hover:text-emerald-400"
      : // Floating: a glassy round pill on the right edge, sitting above the
        // Feedback tab (which is fixed right-0 top-1/2). z-40 matches the float
        // convention so it stacks predictably next to Feedback.
        "fixed right-0 top-1/2 z-40 -translate-y-[calc(50%+3.75rem)] flex h-9 w-9 items-center justify-center rounded-l-lg border border-r-0 border-emerald-700/40 bg-zinc-950/80 text-base text-emerald-300 shadow-lg backdrop-blur transition-colors hover:bg-zinc-900/90 hover:text-emerald-200";

  const panelClass =
    placement === "toolbar"
      ? "absolute right-0 top-full z-50 mt-2 w-64"
      : "fixed right-2 top-1/2 z-50 w-[min(17rem,calc(100vw-1rem))] -translate-y-1/2";

  return (
    <div ref={rootRef} className={placement === "toolbar" ? "relative inline-flex" : ""}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Appearance — theme and colors"
        title="Theme & colors"
        className={triggerClass}
      >
        <span aria-hidden>{theme === "light" ? "🌙" : "☀️"}</span>
        {placement === "toolbar" && <span className="sr-only">Theme &amp; colors</span>}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Appearance"
          className={`${panelClass} overflow-hidden rounded-2xl border border-zinc-700/60 bg-zinc-950/90 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl`}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Appearance</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded px-1 text-zinc-500 hover:text-zinc-200"
            >
              ✕
            </button>
          </div>

          {/* Theme */}
          <div className="mb-4">
            <div className="mb-1.5 text-[11px] font-medium text-zinc-400">Theme</div>
            <div className="grid grid-cols-2 gap-2">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => pickTheme(t)}
                  aria-pressed={theme === t}
                  className={`rounded-lg border px-3 py-2 text-sm capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                    theme === t
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                      : "border-zinc-800 text-zinc-300 hover:border-zinc-600"
                  }`}
                >
                  {t === "light" ? "☀️ Light" : "🌙 Dark"}
                </button>
              ))}
            </div>
          </div>

          {/* Brand color */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium text-zinc-400">Brand color</span>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200">
                <span
                  className={`inline-block h-4 w-4 rounded-full border ${accent === "custom" ? "border-zinc-100" : "border-zinc-600"}`}
                  style={{ background: customHex }}
                  aria-hidden
                />
                Custom
                <input
                  type="color"
                  value={customHex}
                  onChange={(e) => pickCustom(e.target.value)}
                  className="sr-only"
                  aria-label="Pick a custom brand color"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickPreset(p.id)}
                  aria-label={p.label}
                  aria-pressed={accent === p.id}
                  title={p.label}
                  className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-emerald-500 ${
                    accent === p.id ? "border-zinc-100" : "border-transparent"
                  }`}
                  style={{ background: p.swatch }}
                />
              ))}
            </div>
          </div>

          <a
            href="/account/appearance"
            className="mt-4 block text-center text-[11px] text-zinc-500 transition-colors hover:text-emerald-400"
          >
            Full theme studio →
          </a>
        </div>
      )}
    </div>
  );
}
