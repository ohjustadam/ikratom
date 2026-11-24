"use client";

import { useEffect, useState } from "react";
import Link from "@/components/Link";
import { findStoryByLink, type LinkMatch } from "@/modules/news/find-by-link";

/**
 * Under the tip form's link field: if iKratom already has the story someone
 * shared or pasted, say so and offer its campaign, so they can act in one tap
 * instead of filing a tip we already handled (PJ, 2026-11-24).
 */
export function LinkMatches({ url }: { url: string }) {
  const [match, setMatch] = useState<{ url: string; result: LinkMatch } | null>(null);

  useEffect(() => {
    const u = url.trim();
    if (!/^https?:\/\/\S+\.\S+/i.test(u)) return;
    let live = true;
    const t = setTimeout(() => {
      findStoryByLink(u).then((result) => { if (live) setMatch({ url: u, result }); }).catch(() => {});
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [url]);

  // A stale answer for a link that has since been edited away is never shown.
  const m = match && match.url === url.trim() ? match.result : null;
  if (!m?.story) return null;

  return (
    <div className="mt-3 rounded-md border border-emerald-800/60 bg-emerald-950/30 p-3 text-sm">
      <p className="font-semibold text-emerald-300">We already have this story</p>
      <p className="mt-1 text-zinc-300">
        <Link href={`/news/${m.story.id}`} className="underline hover:text-emerald-300">{m.story.title}</Link>
        {m.story.source && <span className="text-zinc-500"> · {m.story.source}</span>}
      </p>
      {m.campaigns.length > 0 ? (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-zinc-400">Act on it now:</p>
          {m.campaigns.map((c) => (
            <Link key={c.slug} href={`/campaigns/${c.slug}`}
              className="block rounded border border-emerald-700 px-3 py-2 text-emerald-200 hover:border-emerald-500">
              ✉️ {c.title}
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-400">
          There&apos;s no campaign for it yet. Send the tip below and say what should happen, and a moderator can start one.
        </p>
      )}
    </div>
  );
}
