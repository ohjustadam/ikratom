"use client";

import { useState, useTransition } from "react";
import { generateBackupCodes, type BackupCodesSummary } from "../actions-backup-codes";

export function BackupCodes({ initial }: { initial: BackupCodesSummary }) {
  const [summary, setSummary] = useState(initial);
  const [shown, setShown] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function regenerate() {
    if (summary.total > 0) {
      const ok = confirm(
        "This invalidates your existing backup codes and creates 8 new ones. Continue?"
      );
      if (!ok) return;
    }
    setError(null);
    startTransition(async () => {
      const r = await generateBackupCodes();
      if ("error" in r) {
        setError(r.error);
      } else {
        setShown(r.codes);
        setSummary({ total: r.codes.length, used: 0, remaining: r.codes.length });
      }
    });
  }

  function copyAll() {
    if (!shown) return;
    const text = shown.join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function dismiss() {
    if (
      !confirm(
        "Have you saved these codes? You won't be able to view them again — only generate new ones."
      )
    ) {
      return;
    }
    setShown(null);
  }

  // ── Display the codes once after generation ────────────────────────
  if (shown) {
    return (
      <div className="space-y-4 rounded-md border border-amber-700/40 bg-amber-950/20 p-5">
        <div>
          <h3 className="text-sm font-semibold text-amber-300">
            Save these codes now
          </h3>
          <p className="mt-1 text-xs text-amber-200/80">
            Each code works once. Store them in your password manager — you
            won&apos;t see them again. If you lose your phone AND your codes,
            recovery requires the platform owner to manually clear your 2FA.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-md bg-zinc-950 p-4 font-mono text-sm">
          {shown.map((c, i) => (
            <div key={i} className="rounded bg-zinc-900 px-3 py-2 text-center text-zinc-100">
              {c}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={copyAll}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
          >
            Copy all to clipboard
          </button>
          <button
            onClick={dismiss}
            className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            I&apos;ve saved them — done
          </button>
        </div>
      </div>
    );
  }

  // ── Default state: show summary + regenerate button ────────────────
  return (
    <div className="space-y-3">
      {summary.total === 0 ? (
        <p className="text-sm text-zinc-400">
          You don&apos;t have any backup codes yet. Generate 8 single-use codes
          to keep yourself logged in if you lose access to your authenticator.
        </p>
      ) : (
        <p className="text-sm text-zinc-400">
          {summary.remaining} of {summary.total} codes remaining
          {summary.used > 0 && <> · {summary.used} used</>}.
          {summary.remaining <= 2 && (
            <span className="ml-2 text-amber-300">Running low — regenerate soon.</span>
          )}
        </p>
      )}

      <button
        onClick={regenerate}
        disabled={pending}
        className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium hover:border-emerald-500 hover:text-emerald-400 disabled:opacity-50"
      >
        {pending
          ? "Generating…"
          : summary.total === 0
          ? "Generate backup codes"
          : "Regenerate backup codes"}
      </button>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
