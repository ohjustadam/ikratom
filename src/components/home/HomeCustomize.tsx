"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Home workspace personalization — lets a visitor shape their landing by
 * hiding the content bands they don't care about. Quiet by default (a small
 * "Personalize" affordance); when engaged, each band shows a Hide/Show chip.
 *
 * Persistence is localStorage-first (works for anon + signed-in, per device),
 * mirroring how the theme system started. Cross-device sync via a profile
 * column (home_layout) is a documented fast-follow (needs a migration).
 *
 * Applied via conditional render (hidden bands return null when not editing),
 * so there's no layout/divider reshuffle to manage — just show/hide.
 */

const KEY = "ikratom-home-hidden";
const TIP_KEY = "ikratom-home-tip-seen";

type Ctx = {
  editing: boolean;
  setEditing: (b: boolean) => void;
  hidden: Set<string>;
  toggle: (id: string) => void;
  ready: boolean;
};
const HomeCustomizeCtx = createContext<Ctx | null>(null);

export function HomeCustomizeProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {
      // ignore malformed / disabled storage
    }
    setReady(true);
  }, []);

  function toggle(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  return (
    <HomeCustomizeCtx.Provider value={{ editing, setEditing, hidden, toggle, ready }}>
      {children}
    </HomeCustomizeCtx.Provider>
  );
}

function useHomeCustomize(): Ctx {
  const c = useContext(HomeCustomizeCtx);
  if (!c) throw new Error("useHomeCustomize must be used within HomeCustomizeProvider");
  return c;
}

/** Wraps one customizable home band. */
export function Customizable({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const { editing, hidden, toggle, ready } = useHomeCustomize();
  const isHidden = ready && hidden.has(id);

  // Live view: a hidden band simply isn't rendered.
  if (!editing) return isHidden ? null : <>{children}</>;

  // Edit view: show the band (dimmed if hidden) with a Hide/Show control.
  return (
    <div
      className={`relative my-2 rounded-xl border border-dashed p-2 transition ${
        isHidden ? "border-zinc-700 bg-zinc-950/40 opacity-60" : "border-emerald-700/40"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{label}</span>
        <button
          type="button"
          onClick={() => toggle(id)}
          aria-pressed={!isHidden}
          className={`rounded-md border px-2.5 py-0.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
            isHidden
              ? "border-emerald-600 text-emerald-300 hover:bg-emerald-500/10"
              : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
          }`}
        >
          {isHidden ? "Show" : "Hide"}
        </button>
      </div>
      <div className={isHidden ? "pointer-events-none" : ""} aria-hidden={isHidden}>
        {children}
      </div>
    </div>
  );
}

/**
 * The personalize affordance + first-run how-to. Renders a subtle control that
 * flips the page into edit mode; while editing it shows a done button + a plain
 * one-line guide so the feature explains itself.
 */
export function PersonalizeBar() {
  const { editing, setEditing, hidden, ready } = useHomeCustomize();
  const [showTip, setShowTip] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(TIP_KEY)) setShowTip(true);
    } catch {}
  }, []);

  function dismissTip() {
    setShowTip(false);
    try { localStorage.setItem(TIP_KEY, "1"); } catch {}
  }

  const hiddenCount = ready ? hidden.size : 0;

  return (
    <div className="mt-6 flex flex-wrap items-center justify-end gap-2 text-xs">
      {showTip && !editing && (
        <span className="mr-auto inline-flex items-center gap-2 rounded-full border border-emerald-700/40 bg-emerald-950/20 px-3 py-1 text-emerald-200">
          ✨ Make this page yours — hide the sections you don&apos;t need.
          <button type="button" onClick={dismissTip} aria-label="Dismiss tip" className="text-emerald-400 hover:text-emerald-200">
            ✕
          </button>
        </span>
      )}
      {editing ? (
        <>
          <span className="mr-auto text-zinc-400">
            Toggle any section below. Changes save on this device automatically.
          </span>
          <button
            type="button"
            onClick={() => { setEditing(false); dismissTip(); }}
            className="rounded-md bg-emerald-500 px-3 py-1.5 font-semibold text-zinc-950 transition hover:bg-emerald-400"
          >
            Done
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 font-medium text-zinc-300 transition hover:border-emerald-500 hover:text-emerald-400"
        >
          <span aria-hidden>⚙</span>
          Personalize{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
        </button>
      )}
    </div>
  );
}
