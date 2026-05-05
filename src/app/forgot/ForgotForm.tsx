"use client";

import { useState, useTransition } from "react";
import { requestPasswordReset } from "@/modules/auth/actions";

export function ForgotForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await requestPasswordReset(fd);
      if (result?.error) setError(result.error);
      else setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-5 text-sm">
        <p className="font-semibold text-emerald-300">✓ Check your email</p>
        <p className="mt-2 text-zinc-300">
          If an account exists for that address, we&apos;ve sent a link to reset your
          password. Click it within 1 hour.
        </p>
        <p className="mt-3 text-xs text-zinc-500">
          Didn&apos;t get it? Check spam, or{" "}
          <button onClick={() => setSent(false)} className="text-emerald-400 hover:underline">
            try again
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-zinc-300">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>
      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-emerald-500 px-4 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
