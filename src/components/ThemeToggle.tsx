"use client";

import { useEffect, useState } from "react";
import { saveUiPrefs } from "@/modules/ui/actions";

/**
 * Dark/light theme toggle. The actual theme is set on <html data-theme>
 * before hydration by the inline script in the root layout (no FOUC).
 * Toggling persists to localStorage (every device) AND to the user's
 * profile (cross-device) — the latter no-ops for anonymous users.
 */
const STORAGE_KEY = "ikratom-theme";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // private mode / storage disabled — toggle still works for the session
    }
    setTheme(next);
    // Cross-device persistence for signed-in users; no-ops for anon.
    void saveUiPrefs({ theme: next }).catch(() => {});
  }

  const goingTo = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${goingTo} mode`}
      title={`Switch to ${goingTo} mode`}
      className={`inline-flex items-center rounded px-2 py-1 text-zinc-200 hover:text-emerald-400 ${className}`}
    >
      <span aria-hidden>{theme === "light" ? "🌙" : "☀️"}</span>
      <span className="sr-only">Toggle light/dark theme</span>
    </button>
  );
}
