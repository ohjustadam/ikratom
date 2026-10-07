"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import { isStaleDeployError, reloadOnceForNewVersion } from "@/lib/stale-deploy";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    // A page opened before a deploy: reload onto the new version instead of
    // showing a failure (see src/lib/stale-deploy.ts).
    if (isStaleDeployError(error) && reloadOnceForNewVersion()) {
      setReloading(true);
      return;
    }
    console.error("[error boundary]", error);
  }, [error]);

  if (reloading) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
        <p className="text-lg font-semibold text-emerald-300">iKratom was just updated</p>
        <p className="mt-2 text-zinc-400">Loading the new version…</p>
      </div>
    );
  }

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
