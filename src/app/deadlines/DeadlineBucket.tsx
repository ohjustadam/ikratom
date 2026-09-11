"use client";

import Link from "next/link";
import type { DatedDeadlineItem } from "./types";

export function DeadlineBucket({
  title,
  items,
  tone,
  now,
}: {
  title: string;
  items: DatedDeadlineItem[];
  tone: "red" | "amber" | "emerald";
  now: number;
}) {
  const headTone =
    tone === "red" ? "text-red-300"
      : tone === "amber" ? "text-amber-300"
      : "text-emerald-300";
  return (
    <section className="mb-8">
      <h2 className={`mb-3 text-sm font-semibold uppercase tracking-wider ${headTone}`}>{title}</h2>
      <ul className="space-y-2">
        {items.map((i) => {
          const daysLeft = Math.ceil((i.ms - now) / 86_400_000);
          const hoursLeft = Math.ceil((i.ms - now) / 3_600_000);
          const dotCls =
            tone === "red" ? "bg-red-500 animate-pulse"
              : tone === "amber" ? "bg-amber-400"
              : "bg-emerald-400";
          return (
            <li
              key={i.id}
              className={`rounded-md border p-4 ${
                tone === "red" ? "border-red-700/50 bg-red-950/15"
                  : tone === "amber" ? "border-amber-700/40 bg-amber-950/10"
                  : "border-zinc-800 bg-zinc-950/40"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${dotCls}`} />
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                  {i.locality ?? "FED"}
                </span>
                <span className={`text-[11px] font-bold ${headTone}`}>
                  {daysLeft <= 1 ? `${hoursLeft}h left` : `${daysLeft}d left`}
                </span>
                <span className="ml-auto text-[10px] text-zinc-500">
                  deadline {i.deadlineLabel}
                </span>
              </div>
              <h3 className="mt-2 text-sm font-semibold leading-snug text-zinc-100">
                <Link href={i.link} className="hover:text-emerald-400 hover:underline">
                  {i.title}
                </Link>
              </h3>
              {i.excerpt && (
                <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{i.excerpt}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Link
                  href={i.link}
                  className={`rounded px-2.5 py-1 font-semibold ${
                    tone === "red" ? "bg-red-600 text-white hover:bg-red-500"
                      : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                  }`}
                >
                  ✍ Draft response →
                </Link>
                {i.state && (
                  <Link
                    href={`/states/${i.state}`}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:border-emerald-500"
                  >
                    📍 {i.state} hub
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
