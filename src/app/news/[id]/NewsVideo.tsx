"use client";

import { useState } from "react";

/**
 * Native <video> for publisher self-hosted clips, with a graceful fallback:
 * many publisher CDNs hotlink-protect or sign their media URLs, so the file
 * may refuse to load off-site. On error we swap the dead player for a "Watch
 * at source" link instead of leaving a black box — preserving the link-out
 * fair-use posture. Fills its (relative, aspect-video) parent in both states.
 */
export function NewsVideo({
  src,
  poster,
  sourceName,
  href,
}: {
  src: string;
  poster?: string;
  sourceName?: string | null;
  href: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950 p-4 text-center">
        <p className="text-xs text-zinc-400">This clip can&apos;t play here.</p>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-emerald-700/40 bg-emerald-950/30 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:border-emerald-500"
        >
          {sourceName ? `Watch at ${sourceName}` : "Watch at source"} ↗
        </a>
      </div>
    );
  }

  return (
    <video
      src={src}
      poster={poster}
      controls
      preload="metadata"
      playsInline
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full"
    />
  );
}
