"use client";

import { useEffect, useState } from "react";
import {
  hslToHex,
  hexToHsl,
  applyRamp,
  setTheme as rtSetTheme,
  setAccentPreset,
  setCustomHex,
  setMode as rtSetMode,
} from "@/modules/ui/theme-runtime";

/**
 * Live appearance controls. Theme + preset accent + war-room apply INSTANTLY
 * (set the data-* attribute on <html>, persist to localStorage + profile).
 * The custom Theme-Studio color previews live as you drag the sliders, then
 * commits on Apply — the explicit confirm step the owner asked for. globals.css
 * derives the whole emerald ramp from the single --accent hex via color-mix().
 */
const ACCENTS: { id: string; label: string; swatch: string }[] = [
  { id: "emerald", label: "Emerald", swatch: "#10b981" },
  { id: "blue", label: "Blue", swatch: "#3b82f6" },
  { id: "violet", label: "Violet", swatch: "#8b5cf6" },
  { id: "amber", label: "Amber", swatch: "#f59e0b" },
  { id: "rose", label: "Rose", swatch: "#f43f5e" },
];

// Color helpers + ramp math now live in the shared theme runtime
// (src/modules/ui/theme-runtime.ts) so this page, the floating quick control,
// and the toolbar toggle all apply appearance identically.

export function AppearanceControls() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [accent, setAccent] = useState("emerald"); // preset id OR "custom"
  const [mode, setMode] = useState("normal");
  const [hue, setHue] = useState(160);
  const [sat, setSat] = useState(70);
  const [light, setLight] = useState(45);
  const [saved, setSaved] = useState(false);

  const customHex = hslToHex(hue, sat, light);

  useEffect(() => {
    const d = document.documentElement;
    setTheme(d.dataset.theme === "light" ? "light" : "dark");
    const a = d.dataset.accent || "emerald";
    setAccent(a);
    setMode(d.dataset.mode === "war-room" ? "war-room" : "normal");
    if (a === "custom") {
      const live = d.style.getPropertyValue("--accent");
      const hsl = live ? hexToHsl(live) : null;
      if (hsl) {
        setHue(hsl.h);
        setSat(hsl.s);
        setLight(hsl.l);
      }
    }
    setMounted(true);
  }, []);

  function flash() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  function applyTheme(next: "dark" | "light") {
    rtSetTheme(next);
    setTheme(next);
    flash();
  }

  // Live preview only — no persistence — as the user drags a slider.
  function previewCustom(h: number, s: number, l: number) {
    applyRamp(h, s, l);
    setAccent("custom");
  }

  // The explicit "Apply" — commit the previewed custom color.
  function applyCustom() {
    setCustomHex(hslToHex(hue, sat, light));
    setAccent("custom");
    flash();
  }

  // Pick a named preset → clears any custom color + ramp (accentHex: null).
  function applyAccent(next: string) {
    setAccentPreset(next);
    setAccent(next);
    flash();
  }

  function applyMode(next: "normal" | "war-room") {
    rtSetMode(next);
    setMode(next);
    flash();
  }

  if (!mounted) return <div className="h-64 animate-pulse rounded-lg bg-zinc-900/40" />;

  return (
    <div className="space-y-8">
      <Section title="Theme" desc="Light or dark across the whole app.">
        <div className="flex gap-2">
          {(["dark", "light"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => applyTheme(t)}
              className={`rounded-lg border px-4 py-2 text-sm capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                theme === t
                  ? "border-emerald-500 bg-emerald-950/30 text-emerald-300"
                  : "border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-zinc-700"
              }`}
            >
              {t === "dark" ? "🌙 Dark" : "☀️ Light"}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Brand color"
        desc="Re-skins the accent across buttons, links, and highlights. Presets apply instantly; a custom color previews live and saves when you press Apply."
      >
        <div className="flex flex-wrap gap-3">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => applyAccent(a.id)}
              aria-label={a.label}
              aria-pressed={accent === a.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                accent === a.id ? "border-zinc-200 text-zinc-100" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              <span className="h-4 w-4 rounded-full" style={{ background: a.swatch }} aria-hidden />
              {a.label}
            </button>
          ))}
        </div>

        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Custom color {accent === "custom" && <span className="ml-1 text-emerald-400">• active</span>}
            </span>
            <span className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="inline-block h-5 w-5 rounded-full border border-zinc-700" style={{ background: customHex }} aria-hidden />
              <code className="text-zinc-300">{customHex}</code>
            </span>
          </div>

          <Slider
            label="Hue"
            min={0}
            max={360}
            value={hue}
            onChange={(v) => { setHue(v); previewCustom(v, sat, light); }}
            track="linear-gradient(to right, hsl(0 80% 50%), hsl(60 80% 50%), hsl(120 80% 50%), hsl(180 80% 50%), hsl(240 80% 50%), hsl(300 80% 50%), hsl(360 80% 50%))"
          />
          <Slider
            label="Saturation"
            min={0}
            max={100}
            value={sat}
            onChange={(v) => { setSat(v); previewCustom(hue, v, light); }}
            track={`linear-gradient(to right, hsl(${hue} 0% ${light}%), hsl(${hue} 100% ${light}%))`}
          />
          <Slider
            label="Lightness"
            min={20}
            max={75}
            value={light}
            onChange={(v) => { setLight(v); previewCustom(hue, sat, v); }}
            track={`linear-gradient(to right, hsl(${hue} ${sat}% 20%), hsl(${hue} ${sat}% 75%))`}
          />

          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <span className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white">Take action</span>
            <a className="text-sm font-medium text-emerald-400 underline" href="#preview" onClick={(e) => e.preventDefault()}>A link</a>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">Badge</span>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={applyCustom}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              Apply color
            </button>
            <button
              type="button"
              onClick={() => applyAccent("emerald")}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              Reset to Emerald
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="War-room mode"
        desc="A higher-intensity framing for active fights. The toggle is live now; denser layouts and urgency-first surfaces expand over time."
      >
        <div className="flex gap-2">
          {(["normal", "war-room"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => applyMode(m)}
              className={`rounded-lg border px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                mode === m
                  ? "border-emerald-500 bg-emerald-950/30 text-emerald-300"
                  : "border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-zinc-700"
              }`}
            >
              {m === "normal" ? "Normal" : "⚔ War room"}
            </button>
          ))}
        </div>
      </Section>

      <p className="text-xs text-zinc-500" aria-live="polite">
        {saved ? "Saved." : "Changes apply instantly and sync to your account when signed in."}
      </p>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
  track,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  track: string;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 flex justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span className="tabular-nums text-zinc-500">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        style={{ background: track }}
        aria-label={label}
      />
    </label>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
      <p className="mt-1 mb-4 text-xs text-zinc-500">{desc}</p>
      {children}
    </div>
  );
}
