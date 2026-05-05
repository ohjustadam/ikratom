"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { signIn, signUp } from "../actions";

type Mode = "signin" | "signup";

export function AuthForm({ redirectTo }: { redirectTo?: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Anti-bot: capture how long the form was visible before submit.
  // Bots typically POST instantly; humans take >2s.
  const mountedAt = useRef<number>(0);
  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const formData = new FormData(e.currentTarget);
    formData.set("form_elapsed_ms", String(Date.now() - mountedAt.current));
    startTransition(async () => {
      const result =
        mode === "signin" ? await signIn(formData) : await signUp(formData);
      if (result?.error) setError(result.error);
      else if (mode === "signup")
        setSuccess(
          "Account created. Check your email for a confirmation link, then sign in."
        );
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex rounded-md border border-zinc-800 bg-zinc-950/40 p-1">
        <Tab active={mode === "signin"} onClick={() => setMode("signin")}>
          Sign in
        </Tab>
        <Tab active={mode === "signup"} onClick={() => setMode("signup")}>
          Create account
        </Tab>
      </div>

      <Field label="Email" name="email" type="email" required />
      <Field
        label="Password"
        name="password"
        type="password"
        required
        hint={mode === "signup" ? "Minimum 10 characters." : undefined}
      />

      {/* Honeypot: hidden from humans, attractive to dumb form bots.
          If anything ends up in this field, the server treats the submission
          as spam and silently drops it. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", height: 0, width: 0, overflow: "hidden" }}>
        <label htmlFor="website_url">Website (leave blank)</label>
        <input
          id="website_url"
          name="website_url"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      {redirectTo && <input type="hidden" name="redirect" value={redirectTo} />}

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {success}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-emerald-500 px-4 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending
          ? "..."
          : mode === "signin"
          ? "Sign in"
          : "Create account"}
      </button>

      {mode === "signin" && (
        <p className="text-center text-xs text-zinc-500">
          <a href="/forgot" className="hover:text-emerald-400">Forgot password?</a>
        </p>
      )}
    </form>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${
        active ? "bg-emerald-500 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  name,
  type,
  required,
  hint,
}: {
  label: string;
  name: string;
  type: string;
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
        required={required}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
      />
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
