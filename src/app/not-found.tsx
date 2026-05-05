import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="font-mono text-sm uppercase tracking-widest text-emerald-400">
        404
      </p>
      <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
        Lost in the war room.
      </h1>
      <p className="mt-4 max-w-md text-zinc-400">
        That page doesn&apos;t exist — maybe a stale link, maybe a typo, maybe a campaign that
        ended. The real action is in your state.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Home
        </Link>
        <Link
          href="/campaigns"
          className="rounded-md border border-zinc-700 px-5 py-2 font-semibold hover:border-emerald-500"
        >
          Active campaigns
        </Link>
        <Link
          href="/forum"
          className="rounded-md border border-zinc-700 px-5 py-2 font-semibold hover:border-emerald-500"
        >
          State forums
        </Link>
      </div>
    </div>
  );
}
