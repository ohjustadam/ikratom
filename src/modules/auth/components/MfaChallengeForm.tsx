"use client";

import { useState, useTransition } from "react";
import { challengeAndVerify } from "../actions-mfa";

export function MfaChallengeForm({
  factorId,
  redirectTo,
}: {
  factorId: string;
  redirectTo: string;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await challengeAndVerify({ factorId, code });
      if ("error" in r) setError(r.error);
      else window.location.href = redirectTo;
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
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

      <button
        type="submit"
        disabled={pending || code.length !== 6}
        className="w-full rounded-md bg-emerald-500 px-4 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Verifying…" : "Verify + continue"}
      </button>
    </form>
  );
}
