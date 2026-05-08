"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCockpitLayout } from "./actions";
import { WIDGET_META, type WidgetSlot, type WidgetId } from "./widgets/types";

/**
 * Cockpit customize panel. Toggle visibility + reorder via up/down
 * arrows. We deliberately skipped drag-and-drop to avoid pulling in a
 * heavy library (react-dnd / dnd-kit) — arrows are fast on every
 * device and degrade gracefully without JS.
 *
 * Save sends the whole array to the server action which validates +
 * upserts. Refresh re-renders the layout on the server.
 *
 * Trigger: a "Customize" button in the cockpit header. Open = the
 * panel slides down between the header and the widget grid.
 */
export function CockpitCustomizer({
  initialLayout,
  initialAccent,
}: {
  initialLayout: WidgetSlot[];
  initialAccent: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [widgets, setWidgets] = useState<WidgetSlot[]>(initialLayout);
  const [accent, setAccent] = useState(initialAccent);
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= widgets.length) return;
    const next = [...widgets];
    [next[idx], next[target]] = [next[target], next[idx]];
    setWidgets(next);
  }

  function toggle(id: WidgetId) {
    setWidgets((cur) => cur.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)));
  }

  function save() {
    setInfo(null);
    startTransition(async () => {
      const r = await saveCockpitLayout({
        widgets,
        accent_color: accent as "emerald" | "amber" | "blue" | "red" | "zinc",
      });
      if ("error" in r) setInfo(r.error ?? "Failed");
      else {
        setInfo("Saved.");
        setTimeout(() => setInfo(null), 2000);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-cockpit-customize-button
        className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
      >
        Customize cockpit
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-700/40 bg-zinc-950/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">Customize cockpit</h3>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Close
        </button>
      </div>

      <p className="mb-3 text-xs text-zinc-500">
        Reorder widgets with the arrows. Hide ones you don&apos;t want.
        Changes save when you click <strong className="text-zinc-300">Save</strong>.
      </p>

      <ul className="mb-4 space-y-1">
        {widgets.map((w, idx) => {
          const meta = WIDGET_META[w.id];
          if (!meta) return null;
          return (
            <li
              key={w.id}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                w.visible
                  ? "border-zinc-800 bg-zinc-950/60"
                  : "border-zinc-900 bg-zinc-950/30 opacity-60"
              }`}
            >
              <input
                type="checkbox"
                checked={w.visible}
                onChange={() => toggle(w.id)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
              />
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-zinc-200">{meta.title}</span>
                <span className="ml-2 text-zinc-500">{meta.description}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400 hover:border-emerald-500 disabled:opacity-30"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(idx, 1)}
                  disabled={idx === widgets.length - 1}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400 hover:border-emerald-500 disabled:opacity-30"
                  aria-label="Move down"
                >
                  ↓
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Accent color</p>
        <div className="flex gap-2">
          {(["emerald", "amber", "blue", "red", "zinc"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setAccent(c)}
              className={`h-6 w-6 rounded-full border-2 ${
                accent === c ? "border-zinc-100" : "border-zinc-800"
              }`}
              style={{
                background: {
                  emerald: "#10b981",
                  amber: "#f59e0b",
                  blue: "#3b82f6",
                  red: "#ef4444",
                  zinc: "#71717a",
                }[c],
              }}
              aria-label={c}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-zinc-500"
        >
          Cancel
        </button>
        {info && <span className="text-xs text-emerald-400">{info}</span>}
      </div>
    </div>
  );
}
