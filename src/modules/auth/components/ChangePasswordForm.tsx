"use client";

import { useState, useTransition } from "react";
import { changePassword } from "../actions-password";

export function ChangePasswordForm() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await changePassword(fd);
      if ("error" in r) {
        setError(r.error);
      } else {
        setSuccess(true);
        e.currentTarget.reset();
        // Close after a moment so the success message is visible
        setTimeout(() => setOpen(false), 2000);
      }
    });
  }

  if (!open) {
    return (
      <div>
        {success && (
          <p className="mb-3 rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
            Password updated. You&apos;ll stay signed in on this device.
          </p>
        )}
        <button
          onClick={() => {
            setOpen(true);
            setSuccess(false);
          }}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium hover:border-emerald-500 hover:text-emerald-400"
        >
          Change password
        </button>
        <p className="mt-3 text-xs text-zinc-500">
          You&apos;ll be asked for your current password to confirm.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
      <Field
        name="current"
        type="password"
        label="Current password"
        autoComplete="current-password"
        required
      />
      <Field
        name="next"
        type="password"
        label="New password"
        autoComplete="new-password"
        required
        hint="Minimum 10 characters."
      />
      <Field
        name="confirm"
        type="password"
        label="Confirm new password"
        autoComplete="new-password"
        required
      />

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Password updated.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Updating…" : "Update password"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      <p className="text-xs text-zinc-500">
        Tip: paste a strong password from your password manager. Mix of letters,
        numbers, and symbols. Don&apos;t reuse a password you use elsewhere.
      </p>
    </form>
  );
}

function Field({
  name,
  type,
  label,
  autoComplete,
  required,
  hint,
}: {
  name: string;
  type: string;
  label: string;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-zinc-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
      />
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
