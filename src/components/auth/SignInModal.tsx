"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { signInInline, signUpInline } from "@/modules/auth/actions";
import { ErrorWithReport } from "@/components/ErrorWithReport";

/**
 * SignInModal — inline auth popup that DOESN'T redirect the user away.
 *
 * Opened by <SignInProvider> via useSignIn().requireSignIn(). Closes
 * on:
 *   - successful sign-in / sign-up confirmation (calls onSignedIn)
 *   - user click on backdrop or X button (calls onClose)
 *   - Escape key (calls onClose)
 *
 * Modes:
 *   - signin (default): email + password
 *   - signup: email + password + username (matches existing /signup flow)
 *
 * MFA: if the server returns mfaRequiredUrl, we show a "Continue MFA"
 * link rather than try to challenge inside the modal. Most users won't
 * have MFA on; those who do can be redirected for the second factor.
 *
 * OAuth providers (Gmail / Discord): we keep them OUT of this modal
 * because OAuth flows require a full-page redirect by spec. Users who
 * prefer OAuth can use the /login page link in the footer of the modal.
 */

type Props = {
  open: boolean;
  onClose: () => void;
  onSignedIn: () => void;
};

type Mode = "signin" | "signup";

export function SignInModal({ open, onClose, onSignedIn }: Props) {
  const [mode, setMode] = useState<Mode>("signin");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message: string; hint?: string; code?: string | null } | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [mfaUrl, setMfaUrl] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(0);

  // Reset modal state every time it opens. Keeps a previous error
  // from leaking into a fresh attempt.
  useEffect(() => {
    if (open) {
      setError(null);
      setConfirmation(null);
      setMfaUrl(null);
      startTimeRef.current = Date.now();
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

  // Focus the email input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        dialogRef.current?.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
      });
    }
  }, [open, mode]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    // Embed anti-bot timing trap for signup (signIn doesn't enforce)
    fd.set("form_elapsed_ms", String(Date.now() - startTimeRef.current));
    startTransition(async () => {
      try {
        if (mode === "signin") {
          const r = await signInInline(fd);
          if (r.error) {
            setError({ message: r.error, hint: r.hint, code: r.errorCode ?? null });
            return;
          }
          if (r.mfaRequiredUrl) {
            setMfaUrl(r.mfaRequiredUrl);
            return;
          }
          onSignedIn();
        } else {
          const r = await signUpInline(fd);
          if (r.error) {
            setError({ message: r.error, hint: r.hint, code: r.errorCode ?? null });
            return;
          }
          if (r.needsConfirmation) {
            setConfirmation("Account created. Check your inbox for the confirmation email — once you click the link, come back here and sign in.");
            setMode("signin");
            return;
          }
          // Rare: signup completed without confirmation required
          onSignedIn();
        }
      } catch (err) {
        setError({ message: (err as Error).message || "Something went wrong." });
      }
    });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-modal-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-950 p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              🌿 iKratom
            </p>
            <h2 id="signin-modal-title" className="mt-1 text-xl font-bold text-zinc-100">
              {mode === "signin" ? "Sign in to continue" : "Create an account"}
            </h2>
            <p className="mt-1 text-[12px] text-zinc-400">
              {mode === "signin"
                ? "Your submission is queued — sign in here and we'll finish it for you."
                : "Free. No tracking. You can sign in immediately after confirming your email."}
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

        {confirmation && (
          <div className="mb-4 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-3 text-sm text-emerald-200">
            {confirmation}
          </div>
        )}

        {mfaUrl ? (
          <div className="rounded-md border border-amber-700/40 bg-amber-950/15 p-4 text-sm text-amber-200">
            <p>Your account has two-factor enabled. Finish the second factor to continue:</p>
            <a
              href={mfaUrl}
              className="mt-3 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-500"
            >
              Continue with MFA →
            </a>
            <p className="mt-3 text-[11px] text-amber-300/80">
              Your submission stays here — come back to this tab after MFA.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="email"
              name="email"
              required
              placeholder="you@example.com"
              maxLength={254}
              disabled={pending}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
            />
            <input
              type="password"
              name="password"
              required
              placeholder="Password"
              minLength={mode === "signup" ? 10 : 1}
              maxLength={200}
              disabled={pending}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
            />
            {mode === "signup" && (
              <>
                <input
                  type="text"
                  name="username"
                  required
                  placeholder="Username (3–30 chars, a-z, 0-9, _)"
                  pattern="[a-z0-9_]{3,30}"
                  disabled={pending}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                />
                {/* Honeypot — visually hidden but in the DOM. Bots fill all inputs. */}
                <input
                  type="text"
                  name="website_url"
                  tabIndex={-1}
                  autoComplete="off"
                  className="absolute left-[-9999px]"
                  aria-hidden="true"
                />
              </>
            )}

            {error && (
              <ErrorWithReport
                message={error.message}
                hint={error.hint ?? null}
                kind={mode === "signup" ? "signup" : "login"}
                errorCode={error.code ?? null}
                extraContext={{ source: "SignInModal", mode }}
              />
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-500 disabled:opacity-60"
            >
              {pending ? "Working…" : mode === "signin" ? "Sign in →" : "Create account →"}
            </button>

            <div className="flex items-center justify-between text-[11px]">
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setError(null);
                  setConfirmation(null);
                }}
                disabled={pending}
                className="text-emerald-400 hover:underline disabled:opacity-60"
              >
                {mode === "signin" ? "Need an account? Sign up →" : "Have an account? Sign in →"}
              </button>
              {mode === "signin" && (
                <a href="/forgot" className="text-zinc-500 hover:text-emerald-400">
                  Forgot password?
                </a>
              )}
            </div>
          </form>
        )}

        <p className="mt-4 border-t border-zinc-800 pt-3 text-center text-[10px] text-zinc-500">
          Prefer Gmail or Discord sign-in?{" "}
          <a href="/login" className="text-emerald-400 hover:underline">
            Open the full sign-in page →
          </a>
        </p>
      </div>
    </div>
  );
}
