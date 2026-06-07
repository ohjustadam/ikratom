"use client";

import { useState, useTransition } from "react";
import {
  setCampaignAutoApprovePolicy,
  emergencyStopCampaignAutoApprove,
  type CampaignAutoApprovePolicy,
  type AutoDecisionRow,
} from "@/modules/admin/campaign-autoapprove-actions";

/**
 * Owner control for the campaign auto-approve engine. The owner tunes RULES
 * here (never individual items): the off/shadow/live mode, the safety knobs,
 * and an emergency stop — plus a readable view of what the engine has decided
 * (the shadow ledger) so they can judge it BEFORE promoting to live.
 *
 * Going LIVE fires irreversible legislator notifications, so live + auto-reject
 * are owner-only; the panel disables those controls for non-owners (the server
 * action enforces it regardless).
 */

const MODE_BADGE: Record<string, string> = {
  off: "bg-zinc-800 text-zinc-400",
  shadow: "bg-sky-950/50 text-sky-300",
  live: "bg-emerald-950/50 text-emerald-300",
};

const DECISION_BADGE: Record<string, string> = {
  approve: "bg-emerald-950/50 text-emerald-300",
  supersede: "bg-zinc-800 text-zinc-400",
  reject: "bg-red-950/50 text-red-300",
  escalate: "bg-amber-950/40 text-amber-300",
};

