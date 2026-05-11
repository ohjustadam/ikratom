"use client";

import { useState, useTransition } from "react";
import { changePassword } from "../actions-password";

/**
 * Force-change variant of the password form. Used by /account/security/
 * force-change after an admin issues a temp password. Visually distinct
 * (always-open form, no cancel button) but shares the same server
 * action — successful change clears profiles.password_must_change_at,
 * the proxy stops bouncing, and we hard-navigate to /dashboard so the
 * user lands on the normal post-login experience.
 */
export function ForceChangePasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    startTransition(async () => {
      const r = await changePassword(fd);
      if ("error" in r) {
        setError(r.error);
      } else {
        // Hard nav so the proxy re-evaluates and routes us to /dashboard.
        window.location.assign("/dashboard");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-5"
    >
      <Field
        name="current"
        type="password"
        label="Temporary password"
        autoComplete="current-password"
        required
        hint="The temp password the admin gave you."
      />
      <Field
        name="next"
        type="password"
        label="New password"
        autoComplete="new-password"
        required
        hint="Minimum 10 characters. Use something only you know."
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

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-emerald-500 px-4 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Updating…" : "Set my new password"}
      </button>

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
