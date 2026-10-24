"use client";

import { useState } from "react";
import type { Legislator } from "@/lib/legislators";
import { ROLE_SHORT } from "@/lib/legislators";
import { recordByAxis, recordFact, statusWord, type Axis, type RecordEntry } from "@/lib/kratom-record";

/**
 * Per-target facts for the recipient chips. `record` is the official kratom
 * record (bills sponsored, recorded votes; src/lib/kratom-record.ts). The chips
 * used to read legislator_stance, a champion/hostile label that no human wrote,
 * readable only by verified members, so most members saw nothing (2026-10-24).
 * We never label a named official for or against (memory:
 * stance-neutral-tracker-decision); only what the record shows.
 */
export type TargetIntelSignal = {
  record: RecordEntry[];
  flagged_industries: Array<{ industry: string; label: string; amount: number }>;
  kratom_adjacent_trades: number;
};

const AXES: [Axis, string][] = [["natural_leaf", "Natural leaf"], ["seven_oh", "7-OH"]];

/**
 * Recipient list with a "Show all N" toggle so 100+ chips don't blow out the
 * page on state-floor campaigns (cap of 12 tuned for one mobile screen). A tap
 * opens a name's details inline: touch screens have no hover, so nothing lives
 * only in a tooltip.
 */
export function RecipientChips({ targets, intel }: { targets: Legislator[]; intel: Record<string, TargetIntelSignal> }) {
  const CAP = 12;
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const visible = expanded ? targets : targets.slice(0, CAP);
  const hidden = Math.max(0, targets.length - CAP);
  const more = "rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-400 hover:border-emerald-500 hover:text-emerald-300";

  return (
    <>
      <p className="mt-3 text-[10px] text-zinc-500">
        Tap a name for details: the kratom bills they sponsored, how they voted, and their full briefing.
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {visible.map((t) => {
          const sig = intel[t.id];
          const open = openId === t.id;
          const bills = sig?.record.length ?? 0;
          const industryCount = sig?.flagged_industries.length ?? 0;
          const tradeCount = sig?.kratom_adjacent_trades ?? 0;
          return (
            <li key={t.id} className={open ? "w-full" : undefined}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : t.id)}
                title={`${bills > 0 ? `${bills} kratom bill${bills === 1 ? "" : "s"} on record` : "No recorded position yet"} · tap for details`}
                className="rounded-full border border-emerald-700/40 bg-emerald-950/20 px-3 py-1 text-left text-xs hover:border-emerald-500"
              >
                <span className="text-emerald-300">{ROLE_SHORT[t.role] ?? t.role}</span>{" "}
                <span className="text-zinc-200">{t.full_name}</span>
                {t.district && <span className="text-zinc-500"> · D{t.district}</span>}
                {bills > 0 && <span className="ml-1.5 rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-300">📜{bills}</span>}
                {industryCount > 0 && <span className="ml-1 rounded bg-red-950/40 px-1 py-0.5 text-[10px] font-bold text-red-200">⚠{industryCount}</span>}
                {tradeCount > 0 && <span className="ml-1 rounded bg-red-950/40 px-1 py-0.5 text-[10px] font-bold text-red-200">📈{tradeCount}</span>}
                <span aria-hidden="true" className="ml-1 text-zinc-500">{open ? "▴" : "▾"}</span>
              </button>
              {open && <ChipDetail target={t} sig={sig} />}
            </li>
          );
        })}
        {hidden > 0 && !expanded && (
          <li><button type="button" onClick={() => setExpanded(true)} className={more}>+ {hidden} more →</button></li>
        )}
        {expanded && targets.length > CAP && (
          <li><button type="button" onClick={() => setExpanded(false)} className={more}>Show fewer ↑</button></li>
        )}
      </ul>
    </>
  );
}

function ChipDetail({ target, sig }: { target: Legislator; sig: TargetIntelSignal | undefined }) {
  const rows = recordByAxis(sig?.record ?? []);
  return (
    <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs">
      {AXES.map(([axis, label]) => (
        <div key={axis} className="mb-2">
          <p className="font-semibold text-zinc-300">{label}</p>
          {rows[axis].length > 0 ? <Facts entries={rows[axis]} /> : <p className="text-zinc-500">No recorded position yet</p>}
        </div>
      ))}
      {rows.other.length > 0 && (
        <div className="mb-2">
          <p className="font-semibold text-zinc-300">Other kratom bills</p>
          <Facts entries={rows.other} />
        </div>
      )}
      {(sig?.flagged_industries.length ?? 0) > 0 && (
        <p className="mb-1 text-red-200">
          ⚠ Campaign money from industries advocates flag:{" "}
          {sig!.flagged_industries.map((i) => `${i.label} $${i.amount.toLocaleString()}`).join(", ")}
        </p>
      )}
      {(sig?.kratom_adjacent_trades ?? 0) > 0 && (
        <p className="mb-1 text-red-200">📈 {sig!.kratom_adjacent_trades} kratom-adjacent personal stock trade{sig!.kratom_adjacent_trades === 1 ? "" : "s"} (financial disclosures)</p>
      )}
      <p className="text-[10px] text-zinc-500">
        From the official record: bills they sponsored and their recorded votes. iKratom never labels anyone for or against.
      </p>
      <a href={`/legislators/${target.id}/briefing`} className="mt-1 inline-block text-emerald-400 hover:underline">
        Full briefing →
      </a>
    </div>
  );
}

function Facts({ entries }: { entries: RecordEntry[] }) {
  return (
    <ul className="space-y-1">
      {entries.map((e) => (
        <li key={e.billKey}>
          <a href={`/bills/${e.billId}`} className="text-zinc-200 hover:underline">{e.billNumber}</a>
          {e.title && <span className="text-zinc-400"> — {e.title.length > 90 ? `${e.title.slice(0, 89)}…` : e.title}</span>}
          <span className="text-zinc-500"> · {statusWord(e.status)}</span>
          <span className="block text-zinc-300">{recordFact(e)}</span>
        </li>
      ))}
    </ul>
  );
}