export function CampaignAutoApprovePolicyPanel({
  initial,
  isOwner,
  recentDecisions,
}: {
  initial: CampaignAutoApprovePolicy;
  isOwner: boolean;
  recentDecisions: AutoDecisionRow[];
}) {
  const [mode, setMode] = useState(initial.mode);
  const [requireSource, setRequireSource] = useState(initial.requireSource);
  const [rejectEnabled, setRejectEnabled] = useState(initial.rejectEnabled);
  const [minConfidence, setMinConfidence] = useState(initial.minConfidence);
  const [maxPerRun, setMaxPerRun] = useState(initial.maxPerRun);
  const [maxPerDay, setMaxPerDay] = useState(initial.maxPerDay);
  const [minAgeHours, setMinAgeHours] = useState(initial.minAgeHours);
  const [staleDays, setStaleDays] = useState(initial.staleDays);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const dormant = !initial.migrationApplied;

  function save() {
    setMsg(null);
    startTransition(async () => {
      const r = await setCampaignAutoApprovePolicy({
        mode, requireSource, rejectEnabled, minConfidence, maxPerRun, maxPerDay, minAgeHours, staleDays,
      });
      setMsg(r && "error" in r && r.error ? `✗ ${r.error}` : "✓ Policy saved — applies on the next hourly run");
    });
  }
  function emergencyStop() {
    if (!confirm("Drop the engine to SHADOW now? It keeps logging but stops approving/superseding.")) return;
    setMsg(null);
    startTransition(async () => {
      const r = await emergencyStopCampaignAutoApprove();
      if (r && "error" in r && r.error) setMsg(`✗ ${r.error}`);
      else { setMode("shadow"); setMsg("✓ Emergency stop — engine is back in shadow"); }
    });
  }

  return (
    <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">🤖 Campaign auto-approve</h2>
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${MODE_BADGE[mode] ?? MODE_BADGE.off}`}>
          {mode}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        Hourly, the engine decides each auto-generated pending campaign: approve / supersede (dedup) / escalate (leave for you).
        <strong className="text-zinc-300"> Shadow</strong> only logs what it would do. <strong className="text-zinc-300">Live</strong> applies
        approvals — which send real legislator emails (irreversible). The ambiguous middle always escalates back to this queue.
      </p>

      {dormant && (
        <div className="mt-3 rounded border border-amber-700/50 bg-amber-950/30 p-2.5 text-[11px] text-amber-200">
          ⚠ Dormant — migrations 0182/0183 aren&apos;t applied yet. Run <code className="rounded bg-black/40 px-1">npm run db:push</code> to
          activate. Controls below save once the policy table exists.
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          <span className="font-semibold text-zinc-300">Mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as CampaignAutoApprovePolicy["mode"])}
            disabled={pending}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
          >
            <option value="off">Off — do nothing</option>
            <option value="shadow">Shadow — log only</option>
            <option value="live" disabled={!isOwner}>Live — apply{!isOwner ? " (owner only)" : ""}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          <span className="font-semibold text-zinc-300">Min confidence <span className="font-normal text-zinc-500">(bill-linked only)</span></span>
          <input
            type="range" min={0.5} max={1} step={0.05} value={minConfidence}
            onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
            disabled={pending}
            className="accent-emerald-500"
          />
          <span className="text-zinc-500">{minConfidence.toFixed(2)}</span>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          <span className="font-semibold text-zinc-300">Max / run · / day</span>
          <div className="flex gap-1">
            <input type="number" min={1} max={100} value={maxPerRun} disabled={pending}
              onChange={(e) => setMaxPerRun(parseInt(e.target.value) || 10)}
              className="w-16 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm" />
            <input type="number" min={1} max={500} value={maxPerDay} disabled={pending}
              onChange={(e) => setMaxPerDay(parseInt(e.target.value) || 40)}
              className="w-16 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm" />
          </div>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          <span className="font-semibold text-zinc-300">Min age (h) · stale (d)</span>
          <div className="flex gap-1">
            <input type="number" min={0} max={168} value={minAgeHours} disabled={pending}
              onChange={(e) => setMinAgeHours(parseInt(e.target.value) || 0)}
              className="w-16 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm" />
            <input type="number" min={1} max={365} value={staleDays} disabled={pending}
              onChange={(e) => setStaleDays(parseInt(e.target.value) || 45)}
              className="w-16 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm" />
          </div>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-5">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
          <input type="checkbox" checked={requireSource} disabled={pending}
            onChange={(e) => setRequireSource(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
          Require source link
        </label>
        <label className={`flex items-center gap-2 text-sm ${isOwner ? "cursor-pointer text-zinc-200" : "text-zinc-600"}`}>
          <input type="checkbox" checked={rejectEnabled} disabled={pending || !isOwner}
            onChange={(e) => setRejectEnabled(e.target.checked)} className="h-4 w-4 accent-red-500" />
          Enable auto-reject{!isOwner ? " (owner only)" : ""}
        </label>
        <span className="grow" />
        <button onClick={emergencyStop} disabled={pending}
          className="rounded-md border border-red-700/50 bg-red-950/30 px-3 py-1.5 text-xs font-bold text-red-300 hover:border-red-500 disabled:opacity-50">
          ⛔ Emergency stop
        </button>
        <button onClick={save} disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
          {pending ? "Saving…" : "Save policy"}
        </button>
      </div>
      {msg && <p className={`mt-2 text-[11px] ${msg.startsWith("✗") ? "text-red-400" : "text-emerald-400"}`}>{msg}</p>}

      <details className="mt-4 text-[11px] text-zinc-500">
        <summary className="cursor-pointer text-zinc-400">What counts as a campaign?</summary>
        <p className="mt-2 leading-relaxed">
          A pending auto-campaign is <strong>approved</strong> only if its source alert is a real live action
          (a bill in motion, a Board-of-Pharmacy hearing, or an agency ban/scheduling push), has a source link,
          isn&apos;t a duplicate, has legislator targets, and is at least the min-age old. Already-concluded events
          (signed into law, takes effect), recalls, lawsuits, seizures, advisories, and wrong-state items are never
          approved — they escalate (or auto-reject only if you enable it). Suppression is by event shape, never by
          which side or org is involved. Changing those rules requires a code change + nonpartisan review.
        </p>
      </details>

      {recentDecisions.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Recent engine decisions</h3>
          <ul className="mt-2 divide-y divide-zinc-900 rounded border border-zinc-900">
            {recentDecisions.map((d) => (
              <li key={d.id} className="flex items-start gap-2 p-2 text-[11px]">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${DECISION_BADGE[d.decision] ?? "bg-zinc-800 text-zinc-400"}`}>
                  {d.decision}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-zinc-300">{d.title ?? d.campaign_id?.slice(0, 8) ?? "—"}</span>
                  <span className="text-zinc-600"> — {d.review_reason}</span>
                </span>
                <span className="shrink-0 text-zinc-600">
                  {d.applied ? "applied" : d.mode === "shadow" ? "shadow" : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
