"use client";

import { useEffect } from "react";

import Link from "next/link";
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console for debugging — in prod, hook a real error reporter here later
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="font-mono text-sm uppercase tracking-widest text-red-400">
        Something broke
      </p>
      <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
        That wasn&apos;t supposed to happen.
      </h1>
      <p className="mt-4 max-w-md text-zinc-400">
        We hit an unexpected error. Try reloading the page — if it keeps breaking, the team
        wants to hear about it.
      </p>
      {error?.digest && (
        <p className="mt-3 font-mono text-xs text-zinc-600">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-zinc-700 px-5 py-2 font-semibold hover:border-emerald-500"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
