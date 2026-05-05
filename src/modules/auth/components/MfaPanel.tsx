"use client";

import { useState, useTransition } from "react";
import {
  enrollTotp,
  verifyTotp,
  unenrollMfa,
  type MfaSummary,
} from "../actions-mfa";

type EnrollState = {
  factorId: string;
  qrSvg: string;
  secret: string;
} | null;

export function MfaPanel({ summary }: { summary: MfaSummary }) {
  const [enroll, setEnroll] = useState<EnrollState>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startEnroll() {
    setError(null);
    startTransition(async () => {
      const r = await enrollTotp();
      if ("error" in r) setError(r.error);
      else setEnroll({ factorId: r.factorId, qrSvg: r.qrSvg, secret: r.secret });
    });
  }

  function submitCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!enroll) return;
    setError(null);
    startTransition(async () => {
      const r = await verifyTotp({ factorId: enroll.factorId, code });
      if ("error" in r) {
        setError(r.error);
      } else {
        setEnroll(null);
        setCode("");
        // Force a fresh server render so the panel shows the new factor
        window.location.reload();
      }
    });
  }

  function cancelEnroll() {
    setEnroll(null);
    setCode("");
    setError(null);
  }

  function remove(factorId: string) {
    if (!confirm("Remove this authenticator? You'll be back to password-only sign-in.")) return;
    setError(null);
    startTransition(async () => {
      const r = await unenrollMfa(factorId);
      if ("error" in r) setError(r.error);
      else window.location.reload();
    });
  }

  // ── Existing factors ────────────────────────────────────────────────
  const verified = summary.factors.filter((f) => f.status === "verified");

  return (
    <div className="space-y-4">
      {verified.length > 0 && !enroll && (
        <ul className="space-y-2">
          {verified.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium text-zinc-200">
                  {f.friendlyName || "Authenticator"}
                </p>
                <p className="text-xs text-zinc-500">
                  Added {new Date(f.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => remove(f.id)}
                disabled={pending}
                className="rounded border border-red-900/50 px-3 py-1 text-xs text-red-300 hover:border-red-700 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {!enroll && verified.length === 0 && (
        <button
          onClick={startEnroll}
          disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Starting…" : "Set up authenticator"}
        </button>
      )}

      {!enroll && verified.length > 0 && (
        <button
          onClick={startEnroll}
          disabled={pending}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500 disabled:opacity-50"
        >
          Add another authenticator
        </button>
      )}

      {/* ── Enrollment flow ──────────────────────────────────────────── */}
      {enroll && (
        <div className="space-y-4 rounded-md border border-emerald-700/40 bg-emerald-950/10 p-5">
          <div>
            <h3 className="text-sm font-semibold text-emerald-300">
              Step 1 — Scan the QR code
            </h3>
            <p className="mt-1 text-xs text-zinc-400">
              Open your authenticator app and add a new account by scanning the QR.
            </p>
            <div
              className="mt-3 inline-block rounded bg-white p-3"
              // qr_code from Supabase is an SVG string
              dangerouslySetInnerHTML={{ __html: enroll.qrSvg }}
            />
          </div>

          <details className="rounded border border-zinc-800 p-3 text-xs text-zinc-400">
            <summary className="cursor-pointer font-medium text-zinc-300">
              Can&apos;t scan? Enter the secret manually
            </summary>
            <p className="mt-2">
              Add a new account by typing this secret into your authenticator app:
            </p>
            <code className="mt-2 block break-all rounded bg-zinc-950 p-2 font-mono text-zinc-200">
              {enroll.secret}
            </code>
            <p className="mt-2">
              <strong className="text-amber-300">Save this secret somewhere safe</strong>
              {" "}(password manager) — it&apos;s the only way to re-enroll if you lose
              your phone before recovery codes are added.
            </p>
          </details>

          <form onSubmit={submitCode} className="space-y-3">
            <div>
              <label className="text-sm font-semibold text-emerald-300">
                Step 2 — Enter the 6-digit code
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="mt-2 block w-40 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-center font-mono text-lg tracking-widest focus:border-emerald-500 focus:outline-none"
                autoFocus
              />
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending || code.length !== 6}
                className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {pending ? "Verifying…" : "Verify + enable"}
              </button>
              <button
                type="button"
                onClick={cancelEnroll}
                disabled={pending}
                className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
