"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "@/components/Link";
import { PressReplyButton } from "./PressReplyButton";
import { getMyBoardTicks, toggleCommented, type MyTicks } from "./board-actions";
import type { BoardStory } from "./board-data";

/**
 * This week's Top 5 on /media (PJ, 2026-11-24): the stories most worth
 * answering, how many members emailed the writer or commented, and the
 * member's own ticks. Goal: no kratom story goes without an answer from us.
 */
export function TopFive({ stories }: { stories: BoardStory[] }) {
  // base = the member's ticks when the page loaded; mine = now. The cached
  // counts already hold base, so only the difference is added on screen.
  const [base, setBase] = useState<MyTicks>({});
  const [mine, setMine] = useState<MyTicks>({});
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getMyBoardTicks(stories.map((s) => s.newsId)).then((t) => { if (live) { setBase(t); setMine(t); } }).catch(() => {});
    return () => { live = false; };
  }, [stories]);

  const set = (id: string, patch: Partial<{ emailed: boolean; commented: boolean }>) =>
    setMine((m) => ({ ...m, [id]: { ...(m[id] ?? { emailed: false, commented: false }), ...patch } }));

  const comment = (id: string, on: boolean) => start(async () => {
    const r = await toggleCommented(id, on);
    if (r.ok) { set(id, { commented: r.commented }); setNote(null); }
    else setNote(r.reason === "signed_out" ? "Sign in to tick your comments." : r.reason === "limit" ? "That's a lot of ticks for one hour. Try again later." : "That didn't save. Try again.");
  });

  return (
    <ol className="mt-3 space-y-3">
      {stories.map((s, i) => {
        const me = mine[s.newsId] ?? { emailed: false, commented: false };
        const was = base[s.newsId] ?? { emailed: false, commented: false };
        const commented = Math.max(0, s.commented + Number(me.commented) - Number(was.commented));
        const emailed = Math.max(0, s.emailed + Number(me.emailed) - Number(was.emailed));
        return (
          <li key={s.newsId} className="rounded-lg border border-zinc-800 p-4">
            <p className="text-xs font-semibold text-emerald-400">#{i + 1}</p>
            <Link href={`/news/${s.newsId}`} className="font-semibold text-zinc-100 hover:text-emerald-300">{s.title}</Link>
            <p className="mt-1 text-xs text-zinc-500">{[s.name, s.outlet, s.publishedAt?.slice(0, 10)].filter(Boolean).join(" · ")}</p>
            <p className="mt-2 text-xs text-zinc-400">
              ✉ {emailed} emailed · 💬 {commented} commented
              {commented === 0 && <span className="ml-2 rounded bg-amber-950/60 px-1.5 py-0.5 text-amber-300">No comment from us yet</span>}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PressReplyButton contactId={s.contactId} source="media_top5" onOpened={() => set(s.newsId, { emailed: true })}
                label={me.emailed ? "✓ Emailed · write again" : "✉ Email the writer"} />
              <button type="button" disabled={pending} onClick={() => comment(s.newsId, !me.commented)}
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${me.commented ? "border-emerald-600 bg-emerald-950/50 text-emerald-200" : "border-zinc-700 text-zinc-300 hover:border-emerald-600"}`}>
                {me.commented ? "✓ I commented" : "💬 I left a comment"}
              </button>
            </div>
          </li>
        );
      })}
      {note && <p className="text-xs text-zinc-400">{note}</p>}
    </ol>
  );
}
