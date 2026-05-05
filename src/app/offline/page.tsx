"use client";

export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="font-mono text-sm uppercase tracking-widest text-amber-400">
        You&apos;re offline
      </p>
      <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
        The connection dropped, but the war room remembers.
      </h1>
      <p className="mt-4 max-w-md text-zinc-400">
        Pages you&apos;ve already visited are cached and still readable. Anything you need
        live (campaigns, sending emails, messages) waits for the connection to come back.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          onClick={() => location.reload()}
          className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-md border border-zinc-700 px-5 py-2 font-semibold hover:border-emerald-500"
        >
          Home
        </a>
      </div>
    </div>
  );
}
