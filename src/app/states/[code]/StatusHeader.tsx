/**
 * Canonical per-state kratom + 7-OH status header (Mission Control PR5).
 *
 * Renders the answer-first band on /states/[code]: leaf (kratom) legality +
 * 7-OH legality, whether it's enacted law vs pending legislation, and a
 * confirmed-vs-auto badge. Prefers the admin-confirmed status over the
 * nightly auto-derived one. Returns null when there's no status row yet
 * (e.g. before the derivation has run) so the page degrades gracefully.
 *
 * Sourcing is neutral per platform policy: we cite the statute/bill basis
 * factually and never frame legality "per" any advocacy org.
 */
export type StateStatusData = {
  derived_leaf_status: string | null;
  derived_7oh_status: string | null;
  basis: string | null;
  admin_leaf_status: string | null;
  admin_7oh_status: string | null;
  admin_note: string | null;
  confirmed_at: string | null;
  leaf_evidence_bill: string | null;
  sevenoh_evidence_bill: string | null;
};

type Tone = "red" | "amber" | "emerald" | "blue" | "zinc";

// Green is reserved for ENACTED protection (a KCPA / pro-kratom law). "Legal"
// with no law on the books is unprotected — shown blue, not green — because no
// current law does not make a state safe.
const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  banned: { label: "Banned", tone: "red" },
  restricted: { label: "Restricted", tone: "amber" },
  kcpa: { label: "Protected · KCPA-regulated", tone: "emerald" },
  protected: { label: "Protected", tone: "emerald" },
  legal: { label: "Legal · no protections", tone: "blue" },
};

const TONE_CLS: Record<Tone, string> = {
  red: "border-red-700/50 bg-red-950/30 text-red-200",
  amber: "border-amber-700/50 bg-amber-950/25 text-amber-200",
  emerald: "border-emerald-700/50 bg-emerald-950/25 text-emerald-200",
  blue: "border-blue-700/50 bg-blue-950/30 text-blue-200",
  zinc: "border-zinc-700/50 bg-zinc-900/40 text-zinc-300",
};

function meta(status: string | null) {
  if (!status) return { label: "Not yet classified", tone: "zinc" as Tone };
  return STATUS_META[status] ?? { label: status, tone: "zinc" as Tone };
}

export function StatusHeader({
  status,
  billHrefs,
}: {
  status: StateStatusData | null;
  /** Optional bill_number → /bills/[id] map so the cited evidence bills
   *  become clickable for verification (the cross-reference payoff). */
  billHrefs?: Record<string, string>;
}) {
  if (!status) return null;
  const confirmed = !!(status.admin_leaf_status || status.admin_7oh_status || status.confirmed_at);
  // PUBLISH ONLY ADMIN-CONFIRMED STATUSES. A 2026-06-06 derive dry-run proved
  // the auto-derivation is unreliable for a legal surface: RI derives "banned"
  // but reversed its ban (→ legal); FL/IL/MO/etc. derive "banned" off PENDING
  // bills; IN/CT real bans mis-derive. A wrong "Banned" label on a legal market
  // is the worst error this surface can make — so unconfirmed auto-derivations
  // never surface publicly (they still feed the /admin/state-status queue).
  if (!confirmed) return null;
  const leaf = status.admin_leaf_status ?? status.derived_leaf_status;
  const sevenoh = status.admin_7oh_status ?? status.derived_7oh_status;
  if (!leaf && !sevenoh) return null;
  // Auto-derived from non-enacted bills = a pending threat, not current law.
  const pendingOnly = !confirmed && status.basis === "all-active";

  const leafM = meta(leaf);
  const sevenohM = meta(sevenoh);
  // Distinct evidence bill numbers, rendered as verification links when we
  // resolved an href for them.
  const evidence = Array.from(
    new Set([status.leaf_evidence_bill, status.sevenoh_evidence_bill].filter(Boolean) as string[]),
  );
  const billNode = (num: string) => {
    const href = billHrefs?.[num];
    return href ? (
      <a key={num} href={href} className="text-emerald-400 hover:underline">{num}</a>
    ) : (
      <span key={num}>{num}</span>
    );
  };

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md border px-2.5 py-1 text-sm font-semibold ${TONE_CLS[leafM.tone]}`}>
          Kratom leaf: {leafM.label}
        </span>
        <span className={`rounded-md border px-2.5 py-1 text-sm font-semibold ${TONE_CLS[sevenohM.tone]}`}>
          7-OH: {sevenohM.label}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-[11px] ${
            confirmed ? "bg-emerald-900/30 text-emerald-300" : "bg-zinc-800 text-zinc-400"
          }`}
          title={confirmed ? "Confirmed by an iKratom admin against statute." : "Automatically derived from tracked bills; not yet human-confirmed."}
        >
          {confirmed ? "✓ confirmed" : "auto-derived"}
        </span>
      </div>

      {pendingOnly && (
        <p className="mt-2 text-xs text-amber-300/90">
          ⚠ Based on <strong>pending legislation</strong>, not enacted law — treat as a current threat to track, not the state&apos;s standing law.
        </p>
      )}

      {status.admin_note && <p className="mt-2 text-xs text-zinc-300">{status.admin_note}</p>}

      <p className="mt-2 text-[11px] text-zinc-500">
        {evidence.length > 0 && (
          <>
            Basis:{" "}
            {evidence.map((num, i) => (
              <span key={num}>
                {i > 0 && " · "}
                {billNode(num)}
              </span>
            ))}{" "}
            (tracked legislation).{" "}
          </>
        )}
        Objective legality data; verify against the state statute. Not legal advice.
      </p>
    </div>
  );
}
