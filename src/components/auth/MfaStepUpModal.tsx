"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { verifyMfaInline } from "@/modules/auth/actions-mfa";
import { verifyBackupCode } from "@/modules/auth/actions-backup-codes";

/**
 * MfaStepUpModal — in-page TOTP / backup-code challenge.
 *
 * Owner directive 2026-05-16: "anytime we receive this message to re auth
 * for 2step, that you bring up a popup auth window that doesnt redirect
 * to another page so it can be completed right then and there. this should
 * be the case SITE WIDE for anything like this with 2step auth."
 *
 * Opened by <SignInProvider> via useSignIn().requireMfa(). Same pattern
 * as the sign-in modal: one mount point at root, Promise-based open API,
 * resolves true on success / false on cancel.
 *
 * On success, the server has already set the 1-hour mfa_bypass cookie
 * (via verifyMfaInline → verifyTotp). The caller can immediately retry
 * the original admin action without page reload.
 */

type Props = {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
};

type Mode = "totp" | "backup";

export function MfaStepUpModal({ open, onClose, onVerified }: Props) {
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [noFactor, setNoFactor] = useState(false);
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset state on each open
  useEffect(() => {
    if (open) {
      setMode("totp");
      setCode("");
      setBackup("");
      setError(null);
      setNoFactor(false);
    }
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Autofocus the code input on open / mode flip
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        const sel = mode === "totp" ? 'input[name="totp-code"]' : 'input[name="backup-code"]';
        dialogRef.current?.querySelector<HTMLInputElement>(sel)?.focus();
      });
    }
  }, [open, mode]);

  function onTotpSubmit() {
    setError(null);
    startTransition(async () => {
      const r = await verifyMfaInline(code);
      if ("error" in r) {
        if (r.error === "no-factor") {
          setNoFactor(true);
          return;
        }
        setError(r.error);
        return;
      }
      onVerified();
    });
  }

  function onBackupSubmit() {
    setError(null);
    startTransition(async () => {
      const r = await verifyBackupCode(backup);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      if (r.remaining <= 2) {
        alert(`Backup code accepted. You have ${r.remaining} backup code${r.remaining === 1 ? "" : "s"} left — generate new ones from /account/security soon.`);
      }
      onVerified();
    });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mfa-modal-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-lg border border-emerald-700/40 bg-zinc-950 p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              🔐 Two-factor required
            </p>
            <h2 id="mfa-modal-title" className="mt-1 text-xl font-bold text-zinc-100">
              {noFactor ? "No authenticator on file" : "Enter your 6-digit code"}
            </h2>
            <p className="mt-1 text-[12px] text-zinc-400">
              {noFactor
                ? "This action needs a verified second factor."
                : "Your action is queued — verify here and we'll finish it for you. No page reload."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        {noFactor ? (
          <div className="rounded-md border border-amber-700/40 bg-amber-950/15 p-4 text-sm text-amber-200">
            <p>You haven&apos;t enrolled a TOTP authenticator yet. Set one up first:</p>
            <a
              href="/account/security"
              className="mt-3 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-500"
            >
              Open /account/security →
            </a>
          </div>
        ) : mode === "totp" ? (
          <div className="space-y-3">
            <label htmlFor="totp-code" className="block text-[11px] uppercase tracking-wider text-zinc-400">
              6-digit code from your authenticator app
            </label>
            <input
              id="totp-code"
              name="totp-code"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              disabled={pending}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-center font-mono text-2xl tracking-widest text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
            />
            {error && (
              <div className="rounded-md border border-red-900/50 bg-red-950/40 p-2.5 text-[12px] text-red-300">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={onTotpSubmit}
              disabled={pending || code.length !== 6}
              className="w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-500 disabled:opacity-60"
            >
              {pending ? "Verifying…" : "Verify + continue →"}
            </button>
            <p className="text-center text-[11px]">
              <button
                type="button"
                onClick={() => { setMode("backup"); setError(null); }}
                disabled={pending}
                className="text-emerald-400 hover:underline disabled:opacity-60"
              >
                Lost your authenticator? Use a backup code →
              </button>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <label htmlFor="backup-code" className="block text-[11px] uppercase tracking-wider text-zinc-400">
              Backup code
            </label>
            <p className="text-[10px] text-zinc-500">
              One of the 8 single-use codes you saved when enrolling 2FA.
            </p>
            <input
              id="backup-code"
              name="backup-code"
              type="text"
              autoComplete="off"
              value={backup}
              onChange={(e) => setBackup(e.target.value.toUpperCase().slice(0, 11))}
              placeholder="ABC23-XYZ45"
              disabled={pending}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-center font-mono text-lg tracking-widest text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
            />
            {error && (
              <div className="rounded-md border border-red-900/50 bg-red-950/40 p-2.5 text-[12px] text-red-300">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={onBackupSubmit}
              disabled={pending || backup.length < 10}
              className="w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-500 disabled:opacity-60"
            >
              {pending ? "Verifying…" : "Use backup code →"}
            </button>
            <p className="text-center text-[11px]">
              <button
                type="button"
                onClick={() => { setMode("totp"); setError(null); }}
                disabled={pending}
                className="text-zinc-400 hover:text-emerald-400 disabled:opacity-60"
              >
                ← Back to authenticator code
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
