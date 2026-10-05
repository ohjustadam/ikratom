"use client";

import { useMemo, useState } from "react";
import { fillTemplate, missingRequired, placeholdersIn, PLACEHOLDER_PROMPTS, templatesFor } from "./letter-templates";

/**
 * "Start from a template": pick a pre-written letter, see every blank it needs,
 * get the ones we know filled in for you, and fill the rest before it can be
 * used (owner ask 2026-10-03: "prompt to fill in any missing info to make the
 * letters complete"). Applying replaces the subject/body, which stay editable.
 */
export function TemplateFiller({
  kind, known, onApply,
}: {
  kind: "local" | "bill" | "legislator";
  known: Record<string, string | null | undefined>;
  onApply: (subject: string, body: string) => void;
}) {
  const templates = templatesFor(kind);
  const [id, setId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const tpl = templates.find((t) => t.id === id) ?? null;
  const names = useMemo(() => (tpl ? placeholdersIn(tpl.subject, tpl.body).filter((n) => n !== "bill_suffix") : []), [tpl]);
  const merged: Record<string, string | null | undefined> = { ...known, ...values };
  const missing = missingRequired(names, merged);

  if (!templates.length) return null;
  return (
    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
      <label className="block text-xs font-medium text-zinc-400" htmlFor="tpl-pick">Start from a template</label>
      <select id="tpl-pick" value={id} onChange={(e) => { setId(e.target.value); setValues({}); }}
        className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200">
        <option value="">Keep my current letter</option>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      {tpl && (
        <div className="mt-3 space-y-2">
          {names.map((n) => {
            const p = PLACEHOLDER_PROMPTS[n] ?? { label: n.replace(/_/g, " "), hint: "" };
            const v = merged[n] ?? "";
            const isMissing = missing.includes(n);
            return (
              <div key={n}>
                <label className="block text-[11px] text-zinc-400" htmlFor={`ph-${n}`}>
                  {p.label}{p.optional ? " (optional)" : ""}{isMissing && <span className="text-amber-300"> · needed</span>}
                </label>
                {n === "my_story" ? (
                  <textarea id={`ph-${n}`} rows={2} value={v} placeholder={p.hint} maxLength={600}
                    onChange={(e) => setValues((s) => ({ ...s, [n]: e.target.value }))}
                    className="mt-0.5 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100" />
                ) : (
                  <input id={`ph-${n}`} value={v} placeholder={p.hint} maxLength={120}
                    onChange={(e) => setValues((s) => ({ ...s, [n]: e.target.value }))}
                    className={`mt-0.5 w-full rounded border bg-zinc-950 px-2 py-1 text-xs text-zinc-100 ${isMissing ? "border-amber-700" : "border-zinc-800"}`} />
                )}
              </div>
            );
          })}
          <button type="button" disabled={missing.length > 0}
            onClick={() => {
              const vals = { ...merged, bill_suffix: merged.bill_number ? ` (${merged.bill_number})` : "" };
              onApply(fillTemplate(tpl.subject, vals), fillTemplate(tpl.body, vals));
              setId("");
            }}
            className="w-full rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            {missing.length ? `Fill ${missing.length} more to use this letter` : "Use this letter"}
          </button>
        </div>
      )}
    </div>
  );
}
