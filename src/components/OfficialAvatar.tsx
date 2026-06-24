"use client";

import { useState } from "react";

/**
 * Avatar for an official/legislator. Renders the portrait when we have one,
 * else (or on load failure) a deterministic initials chip.
 *
 * Plain <img> on purpose: next.config.ts has no images.remotePatterns, so
 * next/image would reject our R2 / source-CDN portrait URLs. CSP img-src
 * already allows any https host, so both cached (R2) and hotlinked source
 * URLs render. Decorative — the official's name is always shown as adjacent
 * text, so the wrapper is aria-hidden to avoid double-announcement.
 */
const SIZES = {
  sm: "h-8 w-8 text-[10px]",
  md: "h-10 w-10 text-xs",
  lg: "h-16 w-16 text-base",
} as const;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function OfficialAvatar({
  name,
  portraitUrl,
  size = "md",
  className = "",
}: {
  name: string;
  portraitUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const show = Boolean(portraitUrl) && !failed;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-800 font-semibold text-zinc-400 ring-1 ring-zinc-700 ${SIZES[size]} ${className}`}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={portraitUrl as string}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
