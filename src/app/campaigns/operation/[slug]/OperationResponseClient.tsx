"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/**
 * Client island for the Operation Response page.
 *
 * Two responsibilities:
 *   1. Render the scope filter as a row of pills (my state / top 5 /
 *      all) that link to /campaigns/operation/[slug]?scope=...
 *   2. Per-row: build a posture-driven mailto: link with the user's
 *      profile pre-filled, and let the user edit the message inline
 *      before launching their mail client.
 *
 * No DB writes from this island — the entire MVP is read-only intel
 * + mailto: launches. Action-log tracking will come in v2.
 */

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

const POSTURE_VERB: Record<string, "oppose" | "support" | "improve" | "review"> = {
  restrictive: "oppose",
  protective: "support",
  regulatory: "improve",
  mixed: "review",
};

function defaultTemplate(args: {
  posture: string;
  billNumber: string;
  state: string;
  legislatorTitle: string;
  legislatorName: string;
  viewerName: string;
  viewerCity: string | null;
  viewerZip: string | null;
}) {
  const verb = POSTURE_VERB[args.posture] ?? "review";
  const greeting = `Dear ${args.legislatorTitle} ${args.legislatorName.split(" ").slice(-1)[0]},`;
  const cityZip = args.viewerCity && args.viewerZip
    ? `${args.viewerCity}, ${args.state} ${args.viewerZip}`
    : args.state;
  const closing = `Sincerely,\n${args.viewerName}\n${cityZip}`;

  if (verb === "oppose") {
    return [
      greeting,
      "",
      `I am writing as a constituent to urge you to vote NO on ${args.billNumber}.`,
      "",
      "Kratom is a botanical that millions of adults use responsibly. Restrictive bills like this one cut off responsible adults from a substance with a long traditional-use record, while doing little to address actual public-health concerns. Reasonable consumer-protection standards — age limits, labeling, lab testing — are the right framework, not prohibition.",
      "",
      "I would welcome the chance to share more about why this matters to me personally.",
      "",
      closing,
    ].join("\n");
  }
  if (verb === "support") {
    return [
      greeting,
      "",
      `I am writing as a constituent to urge you to support ${args.billNumber}.`,
      "",
      "This bill takes a reasonable consumer-protection approach to kratom — age limits, accurate labeling, and lab testing — without resorting to prohibition. That framework protects consumers while keeping a safe option available for the millions of adults who rely on it.",
      "",
      "Thank you for your leadership on this.",
      "",
      closing,
    ].join("\n");
  }
  if (verb === "improve") {
    return [
      greeting,
      "",
      `I am writing as a constituent about ${args.billNumber}.`,
      "",
      "I support reasonable regulation of kratom — age limits, labeling, lab testing all make sense. I urge you to ensure any new requirements are evidence-based, narrowly tailored, and don't create barriers to access for the responsible adults who rely on this botanical.",
      "",
      "I would welcome the chance to discuss specifics.",
      "",
      closing,
    ].join("\n");
  }
  return [
    greeting,
    "",
    `I am writing as a constituent about ${args.billNumber}.`,
    "",
    "I urge you to consider the impact on the millions of adults who use kratom responsibly when evaluating this legislation.",
    "",
    closing,
  ].join("\n");
}

function subjectFor(posture: string, billNumber: string) {
  const verb = POSTURE_VERB[posture] ?? "review";
  if (verb === "oppose") return `Constituent: please vote NO on ${billNumber}`;
  if (verb === "support") return `Constituent: please support ${billNumber}`;
  if (verb === "improve") return `Constituent input on ${billNumber}`;
  return `Constituent input on ${billNumber}`;
}

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
  viewerCity,
  viewerZip,
  scopeCounts,
}: {
  cluster: { slug: string; name: string; posture: string };
  rows: ActionRow[];
  scope: "my" | "top5" | "all";
  myState: string | null;
  viewerName: string | null;
  viewerCity: string | null;
  viewerZip: string | null;
  scopeCounts: { my: number; top5: number; all: number };
}) {
  const effectiveName = viewerName?.trim() || "An iKratom advocate";

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
            <ActionRowCard
              key={r.bill.id}
              row={r}
              posture={cluster.posture}
              viewerName={effectiveName}
              viewerCity={viewerCity}
              viewerZip={viewerZip}
            />
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

function ActionRowCard({
  row,
  posture,
  viewerName,
  viewerCity,
  viewerZip,
}: {
  row: ActionRow;
  posture: string;
  viewerName: string;
  viewerCity: string | null;
  viewerZip: string | null;
}) {
  const target = row.target;
  const stanceClass = STANCE_TONE[row.stance] ?? STANCE_TONE.unknown;

  // Templates render once per row on the client; user edits in the
  // textarea before launching mailto:. We keep edits in local state.
  const initialSubject = useMemo(
    () => subjectFor(posture, row.bill.bill_number),
    [posture, row.bill.bill_number],
  );
  const initialBody = useMemo(() => defaultTemplate({
    posture,
    billNumber: row.bill.bill_number,
    state: row.bill.state,
    legislatorTitle: target?.title ?? roleTitle(target?.role ?? ""),
    legislatorName: target?.full_name ?? "Legislator",
    viewerName,
    viewerCity,
    viewerZip,
  }), [posture, row.bill.bill_number, row.bill.state, target, viewerName, viewerCity, viewerZip]);

  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [expanded, setExpanded] = useState(false);

  const mailtoHref = useMemo(() => {
    if (!target?.email) return null;
    const params = new URLSearchParams({ subject, body });
    return `mailto:${target.email}?${params.toString()}`;
  }, [target, subject, body]);

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
        {mailtoHref ? (
          <a
            href={mailtoHref}
            className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            📧 Compose email
          </a>
        ) : (
          <span className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-500">
            No email on file
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-zinc-400 hover:text-emerald-400"
        >
          {expanded ? "Hide template" : "Edit message"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Subject</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Message body</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950/60 px-2 py-2 text-[11px] leading-relaxed text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
          </label>
        </div>
      )}
    </li>
  );
}

function roleTitle(role: string): string {
  if (role === "us_senate") return "Senator";
  if (role === "us_house") return "Representative";
  if (role === "state_senate") return "State Senator";
  if (role === "state_house") return "Representative";
  return "Legislator";
}
