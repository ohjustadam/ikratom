"use client";

import Link from "next/link";
import { SignUpNudge } from "@/components/SignUpNudge";
import { EnablePushNudge } from "@/components/EnablePushNudge";
import { DeadlineBucket } from "./DeadlineBucket";
import { useVisibleDeadlines } from "./useVisibleDeadlines";
import type { DeadlineItem } from "./types";

export function DeadlinesView({
  items,
  baselineNow,
}: {
  items: DeadlineItem[];
  baselineNow: number;
}) {
  const { stateFilter, now, visible, urgent, soon, later } = useVisibleDeadlines(items, baselineNow);
  const stateOptions = [...new Set(visible.map((i) => i.state).filter(Boolean) as string[])].sort();

  return (
    <>
      {/* State filter pills */}
      {stateOptions.length > 0 && (
        <nav className="mb-6 flex flex-wrap gap-2 text-xs">
          <Link
            href="/deadlines"
            className={`rounded px-3 py-1.5 ${!stateFilter ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
          >
            All ({visible.length})
          </Link>
          {stateOptions.map((s) => (
            <Link
              key={s}
              href={`/deadlines?state=${s}`}
              className={`rounded px-3 py-1.5 ${stateFilter === s ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
            >
              {s}
            </Link>
          ))}
        </nav>
      )}

      <SignUpNudge context="default" className="mb-6" />
      <EnablePushNudge context="default" className="mb-6" />

      {visible.length === 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-10 text-center">
          <p className="text-3xl">⏰</p>
          <p className="mt-2 text-sm text-zinc-400">
            No public-comment windows currently open
            {stateFilter ? ` in ${stateFilter}` : ""}.
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            That&apos;s a good thing — quiet means no active threats. New windows
            surface here automatically.
          </p>
        </div>
      )}

      {urgent.length > 0 && (
        <DeadlineBucket
          title="🔴 Closing in less than 7 days — act now"
          items={urgent}
          tone="red"
          now={now}
        />
      )}
      {soon.length > 0 && (
        <DeadlineBucket
          title="🟡 7–30 days out — calendar it"
          items={soon}
          tone="amber"
          now={now}
        />
      )}
      {later.length > 0 && (
        <DeadlineBucket
          title="🟢 Over 30 days out — monitor"
          items={later}
          tone="emerald"
          now={now}
        />
      )}
    </>
  );
}
