"use client";

import { useEffect, useState } from "react";

/**
 * Dark/light theme toggle. The actual theme is set on <html data-theme>
 * before hydration by the inline ThemeScript in the root layout (no FOUC),
 * and persisted to localStorage. This button just flips + persists it.
 *
 * Persisting to the user's profile (cross-device) is a planned follow-up;
 * localStorage is the source of truth for now.
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
