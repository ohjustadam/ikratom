"use client";

import type { FieldMeta } from "./MasterEditUI";

/** One editable grid cell. Values travel as strings; the server coerces. */
export function EditableCell({
  field, value, changed, onChange,
}: {
  field: FieldMeta;
  value: string;
  changed: boolean;
  onChange: (v: string) => void;
}) {
  const ring = changed ? "border-amber-500" : "border-zinc-700";
  if (field.kind === "bool") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`rounded border ${ring} bg-zinc-900 px-1.5 py-1 text-xs text-zinc-100`}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (field.kind === "enum") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`rounded border ${ring} bg-zinc-900 px-1.5 py-1 text-xs text-zinc-100`}>
        {value === "" && <option value="">—</option>}
        {(field.values ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    );
  }
  if (field.kind === "text" && (field.maxLen ?? 0) > 500) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={value.length > 80 ? 4 : 1}
        className={`w-full min-w-[220px] rounded border ${ring} bg-zinc-900 px-1.5 py-1 font-mono text-[11px] text-zinc-100`}
      />
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.kind === "date" ? "2026-08-01 (empty = clear)" : undefined}
      className={`w-full min-w-[140px] rounded border ${ring} bg-zinc-900 px-1.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-600`}
    />
  );
}
