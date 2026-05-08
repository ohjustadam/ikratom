"use client";

import { useState, useTransition } from "react";
import { verifyMfaInline } from "@/modules/auth/actions-mfa";

/**
 * Inline 2FA verification modal. Used wherever an admin mutation
 * triggers the requireMfaForMutation gate — instead of navigating to
 * /login/mfa and back, the user gets a modal on the same page,
 * enters their TOTP code, and the original action retries.
 *
 * Wire it like this:
 *
 *   const [showMfa, setShowMfa] = useState(false);
 *   ...
 *   if (r.error?.includes("Two-factor")) setShowMfa(true);
 *   ...
 *   {showMfa && (
 *     <MfaInlineModal
 *       onClose={() => setShowMfa(false)}
 *       onSuccess={() => { setShowMfa(false); approve(); }}
 *     />
 *   )}
 *
 * The modal handles its own state (code input, error display, pending
 * spinner). After verifyMfaInline() succeeds, the bypass cookie is
 * set server-side and onSuccess() fires — caller retries the action.
 */
export function MfaInlineModal({
  title = "Verify two-factor",
  subtitle = "Enter the 6-digit code from your authenticator app to continue.",
  onClose,
  onSuccess,
}: {
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const trimmed = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(trimmed)) {
      setError("Code must be 6 digits.");
      return;
    }
    startTransition(async () => {
      const r = await verifyMfaInline(trimmed);
      if ("error" in r) {
        if (r.error === "no-factor") {
          setError("No 2FA factor enrolled. Visit /account/security to set one up.");
        } else {
          setError(r.error ?? "Failed");
        }
        return;
      }
      onSuccess();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          🔐 Two-factor sign-in
        </p>
        <h2 className="mt-2 text-lg font-bold text-zinc-100">{title}</h2>
        <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            autoFocus
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={pending}
            maxLength={7}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-3 text-center font-mono text-2xl tracking-[0.5em] text-zinc-100 outline-none focus:border-emerald-500"
          />
          {error && (
            <p className="rounded-md border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending || code.replace(/\s+/g, "").length !== 6}
              className="flex-1 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {pending ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>

        <p className="mt-4 text-[11px] text-zinc-500">
          Lost your authenticator? <a href="/account/security" className="text-emerald-400 hover:underline">Use a backup code</a>.
        </p>
      </div>
    </div>
  );
}
