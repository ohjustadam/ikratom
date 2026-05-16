"use client";

import { useState, useTransition } from "react";
import { reportUserError, type ReportUserErrorInput } from "@/modules/errors/actions";

/**
 * <ErrorWithReport> — universal error banner with a "Report to admin"
 * button. Drop in anywhere a user-visible error message appears.
 *
 * Owner directive 2026-05-16: "the report error button to admin should
 * appear anytime a user gets an error."
 *
 * Pattern:
 *
 *   {error && (
 *     <ErrorWithReport
 *       message={error.message}
 *       hint={error.hint}
 *       kind="submission"
 *       errorCode={error.code}
 *     />
 *   )}
 *
 * Behavior:
 *   - Renders the error in a red-bordered box
 *   - Shows a "📮 Report to admin" link next to the message
 *   - On click, captures page URL + error context, asks the user for
 *     a short description, sends via reportUserError() server action
 *   - After report: shows the classifier's hint ("auto-resolved" /
 *     "escalated to admin" / "transient — try again")
 *   - Rate-limited server-side (10 reports/hour/IP) so spam is bounded
 */

type Props = {
  /** The error message shown to the user. */
  message: string;
  /** Optional hint / suggestion (e.g. "Try a different password"). */
  hint?: string | null;
  /** Where the error happened — must match a UserErrorKind value. */
  kind: ReportUserErrorInput["kind"];
  /** Structured slug if available (matches auth_events conventions). */
  errorCode?: string | null;
  /** Extra context to attach to the report (page state, etc). */
  extraContext?: Record<string, unknown>;
  /** Hide the report button entirely (e.g. for non-actionable info messages). */
  hideReport?: boolean;
};

export function ErrorWithReport({ message, hint, kind, errorCode, extraContext, hideReport }: Props) {
  const [pending, startTransition] = useTransition();
  const [reportState, setReportState] = useState<
    | { state: "idle" }
    | { state: "asking" }
    | { state: "sent"; escalated: boolean; hint: string | null }
    | { state: "error"; reason: string }
  >({ state: "idle" });
  const [description, setDescription] = useState("");

  function onReportClick() {
    setReportState({ state: "asking" });
  }

  function onCancel() {
    setReportState({ state: "idle" });
    setDescription("");
  }

  function onSend() {
    startTransition(async () => {
      const ctx = {
        page_url: typeof window !== "undefined" ? window.location.href : null,
        page_pathname: typeof window !== "undefined" ? window.location.pathname : null,
        timestamp: new Date().toISOString(),
        ...(extraContext ?? {}),
      };
      const r = await reportUserError({
        kind,
        errorCode: errorCode ?? null,
        errorMessage: message,
        userDescription: description || null,
        context: ctx,
      });
      if (r.ok) {
        setReportState({ state: "sent", escalated: r.escalated, hint: r.autoResolvedHint });
      } else {
        setReportState({ state: "error", reason: r.error });
      }
    });
  }

  return (
    <div className="rounded-md border border-red-900/50 bg-red-950/30 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1">
          <p className="font-semibold text-red-200">{message}</p>
          {hint && <p className="mt-1 text-[12px] text-red-300/80">{hint}</p>}
        </div>
        {!hideReport && reportState.state === "idle" && (
          <button
            type="button"
            onClick={onReportClick}
            className="shrink-0 rounded border border-red-800 bg-red-950/60 px-2.5 py-1 text-[11px] text-red-200 hover:border-red-600 hover:text-white"
          >
            📮 Report to admin
          </button>
        )}
      </div>

      {reportState.state === "asking" && (
        // Plain div (NOT <form>) — this component is often rendered
        // inside an outer form (e.g. SignInModal), and nested forms
        // cause the inner button click to trigger the outer form's
        // submit which can navigate the page.
        <div className="mt-3 border-t border-red-900/40 pt-3">
          <label className="block text-[11px] uppercase tracking-wider text-red-300/80">
            What were you trying to do? (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending}
            maxLength={2000}
            rows={2}
            placeholder="e.g. signing in with my Gmail address — the page just shows this error"
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-200 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onSend}
              disabled={pending}
              className="rounded bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-emerald-500 disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send report"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-[11px] text-zinc-300 hover:border-emerald-500 disabled:opacity-60"
            >
              Cancel
            </button>
            <span className="text-[10px] text-zinc-500">
              We capture the page URL + error code automatically. No personal data beyond that.
            </span>
          </div>
        </div>
      )}

      {reportState.state === "sent" && (
        <div className="mt-3 border-t border-red-900/40 pt-3 text-[12px]">
          {reportState.escalated ? (
            <p className="text-amber-200">
              <span className="font-semibold">📨 Escalated to admin.</span> They&apos;ll see this in the next admin review pass.
            </p>
          ) : (
            <p className="text-emerald-300">
              <span className="font-semibold">✓ Recorded.</span> {reportState.hint}
            </p>
          )}
        </div>
      )}

      {reportState.state === "error" && (
        <p className="mt-3 border-t border-red-900/40 pt-3 text-[12px] text-red-300">
          Couldn&apos;t file the report: {reportState.reason}
        </p>
      )}
    </div>
  );
}
