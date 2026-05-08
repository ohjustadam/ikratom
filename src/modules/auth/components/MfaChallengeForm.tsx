"use client";

import { useState, useTransition } from "react";
import { challengeAndVerify } from "../actions-mfa";
import { verifyBackupCode } from "../actions-backup-codes";
import { trustThisDevice } from "../actions-trusted-devices";

type Mode = "totp" | "backup";

export function MfaChallengeForm({
  factorId,
  redirectTo,
}: {
  factorId: string;
  redirectTo: string;
}) {
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * After a successful MFA verify, optionally call trustThisDevice() so
   * the next sign-in from this browser skips the /login/mfa step. The
   * server action defends-in-depth by re-checking aal2 before issuing
   * the trust cookie.
   */
  async function maybeTrust() {
    if (!rememberDevice) return;
    await trustThisDevice({ days: 30 }).catch(() => {});
  }

  function onTotpSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await challengeAndVerify({ factorId, code });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      await maybeTrust();
      window.location.href = redirectTo;
    });
  }

  function onBackupSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await verifyBackupCode(backup);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      if (r.remaining <= 2) {
        alert(
          `Backup code accepted. You have ${r.remaining} backup code${r.remaining === 1 ? "" : "s"} left — generate new ones from /account/security soon.`
        );
      }
      await maybeTrust();
      window.location.href = redirectTo;
    });
  }

  if (mode === "totp") {
    return (
      <form onSubmit={onTotpSubmit} className="space-y-4">
        <div>
          <label htmlFor="mfa-code" className="block text-sm font-medium text-zinc-300">
            6-digit code
          </label>
          <input
            id="mfa-code"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            className="mt-1 block w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-center font-mono text-2xl tracking-widest focus:border-emerald-500 focus:outline-none"
            autoFocus
            required
          />
        </div>

        {error && (
          <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <label className="flex items-start gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={rememberDevice}
            onChange={(e) => setRememberDevice(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
          <span>
            <span className="font-medium text-zinc-200">Remember this device for 30 days</span>
            <span className="block mt-0.5 text-[11px] text-zinc-500">
              Skip the code on routine sign-ins from this browser. Sensitive actions
              (admin changes, password change, MFA settings) still require the code.
              Manage trusted devices on /account/security.
            </span>
          </span>
        </label>

        <button
          type="submit"
          disabled={pending || code.length !== 6}
          className="w-full rounded-md bg-emerald-500 px-4 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Verifying…" : "Verify + continue"}
        </button>

        <p className="text-center text-xs text-zinc-500">
          <button
            type="button"
            onClick={() => { setMode("backup"); setError(null); }}
            className="hover:text-emerald-400 underline-offset-2 hover:underline"
          >
            Lost your authenticator? Use a backup code →
          </button>
        </p>
      </form>
    );
  }

  // Backup code mode
  return (
    <form onSubmit={onBackupSubmit} className="space-y-4">
      <div>
        <label htmlFor="backup-code" className="block text-sm font-medium text-zinc-300">
          Backup code
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          One of the 8 single-use codes you saved when enrolling 2FA.
        </p>
        <input
          id="backup-code"
          type="text"
          autoComplete="off"
          value={backup}
          onChange={(e) => setBackup(e.target.value.toUpperCase().slice(0, 11))}
          placeholder="ABC23-XYZ45"
          className="mt-2 block w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-center font-mono text-lg tracking-widest focus:border-emerald-500 focus:outline-none"
          autoFocus
          required
        />
      </div>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || backup.length < 10}
        className="w-full rounded-md bg-emerald-500 px-4 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Verifying…" : "Use backup code"}
      </button>

      <p className="text-center text-xs text-zinc-500">
        <button
          type="button"
          onClick={() => { setMode("totp"); setError(null); }}
          className="hover:text-emerald-400 underline-offset-2 hover:underline"
        >
          ← Back to authenticator code
        </button>
      </p>
    </form>
  );
}
