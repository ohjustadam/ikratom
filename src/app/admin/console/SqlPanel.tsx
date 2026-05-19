"use client";

import { useState, useTransition } from "react";
import { runSqlQuery, type SqlResult } from "@/modules/admin/console-actions";

/**
 * SQL panel — direct query execution.
 *
 * Mobile-aware: monospace big-text textarea, large run button, results
 * table scrolls horizontally on narrow screens. Errors render as
 * red callouts. The confirm-mutation flow is a single checkbox above
 * the run button so it's visible at the moment of submit, not behind
 * a modal.
 */
export function SqlPanel({ isOwner }: { isOwner: boolean }) {
  const [query, setQuery] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [result, setResult] = useState<SqlResult | null>(null);
  const [pending, startTransition] = useTransition();

  const isMutation = /^\s*(INSERT|UPDATE|DELETE|MERGE|UPSERT)\b/i.test(query);
  const canRun = !pending && query.trim().length > 0 && (!isMutation || (isOwner && acknowledge));

  function run() {
    setResult(null);
    startTransition(async () => {
      const r = await runSqlQuery({ query, acknowledge });
      setResult(r);
      // Auto-uncheck after a successful mutation so a second click
      // doesn't accidentally re-run.
      if (r.ok && isMutation) setAcknowledge(false);
    });
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
        🛢 SQL console
      </h2>
      <p className="mt-1 text-[11px] text-zinc-400">
        Single statement. Reads run free; writes require owner role + explicit acknowledge.
      </p>

      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        rows={10}
        spellCheck={false}
        placeholder={`select count(*) from bills where active = true;\n\n-- or\n-- update site_config set emergency_title = 'New title' where id = true;`}
        className="mt-3 w-full rounded border border-zinc-800 bg-black px-3 py-2 text-[13px] text-zinc-100 placeholder-zinc-700 focus:border-emerald-500 focus:outline-none"
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      />

      {isMutation && (
        <label className={`mt-3 flex items-start gap-2 rounded border p-2 text-[11px] ${
          isOwner ? "border-amber-700/40 bg-amber-950/15 text-amber-200" : "border-red-700/40 bg-red-950/15 text-red-200"
        }`}>
          <input
            type="checkbox"
            checked={acknowledge}
            onChange={(e) => setAcknowledge(e.target.checked)}
            disabled={!isOwner}
            className="mt-0.5"
          />
          <span>
            {isOwner ? (
              <>
                <strong>This is a mutation.</strong> Check this box to confirm you intend to write
                to the database. Audit-logged with your query and email.
              </>
            ) : (
              <>
                <strong>Mutations require owner role.</strong> You&apos;re signed in as admin. Ask the
                owner to run this from their account.
              </>
            )}
          </span>
        </label>
      )}

      <button
        type="button"
        onClick={run}
        disabled={!canRun}
        className="mt-3 min-h-[44px] rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
      >
        {pending ? "Running…" : isMutation ? "⚠ Run mutation" : "Run query"}
      </button>

      {result && !result.ok && (
        <p className="mt-3 rounded border border-red-700/40 bg-red-950/20 p-3 text-[11px] text-red-200">
          <strong>Error:</strong> {result.error}
        </p>
      )}

      {result && result.ok && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-emerald-300">
            ✓ {result.rowCount} row{result.rowCount === 1 ? "" : "s"} · {result.elapsedMs}ms
            {result.truncated && " · truncated to 500 rows for display"}
          </p>
          {result.rows.length > 0 && (
            <div className="overflow-x-auto rounded border border-zinc-800">
              <table className="min-w-full text-[11px]">
                <thead className="bg-zinc-950 text-[10px] uppercase tracking-wider text-zinc-400">
                  <tr>
                    {Object.keys(result.rows[0]).map((col) => (
                      <th key={col} className="border-b border-zinc-800 px-2 py-1.5 text-left">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                      {Object.keys(result.rows[0]).map((col) => (
                        <td key={col} className="px-2 py-1.5 font-mono text-zinc-300">
                          {formatCell(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.rows.length === 0 && (
            <p className="text-[11px] text-zinc-500 italic">No rows returned.</p>
          )}
        </div>
      )}
    </section>
  );
}

function formatCell(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 200);
  return String(v).slice(0, 300);
}
