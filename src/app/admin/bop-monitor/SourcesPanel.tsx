"use client";

import { useState, useTransition } from "react";
import {
  setBopSourceEnabled,
  runBopSourceNow,
  updateBopSource,
} from "@/modules/bop/actions";

type Source = {
  id: string;
  state: string;
  board_name: string;
  surface: string;
  kind: string;
  agenda_url: string;
  adapter: string;
  enabled: boolean;
  notes: string | null;
  last_scraped_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_finding_count: number;
};

export function SourcesPanel({ sources }: { sources: Source[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="p-2 text-left">State</th>
            <th className="p-2 text-left">Board · Surface</th>
            <th className="p-2 text-left">Adapter</th>
            <th className="p-2 text-left">Last scrape</th>
            <th className="p-2 text-left">Status</th>
            <th className="p-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
          {sources.map((s) => (
            <SourceRow key={s.id} source={s} />
          ))}
          {sources.length === 0 && (
            <tr>
              <td colSpan={6} className="p-6 text-center text-xs text-zinc-500">
                No sources seeded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SourceRow({ source }: { source: Source }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState(source.agenda_url);

  function toggle() {
    setMsg(null);
    startTransition(async () => {
      const r = await setBopSourceEnabled({
        sourceId: source.id,
        enabled: !source.enabled,
      });
      if ("error" in r) setMsg(`✗ ${(r.error ?? "Failed").slice(0, 80)}`);
      else setMsg("✓ Saved");
      setTimeout(() => setMsg(null), 3000);
    });
  }

  function runNow() {
    setMsg(null);
    startTransition(async () => {
      const r = await runBopSourceNow({ sourceId: source.id });
      if ("error" in r) {
        setMsg(`✗ ${(r.error ?? "Failed").slice(0, 80)}`);
      } else {
        setMsg(`✓ ${r.inserted} new`);
      }
      setTimeout(() => setMsg(null), 5000);
    });
  }

  function saveUrl() {
    setMsg(null);
    startTransition(async () => {
      const r = await updateBopSource({
        sourceId: source.id,
        agendaUrl: draftUrl,
      });
      if ("error" in r) {
        setMsg(`✗ ${(r.error ?? "Failed").slice(0, 80)}`);
      } else {
        setMsg("✓ URL saved");
        setEditing(false);
      }
      setTimeout(() => setMsg(null), 3000);
    });
  }

  return (
    <tr>
      <td className="p-2 font-mono text-xs text-zinc-300">{source.state}</td>
      <td className="p-2">
        <div className="font-medium text-zinc-100">{source.board_name}</div>
        <div className="text-[11px] text-zinc-500">
          {source.surface} · <span className="text-zinc-600">{source.kind}</span>
        </div>
        {editing ? (
          <div className="mt-1 flex gap-1">
            <input
              type="url"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={saveUrl}
              disabled={pending}
              className="rounded-md bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setDraftUrl(source.agenda_url);
              }}
              className="rounded-md border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:border-zinc-500"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="mt-0.5 flex items-center gap-1.5">
            <a
              href={source.agenda_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block break-all text-[10px] text-emerald-400 hover:underline"
            >
              {source.agenda_url}
            </a>
            <button
              onClick={() => setEditing(true)}
              className="text-[10px] text-zinc-500 hover:text-emerald-400"
              title="Edit URL"
            >
              ✏
            </button>
          </div>
        )}
        {source.notes && (
          <p className="mt-1 text-[10px] italic text-zinc-500">{source.notes}</p>
        )}
      </td>
      <td className="p-2 font-mono text-[11px] text-zinc-400">{source.adapter}</td>
      <td className="p-2 text-[11px] text-zinc-400">
        {source.last_scraped_at
          ? new Date(source.last_scraped_at).toLocaleString()
          : "—"}
        <div className="text-[10px] text-zinc-600">{source.last_finding_count} prior</div>
      </td>
      <td className="p-2 text-[11px]">
        {source.last_status === "ok" && (
          <span className="rounded bg-emerald-950/50 px-1.5 py-0.5 text-emerald-300">ok</span>
        )}
        {source.last_status === "no_findings" && (
          <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">empty</span>
        )}
        {source.last_status === "error" && (
          <span
            title={source.last_error ?? ""}
            className="rounded bg-red-950/50 px-1.5 py-0.5 text-red-300"
          >
            error
          </span>
        )}
        {!source.last_status && (
          <span className="text-zinc-600">never</span>
        )}
      </td>
      <td className="p-2 text-right">
        <div className="flex justify-end gap-1.5">
          <button
            onClick={toggle}
            disabled={pending}
            className={`rounded-md border px-2 py-1 text-[11px] ${
              source.enabled
                ? "border-emerald-700/40 bg-emerald-950/20 text-emerald-300 hover:border-emerald-500"
                : "border-zinc-700 text-zinc-300 hover:border-emerald-500 hover:text-emerald-400"
            } disabled:opacity-40`}
          >
            {source.enabled ? "Enabled" : "Disabled"}
          </button>
          <button
            onClick={runNow}
            disabled={pending}
            className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-emerald-500 hover:text-emerald-400 disabled:opacity-40"
          >
            {pending ? "…" : "Scrape now"}
          </button>
        </div>
        {msg && <p className="mt-1 text-[10px] text-zinc-400">{msg}</p>}
      </td>
    </tr>
  );
}
