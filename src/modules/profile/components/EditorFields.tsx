"use client";

import { INTERESTS, LINK_LABEL_MAX, LINK_URL_MAX, MAX_INTERESTS, MAX_LINKS } from "../audience";

/** Interest chips from the fixed vocabulary (no free text: it would leak). */
export function InterestPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : value.length >= MAX_INTERESTS ? value : [...value, id]);
  return (
    <div>
      <ul className="flex flex-wrap gap-1.5">
        {INTERESTS.map((i) => {
          const on = value.includes(i.id);
          return (
            <li key={i.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(i.id)}
                className={`rounded-full border px-3 py-1 text-xs ${on ? "border-emerald-500 bg-emerald-950/40 text-emerald-200" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}
              >
                {on ? "✓ " : ""}{i.label}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-xs text-zinc-600">{value.length}/{MAX_INTERESTS} picked</p>
    </div>
  );
}

export type LinkRow = { label: string; url: string };

/** Up to five https links. */
export function LinksEditor({ value, onChange }: { value: LinkRow[]; onChange: (v: LinkRow[]) => void }) {
  const set = (i: number, patch: Partial<LinkRow>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {value.map((l, i) => (
        <div key={i} className="flex flex-col gap-2 sm:flex-row">
          <input
            aria-label={`Link ${i + 1} label`}
            placeholder="Label (e.g. My blog)"
            maxLength={LINK_LABEL_MAX}
            value={l.label}
            onChange={(e) => set(i, { label: e.target.value })}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm sm:w-40"
          />
          <input
            aria-label={`Link ${i + 1} URL`}
            placeholder="https://"
            inputMode="url"
            maxLength={LINK_URL_MAX}
            value={l.url}
            onChange={(e) => set(i, { url: e.target.value })}
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="self-start rounded-md px-2 py-2 text-xs text-zinc-500 hover:text-red-400">
            Remove
          </button>
        </div>
      ))}
      {value.length < MAX_LINKS && (
        <button type="button" onClick={() => onChange([...value, { label: "", url: "" }])} className="text-xs font-semibold text-emerald-400 hover:underline">
          + Add a link
        </button>
      )}
    </div>
  );
}
