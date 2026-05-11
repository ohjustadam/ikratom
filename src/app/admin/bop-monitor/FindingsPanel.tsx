"use client";

import { useState, useTransition } from "react";
import { reviewBopFinding, emitBopAlert } from "@/modules/bop/actions";

type Finding = {
  id: string;
  state: string;
  title: string;
  snippet: string | null;
  url: string | null;
  classified_relevance: string;
  classified_severity: string;
  reviewed_at: string | null;
  reviewed_relevance: string | null;
  reviewed_severity: string | null;
  alert_emitted_at: string | null;
  found_at: string;
};

export function FindingsPanel({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-6 text-center text-sm text-zinc-500">
        No findings yet. Enable a source above and click <strong>Scrape now</strong>.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {findings.map((f) => (
        <FindingCard key={f.id} finding={f} />
      ))}
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const relevance = finding.reviewed_relevance ?? finding.classified_relevance;
  const severity = finding.reviewed_severity ?? finding.classified_severity;
  const isHot = relevance === "kratom_direct" && severity === "hostile_proposal";

  function review(
    rel: "kratom_direct" | "kratom_adjacent" | "unrelated",
    sev: "hostile_proposal" | "discussion_only" | "supportive" | "neutral"
  ) {
    setMsg(null);
    startTransition(async () => {
      const r = await reviewBopFinding({
        findingId: finding.id,
        relevance: rel,
        severity: sev,
      });
      setMsg(r.error ? `✗ ${r.error.slice(0, 80)}` : "✓ Reviewed");
      setTimeout(() => setMsg(null), 3000);
    });
  }

  function emit() {
    if (!confirm("Promote to a public policy alert? This is visible to advocates.")) return;
    setMsg(null);
    startTransition(async () => {
      const r = await emitBopAlert({ findingId: finding.id });
      setMsg(r.error ? `✗ ${r.error.slice(0, 80)}` : "✓ Alert emitted");
      setTimeout(() => setMsg(null), 4000);
    });
  }

  return (
    <article
      className={`rounded-lg border p-4 ${
        isHot
          ? "border-red-700/40 bg-red-950/20"
          : relevance === "kratom_direct"
          ? "border-amber-700/40 bg-amber-950/10"
          : "border-zinc-800 bg-zinc-950/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">
            {finding.state} · {new Date(finding.found_at).toLocaleString()}
          </p>
          <h3 className="mt-0.5 font-medium text-zinc-100">{finding.title}</h3>
          {finding.snippet && (
            <p className="mt-1 text-xs text-zinc-400">{finding.snippet}</p>
          )}
          {finding.url && (
            <a
              href={finding.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block break-all text-[11px] text-emerald-400 hover:underline"
            >
              {finding.url}
            </a>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 text-[10px]">
          <Tag label={relevance} kind={relevance === "kratom_direct" ? "danger" : relevance === "kratom_adjacent" ? "warn" : "muted"} />
          <Tag label={severity} kind={severity === "hostile_proposal" ? "danger" : severity === "supportive" ? "ok" : "muted"} />
          {finding.alert_emitted_at && <Tag label="alert emitted" kind="ok" />}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
        <ReviewBtn onClick={() => review("kratom_direct", "hostile_proposal")} disabled={pending}>Hostile</ReviewBtn>
        <ReviewBtn onClick={() => review("kratom_direct", "discussion_only")} disabled={pending}>Discussion</ReviewBtn>
        <ReviewBtn onClick={() => review("kratom_direct", "supportive")} disabled={pending}>Supportive</ReviewBtn>
        <ReviewBtn onClick={() => review("kratom_adjacent", "neutral")} disabled={pending}>Adjacent</ReviewBtn>
        <ReviewBtn onClick={() => review("unrelated", "neutral")} disabled={pending}>Unrelated</ReviewBtn>
        <span className="grow" />
        {!finding.alert_emitted_at && relevance === "kratom_direct" && severity === "hostile_proposal" && (
          <button
            onClick={emit}
            disabled={pending}
            className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-zinc-50 hover:bg-red-500 disabled:opacity-40"
          >
            🚨 Emit policy alert
          </button>
        )}
        {msg && <span className="text-[11px] text-zinc-400">{msg}</span>}
      </div>
    </article>
  );
}

function Tag({ label, kind }: { label: string; kind: "danger" | "warn" | "ok" | "muted" }) {
  const cls =
    kind === "danger"
      ? "bg-red-950/50 text-red-300"
      : kind === "warn"
      ? "bg-amber-950/50 text-amber-300"
      : kind === "ok"
      ? "bg-emerald-950/50 text-emerald-300"
      : "bg-zinc-900 text-zinc-400";
  return (
    <span className={`rounded px-1.5 py-0.5 ${cls}`}>{label}</span>
  );
}

function ReviewBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-emerald-500 hover:text-emerald-400 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
