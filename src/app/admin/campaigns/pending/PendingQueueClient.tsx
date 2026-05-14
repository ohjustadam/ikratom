"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PendingRow } from "./page";
import { bulkReviewCampaigns } from "@/modules/admin/campaign-review-actions";

type CurrentParams = {
  state: string | null;
  q: string | null;
  hasBill: boolean | null;
  sort: string;
  showSuperseded: boolean;
};

type Props = {
  rows: PendingRow[];
  totalCount: number;
  stateCounts: Array<[string, number]>;
  currentParams: CurrentParams;
};

const SORT_OPTIONS = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "title-asc", label: "Title A→Z" },
  { key: "title-desc", label: "Title Z→A" },
  { key: "state", label: "State" },
];

export function PendingQueueClient({ rows, totalCount, stateCounts, currentParams }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState(currentParams.q ?? "");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && selected.size < rows.length;

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  function buildHref(patch: Partial<CurrentParams>): string {
    const merged: CurrentParams = { ...currentParams, ...patch };
    const usp = new URLSearchParams();
    if (merged.state) usp.set("state", merged.state);
    if (merged.q) usp.set("q", merged.q);
    if (merged.hasBill === true) usp.set("has_bill", "1");
    else if (merged.hasBill === false) usp.set("has_bill", "0");
    if (merged.sort && merged.sort !== "newest") usp.set("sort", merged.sort);
    if (merged.showSuperseded) usp.set("show_superseded", "1");
    const s = usp.toString();
    return s ? `?${s}` : "/admin/campaigns/pending";
  }

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }
  function toggleAll(on: boolean) {
    setSelected(on ? new Set(rows.map((r) => r.id)) : new Set());
  }

  function applyFilter(patch: Partial<CurrentParams>) {
    router.push(buildHref(patch));
    // Clear selection on filter change — the displayed rows are about to shift.
    setSelected(new Set());
  }

  function runBulk(action: "approve" | "reject" | "supersede" | "delete") {
    if (selectedIds.length === 0) return;
    const confirmText =
      action === "delete"
        ? `Permanently DELETE ${selectedIds.length} pending campaign(s)? This is irreversible.`
        : `${action === "approve" ? "Approve" : action === "reject" ? "Reject" : "Mark superseded"} ${selectedIds.length} campaign(s)?`;
    if (!confirm(confirmText)) return;

    let reason = "";
    if (action === "reject" || action === "supersede") {
      reason = prompt(
        action === "reject"
          ? "Optional reason (shown in audit log):"
          : "Optional reason (e.g. 'duplicate of campaign X'):"
      ) ?? "";
    }

    setMsg(null);
    startTransition(async () => {
      const r = await bulkReviewCampaigns({ ids: selectedIds, action, reason });
      if ("error" in r) {
        setMsg(`✗ ${(r.error ?? "Failed").slice(0, 120)}`);
        return;
      }
      setMsg(`✓ ${action} applied to ${r.affected} campaign(s)`);
      setSelected(new Set());
      router.refresh();
      setTimeout(() => setMsg(null), 4500);
    });
  }

  // Sorted state pills — only top 20 for visual hygiene; the search filter
  // covers anything below the cut.
  const stateChips = stateCounts.slice(0, 20);

  return (
    <>
      {/* Filter bar */}
      <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilter({ q: searchInput || null });
            }}
            placeholder="Search title…"
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={() => applyFilter({ q: searchInput || null })}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:border-emerald-500"
          >
            Search
          </button>

          <select
            value={currentParams.sort}
            onChange={(e) => applyFilter({ sort: e.target.value })}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>Sort: {s.label}</option>
            ))}
          </select>

          <select
            value={currentParams.hasBill === true ? "yes" : currentParams.hasBill === false ? "no" : "any"}
            onChange={(e) => {
              const v = e.target.value;
              applyFilter({ hasBill: v === "yes" ? true : v === "no" ? false : null });
            }}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm"
          >
            <option value="any">Bill link: any</option>
            <option value="yes">Has bill</option>
            <option value="no">No bill</option>
          </select>

          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={currentParams.showSuperseded}
              onChange={(e) => applyFilter({ showSuperseded: e.target.checked })}
              className="h-3.5 w-3.5"
            />
            Show superseded
          </label>
        </div>

        {/* State pills */}
        <div className="mt-3 flex flex-wrap gap-1">
          <a
            href={buildHref({ state: null })}
            className={`rounded-full px-2.5 py-0.5 text-xs ${!currentParams.state ? "bg-emerald-500 text-zinc-950 font-semibold" : "bg-zinc-900 text-zinc-400 hover:text-emerald-400"}`}
          >
            all states
          </a>
          {stateChips.map(([state, n]) => (
            <a
              key={state}
              href={buildHref({ state })}
              className={`rounded-full px-2.5 py-0.5 text-xs ${currentParams.state === state ? "bg-emerald-500 text-zinc-950 font-semibold" : "bg-zinc-900 text-zinc-300 hover:text-emerald-400"}`}
            >
              {state === "NONE" ? "no state" : state} · {n}
            </a>
          ))}
        </div>
      </section>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
          <p className="text-3xl">✓</p>
          <p className="mt-2">No campaigns match this filter.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="p-2 text-left w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={(e) => toggleAll(e.target.checked)}
                    aria-label="Select all"
                  />
                </th>
                <th className="p-2 text-left">State</th>
                <th className="p-2 text-left">Title</th>
                <th className="p-2 text-left">Correlation</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
              {rows.map((c) => {
                const bill = Array.isArray(c.bills) ? c.bills[0] : c.bills;
                const isChecked = selected.has(c.id);
                const isSuperseded = c.review_state === "superseded";
                return (
                  <tr
                    key={c.id}
                    className={`${isChecked ? "bg-emerald-950/15" : ""} ${isSuperseded ? "opacity-50" : ""}`}
                  >
                    <td className="p-2 align-top">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => toggleOne(c.id, e.target.checked)}
                        aria-label={`Select ${c.title}`}
                      />
                    </td>
                    <td className="p-2 align-top font-mono text-xs text-zinc-300">
                      {c.state ?? "—"}
                    </td>
                    <td className="p-2 align-top">
                      <a
                        href={`/admin/campaigns/${c.id}/edit`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-zinc-100 hover:text-emerald-400 hover:underline"
                      >
                        {c.title}
                      </a>
                      {c.blurb && (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">
                          {c.blurb}
                        </p>
                      )}
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{c.slug}</p>
                    </td>
                    <td className="p-2 align-top text-[11px]">
                      {bill ? (
                        <>
                          <a
                            href={`/bills/${c.bill_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-400 hover:underline"
                          >
                            🏛 {bill.bill_number}
                          </a>
                          <div className="text-zinc-500">
                            {bill.status ?? "—"} ·{" "}
                            <span className={
                              bill.kratom_relevance === "anti" ? "text-red-300" :
                              bill.kratom_relevance === "pro" ? "text-emerald-300" :
                              "text-zinc-500"
                            }>
                              {bill.kratom_relevance ?? "neutral"}
                            </span>
                            {bill.relevance_confidence !== null && (
                              <span className="text-zinc-600"> · {Math.round(bill.relevance_confidence * 100)}%</span>
                            )}
                          </div>
                          {bill.official_url && (
                            <a
                              href={bill.official_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-500 hover:text-emerald-400"
                            >
                              official ↗
                            </a>
                          )}
                        </>
                      ) : (
                        <span className="text-zinc-600">no bill link</span>
                      )}
                      {c.auto_generated && (
                        <div className="mt-1 text-[10px] uppercase tracking-wider text-amber-400">
                          🤖 auto
                        </div>
                      )}
                    </td>
                    <td className="p-2 align-top text-[11px]">
                      {c.review_state === "superseded" ? (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-500">superseded</span>
                      ) : (
                        <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-amber-300">pending</span>
                      )}
                      <div className="text-zinc-600">{c.mobilization_type ?? "—"}</div>
                    </td>
                    <td className="p-2 align-top text-right text-[11px] text-zinc-500">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer: shown-count + bulk action bar */}
      <div className="mt-6 flex items-center justify-between text-xs text-zinc-500">
        <p>
          Showing {rows.length} of {totalCount}.{" "}
          {totalCount > rows.length && <span>Refine the filter to see the rest.</span>}
        </p>
      </div>

      {/* Toast — much more visible than a footer line. MFA errors get
          a direct re-verify link so admin doesn't have to hunt. */}
      {msg && (
        <div className={`fixed left-1/2 top-20 z-40 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border p-4 shadow-2xl ${
          msg.startsWith("✗")
            ? "border-red-700/60 bg-red-950/90"
            : "border-emerald-700/60 bg-emerald-950/90"
        }`}>
          <p className={`text-sm font-semibold ${msg.startsWith("✗") ? "text-red-200" : "text-emerald-200"}`}>
            {msg}
          </p>
          {msg.toLowerCase().includes("two-factor") && (
            <div className="mt-3 flex items-center gap-3 text-xs">
              <a
                href="/login/mfa"
                className="rounded bg-emerald-500 px-3 py-1.5 font-semibold text-zinc-950 hover:bg-emerald-400"
              >
                Verify TOTP now →
              </a>
              <button
                type="button"
                onClick={() => setMsg(null)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sticky bulk action bar (only when selection exists) */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-4 left-1/2 z-30 w-[min(900px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-emerald-700/50 bg-zinc-950 p-3 shadow-2xl backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-zinc-100">
              <strong className="text-emerald-400">{selectedIds.length}</strong> selected
            </p>
            <span className="grow" />
            <button
              onClick={() => runBulk("approve")}
              disabled={pending}
              className="rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500 disabled:opacity-50"
            >
              ✓ Approve all
            </button>
            <button
              onClick={() => runBulk("reject")}
              disabled={pending}
              className="rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:border-amber-500 disabled:opacity-50"
            >
              ✗ Reject
            </button>
            <button
              onClick={() => runBulk("supersede")}
              disabled={pending}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
            >
              ⊝ Mark superseded
            </button>
            <button
              onClick={() => runBulk("delete")}
              disabled={pending}
              className="rounded-md border border-red-700/50 bg-red-950/30 px-3 py-1.5 text-xs font-semibold text-red-300 hover:border-red-500 disabled:opacity-50"
            >
              🗑 Delete
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={pending}
              className="rounded-md px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </>
  );
}
