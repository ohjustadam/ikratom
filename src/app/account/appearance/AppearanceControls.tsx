"use client";

import { useEffect, useState } from "react";
import { saveUiPrefs } from "@/modules/ui/actions";

/**
 * Live appearance controls. Each change applies INSTANTLY by setting the
 * data-* attribute on <html> (the CSS in globals.css does the rest), then
 * persists to localStorage (every device) + the profile (cross-device,
 * no-ops for anon). Mirrors the existing settings-form feedback pattern.
 */
const ACCENTS: { id: string; label: string; swatch: string }[] = [
  { id: "emerald", label: "Emerald", swatch: "#10b981" },
  { id: "blue", label: "Blue", swatch: "#3b82f6" },
  { id: "violet", label: "Violet", swatch: "#8b5cf6" },
  { id: "amber", label: "Amber", swatch: "#f59e0b" },
  { id: "rose", label: "Rose", swatch: "#f43f5e" },
];

export function AppearanceControls() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [accent, setAccent] = useState("emerald");
  const [mode, setMode] = useState("normal");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const d = document.documentElement;
    setTheme(d.dataset.theme === "light" ? "light" : "dark");
    setAccent(d.dataset.accent || "emerald");
    setMode(d.dataset.mode === "war-room" ? "war-room" : "normal");
    setMounted(true);
  }, []);

  function flash() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  function applyTheme(next: string) {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("ikratom-theme", next); } catch {}
    setTheme(next);
    void saveUiPrefs({ theme: next }).catch(() => {});
    flash();
  }
  function applyAccent(next: string) {
    document.documentElement.dataset.accent = next;
    try { localStorage.setItem("ikratom-accent", next); } catch {}
    setAccent(next);
    void saveUiPrefs({ accent: next }).catch(() => {});
    flash();
  }
  function applyMode(next: string) {
    document.documentElement.dataset.mode = next;
    try { localStorage.setItem("ikratom-mode", next); } catch {}
    setMode(next);
    void saveUiPrefs({ mode: next }).catch(() => {});
    flash();
  }

  // Avoid a hydration mismatch: render a stable shell until we've read the
  // live <html> attributes on the client.
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
              className={`rounded-lg border px-4 py-2 text-sm capitalize ${
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

      <Section title="Brand color" desc="Re-skins the accent across buttons, links, and highlights.">
        <div className="flex flex-wrap gap-3">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => applyAccent(a.id)}
              aria-label={a.label}
              aria-pressed={accent === a.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                accent === a.id ? "border-zinc-200 text-zinc-100" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              <span className="h-4 w-4 rounded-full" style={{ background: a.swatch }} aria-hidden />
              {a.label}
            </button>
          ))}
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
              className={`rounded-lg border px-4 py-2 text-sm ${
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

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
      <p className="mt-1 mb-4 text-xs text-zinc-500">{desc}</p>
      {children}
    </div>
  );
}
