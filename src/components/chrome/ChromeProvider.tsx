"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ChromeMe } from "@/app/api/me/route";

/**
 * ChromeProvider — the client-side replacement for the root layout's
 * per-user server reads.
 *
 * The root layout used to `await getCachedAuthProfile()` + `readLocale()`.
 * Because that is the ROOT layout, those cookie reads opted every route in the
 * app out of static generation (see `private/STATIC_CHROME_PLAN.md`). Now the
 * layout renders statically and this provider fetches `/api/me` once per real
 * browser session. Crawlers don't run JS, so they never trigger it.
 *
 * `loading` is exposed so chrome can render a fixed-size skeleton instead of
 * collapsing — otherwise the header would visibly reflow on every page load.
 */

export type ChromeState = { me: ChromeMe | null; loading: boolean };

const ANON: ChromeMe = {
  userId: null,
  username: null,
  avatarUrl: null,
  fullName: null,
  isAdmin: false,
  isLeader: false,
  leaderTourPending: false,
  leaderAcknowledged: true,
  unreadNotifications: 0,
  unreadDms: 0,
  inviteCode: null,
  ui: { theme: null, accent: null, accentHex: null, mode: null },
};

const ChromeContext = createContext<ChromeState>({ me: null, loading: true });

export function useChrome(): ChromeState {
  return useContext(ChromeContext);
}

/**
 * Convenience for the common case: treat "still loading" as anonymous for
 * boolean checks, so callers don't each re-implement the null dance.
 */
export function useChromeMe(): ChromeMe {
  const { me } = useChrome();
  return me ?? ANON;
}

/**
 * Apply the signed-in user's saved UI prefs to <html>.
 *
 * The layout used to server-render these as `data-*` attributes. The inline
 * theme <script> in layout.tsx ALREADY has a complete localStorage fallback
 * (it was written for anonymous visitors), so it has painted a sensible theme
 * long before this runs. This only corrects it when the user's DB preference
 * differs from what's in this device's localStorage — e.g. they changed the
 * accent on another device.
 */
function applyUiPrefs(ui: ChromeMe["ui"]) {
  const d = document.documentElement;
  try {
    if (ui.theme === "light" || ui.theme === "dark") {
      d.dataset.theme = ui.theme;
      localStorage.setItem("ikratom-theme", ui.theme);
    }
    if (ui.accentHex) {
      d.dataset.accent = "custom";
      d.dataset.accentHex = ui.accentHex;
      localStorage.setItem("ikratom-accent-hex", ui.accentHex);
      localStorage.setItem("ikratom-accent", "custom");
    } else if (ui.accent) {
      d.dataset.accent = ui.accent;
      localStorage.setItem("ikratom-accent", ui.accent);
      localStorage.removeItem("ikratom-accent-hex");
    }
    if (ui.mode) {
      d.dataset.mode = ui.mode;
      localStorage.setItem("ikratom-mode", ui.mode);
    }
  } catch {
    /* private-mode localStorage — theme just stays as painted */
  }
}

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ChromeState>({ me: null, loading: true });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/me", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!alive) return;
        if (!res.ok) {
          setState({ me: ANON, loading: false });
          return;
        }
        const me = (await res.json()) as ChromeMe;
        if (!alive) return;
        setState({ me, loading: false });
        if (me.userId) applyUiPrefs(me.ui);
      } catch {
        // Offline / aborted — render as signed-out rather than hanging the
        // chrome in a permanent skeleton.
        if (alive) setState({ me: ANON, loading: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return <ChromeContext.Provider value={state}>{children}</ChromeContext.Provider>;
}
