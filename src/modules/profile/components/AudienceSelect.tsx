"use client";

import { AUDIENCES, AUDIENCE_HINT, AUDIENCE_ICON, AUDIENCE_LABEL, type Audience } from "../audience";

/** The Only me / Friends / Members / Public picker shown beside every section. */
export function AudienceSelect({
  value,
  onChange,
  label,
  compact = false,
}: {
  value: Audience;
  onChange: (v: Audience) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
      {!compact && <span>Visible to</span>}
      <select
        aria-label={`Who can see your ${label.toLowerCase()}`}
        title={AUDIENCE_HINT[value]}
        value={value}
        onChange={(e) => onChange(e.target.value as Audience)}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
      >
        {AUDIENCES.map((a) => (
          <option key={a} value={a}>
            {AUDIENCE_ICON[a]} {AUDIENCE_LABEL[a]}
          </option>
        ))}
      </select>
    </label>
  );
}
