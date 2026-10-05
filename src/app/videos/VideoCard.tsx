"use client";

import { useState } from "react";

/**
 * Click-to-play YouTube card. Shows YouTube's own thumbnail until clicked, so a
 * page of 48 videos loads 48 small images, not 48 players. The player is
 * youtube-nocookie (no tracking cookies until play). Watch / Like / Subscribe
 * all open the creator's REAL YouTube pages, so they keep their numbers.
 */
export function VideoCard({
  id, title, channelName, subscribeHref, dateLabel, badge,
}: {
  id: string;
  title: string;
  channelName: string;
  subscribeHref: string;
  dateLabel: string;
  badge?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const link = "rounded border border-zinc-700 px-2 py-1 text-[11px] font-semibold text-zinc-300 hover:border-emerald-500 hover:text-emerald-300";

  return (
    <li className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
      <div className="relative aspect-video bg-black">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0" aria-label={`Play: ${title}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- YouTube's CDN serves it; no Netlify image cost */}
            <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" className="h-full w-full object-cover opacity-90 group-hover:opacity-100" />
            <span className="absolute inset-0 m-auto flex h-12 w-16 items-center justify-center rounded-xl bg-red-600/90 text-xl text-white group-hover:bg-red-600">▶</span>
            {badge && <span className="absolute left-2 top-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">{badge}</span>}
          </button>
        )}
      </div>
      <div className="p-3">
        <p className="line-clamp-2 text-sm font-semibold text-zinc-100">{title}</p>
        <p className="mt-1 text-xs text-zinc-500">{channelName} · {dateLabel}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <a href={watch} target="_blank" rel="noopener noreferrer" className={link}>▶ Watch on YouTube</a>
          <a href={watch} target="_blank" rel="noopener noreferrer" className={link} title="Likes count on YouTube itself">👍 Like</a>
          <a href={subscribeHref} target="_blank" rel="noopener noreferrer" className={link}>🔔 Subscribe</a>
        </div>
      </div>
    </li>
  );
}
