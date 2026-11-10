"use client";

import { useSearchParams } from "next/navigation";
import { parseAuthNotice } from "../signup-outcome";
import { ResendLinkForm } from "./ResendLinkForm";

/**
 * Explains why an emailed link brought someone to /login
 * (src/app/auth/callback and /auth/confirm send them here with ?notice=).
 * Read in the browser so /login stays a static page.
 */
export function AuthNotice() {
  const notice = parseAuthNotice(useSearchParams().get("notice"));
  if (!notice) return null;

  if (notice === "confirmed") {
    return (
      <div className="mb-4 rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm">
        <p className="font-semibold text-emerald-300">Your email is confirmed.</p>
        <p className="mt-1 text-xs text-emerald-200/80">
          Sign in below to finish. The link opened in a different browser or app
          than the one you signed up in, so it couldn&apos;t sign you in by itself.
          Forgot the password? <a href="/forgot" className="underline">Reset it</a>.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-md border border-amber-900/40 bg-amber-950/40 px-3 py-2 text-sm">
      <p className="font-semibold text-amber-200">That link didn&apos;t work.</p>
      <p className="mt-1 text-xs text-amber-100/80">
        It may have expired, been used already, or been replaced by a newer
        email. Already confirmed? Sign in below. Otherwise, get a new link:
      </p>
      <ResendLinkForm />
    </div>
  );
}
