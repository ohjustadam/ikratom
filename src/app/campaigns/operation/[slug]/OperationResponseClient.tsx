"use client";

import Link from "next/link";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";
import { POSTURE_STANCE } from "@/modules/compose/default-letter";

/**
 * Client island for the Operation Response page.
 *
 * Renders the scope filter pills and, per bill row, the shared email
 * composer (EmailOfficialButton) targeting that bill's primary sponsor.
 * The composer supplies the posture-aware prefill, AI draft from the
 * viewer's profile + kratom story, in-app editing, Gmail/Outlook/mailto,
 * a contact-form fallback, and send-logging — identical to every other
 * official-contact surface. (Previously this island hand-built a posture
 * template + bare mailto with no character customization and no logging.)
 */

// Cluster posture → the composer's stance hint (shapes the ask sentence).
type LegInfo = {
  id: string;
  full_name: string;
  state: string;
  role: string;
  party: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
};

type BillJoined = {
  id: string; state: string; bill_number: string; title: string | null;
  status: string | null; kratom_relevance: string | null;
  current_committee_name: string | null;
  last_action_at: string | null;
};

export type ActionRow = {
  bill: BillJoined;
  target: LegInfo | null;
  stance: string;
};

const STANCE_TONE: Record<string, string> = {
  hostile: "border-red-700/50 bg-red-950/15 text-red-200",
  neutral: "border-zinc-700 bg-zinc-900/40 text-zinc-300",
  unknown: "border-zinc-700 bg-zinc-900/40 text-zinc-400",
  sympathetic: "border-emerald-700/50 bg-emerald-950/15 text-emerald-200",
  champion: "border-emerald-500/50 bg-emerald-950/20 text-emerald-200",
};
const STANCE_EMOJI: Record<string, string> = {
  hostile: "🚫", neutral: "⚖", unknown: "❓",
  sympathetic: "🤝", champion: "⭐",
};

export function OperationResponseClient({
  cluster,
  rows,
  scope,
  myState,
  viewerName,
  scopeCounts,
}: {
  cluster: { slug: string; name: string; posture: string };
  rows: ActionRow[];
  scope: "my" | "top5" | "all";
  myState: string | null;
  viewerName: string | null;
  // viewerCity/viewerZip are no longer needed — the shared composer pulls the
  // viewer's profile itself. Parent may still pass them; ignored here.
  viewerCity?: string | null;
  viewerZip?: string | null;
  scopeCounts: { my: number; top5: number; all: number };
}) {
  return (
    <div>
      {/* Scope pills */}
      <nav className="mb-5 flex flex-wrap gap-2 text-xs">
        {myState && (
          <ScopePill
            href={`/campaigns/operation/${cluster.slug}?scope=my`}
            active={scope === "my"}
            label={`📍 My state (${myState})`}
            count={scopeCounts.my}
          />
        )}
        <ScopePill
          href={`/campaigns/operation/${cluster.slug}?scope=top5`}
          active={scope === "top5"}
          label="🔥 Top 5 most active"
          count={scopeCounts.top5}
        />
        <ScopePill
          href={`/campaigns/operation/${cluster.slug}?scope=all`}
          active={scope === "all"}
          label="🌐 All states"
          count={scopeCounts.all}
        />
      </nav>

      {!viewerName && (
        <p className="mb-4 rounded-md border border-amber-700/40 bg-amber-950/10 p-3 text-[11px] text-amber-200">
          💡 <Link href="/login" className="font-semibold underline">Sign in</Link> to auto-fill your name + city into each message.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-6 text-center text-sm text-zinc-400">
          No actionable bills in this scope.
          {scope === "my" && myState && (
            <span> Switch scope to see active bills in other states.</span>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <ActionRowCard key={r.bill.id} row={r} posture={cluster.posture} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ScopePill({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 ${
        active
          ? "border-emerald-500 bg-emerald-950/30 font-semibold text-emerald-200"
          : "border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-emerald-500/60"
      }`}
    >
      {label} <span className="opacity-70">({count})</span>
    </Link>
  );
}

function ActionRowCard({ row, posture }: { row: ActionRow; posture: string }) {
  const target = row.target;
  const stanceClass = STANCE_TONE[row.stance] ?? STANCE_TONE.unknown;

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-200">
          {row.bill.state}
        </span>
        <Link href={`/bills/${row.bill.id}`} className="font-mono font-semibold text-zinc-100 hover:text-emerald-400">
          {row.bill.bill_number}
        </Link>
        {row.bill.status && (
          <span className="text-[10px] text-zinc-500">[{row.bill.status}]</span>
        )}
        {row.bill.current_committee_name && (
          <span className="text-[10px] text-amber-300">⚡ in {row.bill.current_committee_name}</span>
        )}
      </div>
      {row.bill.title && (
        <p className="mt-1 text-xs text-zinc-300">{row.bill.title}</p>
      )}

      {target && (
        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-2 text-[11px]">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-zinc-500">Target:</span>
            <Link href={`/legislators/${target.id}/briefing`} className="font-semibold text-zinc-100 hover:text-emerald-400">
              {target.full_name}
            </Link>
            <span className="font-mono text-[9px] uppercase text-zinc-500">{target.role.replace(/_/g, " ")}</span>
            {target.party && <span className="text-[10px] text-zinc-500">{target.party}</span>}
            <span className={`rounded border px-1.5 py-0.5 text-[10px] ${stanceClass}`}>
              {STANCE_EMOJI[row.stance]} {row.stance}
            </span>
          </div>
          <div className="mt-1 font-mono text-[10px] text-zinc-400">{target.email}</div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {target ? (
          <EmailOfficialButton
            official={{
              id: target.id,
              name: target.full_name,
              role: target.role,
              title: target.title,
              state: target.state,
              email: target.email,
            }}
            context={{ kind: "bill", billId: row.bill.id, stance: POSTURE_STANCE[posture] ?? "neutral" }}
            source="operation_sponsor"
            variant="button"
            label="📧 Compose email"
          />
        ) : (
          <span className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-500">
            No sponsor on file
          </span>
        )}
      </div>
    </li>
  );
}
