"use client";

import { useState } from "react";

/**
 * One-click share to every major platform — no OAuth required.
 *
 * Owner directive 2026-05-17: "we may as well include all social media
 * platform syncing as well so sharing is extremely easy without having
 * to navigate away from ikratom... social media action campaigns that
 * can be developed, posted or shared across all synced networks with
 * one click of a button."
 *
 * This is the no-OAuth tier of that vision: share-INTENT URLs that
 * every major platform exposes. Click → opens a pre-filled compose
 * window in a new tab → user reviews and posts (or doesn't). Works
 * without storing any social credentials.
 *
 * Mobile: Web Share API delegates to the OS-level share sheet (which
 * includes all installed apps — Snapchat, TikTok, WhatsApp, etc.).
 *
 * Platforms supported:
 *   - X (Twitter)        intent compose
 *   - Bluesky            intent compose
 *   - Reddit             submit link
 *   - LinkedIn           share-offsite
 *   - Telegram           share/url
 *   - WhatsApp           wa.me
 *   - Facebook           sharer.php
 *   - Threads            intent post
 *   - Email              mailto: prefilled
 *   - SMS                sms: prefilled (mobile only — Web Share covers iOS)
 *   - Copy link          clipboard
 *   - Web Share API      OS-level share sheet (mobile only)
 *
 * Higher-tier (OAuth posting) requires per-platform developer apps +
 * review by each platform. We don't gate this — they're share INTENTS,
 * not API posts. User stays in control of what gets posted.
 */

type Props = {
  /** Canonical URL to share. Absolute https URL. */
  url: string;
  /** Short title that shows up as the post body's headline. */
  title: string;
  /** Optional longer description (used by some platforms; truncated to safe length per platform). */
  description?: string;
  /** Optional hashtags array (no # prefix). Some platforms (X, Bluesky) use these inline. */
  hashtags?: string[];
  /** Compact mode: render just icons (no labels). */
  compact?: boolean;
};

export function ShareEverywhere({ url, title, description, hashtags, compact }: Props) {
  const [copied, setCopied] = useState(false);
  const [canWebShare, setCanWebShare] = useState<boolean | null>(null);

  // Lazy-detect Web Share API support so SSR matches CSR
  if (canWebShare === null && typeof navigator !== "undefined") {
    setCanWebShare(typeof navigator.share === "function");
  }

  const encUrl = encodeURIComponent(url);
  const encTitle = encodeURIComponent(title);
  const encDesc = encodeURIComponent(description ?? "");
  const tagsLine = hashtags && hashtags.length > 0 ? " " + hashtags.map((t) => `#${t}`).join(" ") : "";
  const encText = encodeURIComponent(`${title}${tagsLine}`);
  const encBody = encodeURIComponent(`${title}\n\n${description ?? ""}\n\n${url}`);

  const links: Array<{
    id: string;
    label: string;
    icon: string;
    href: string;
    color: string;
    title: string;
  }> = [
    {
      id: "x",
      label: "X",
      icon: "𝕏",
      href: `https://twitter.com/intent/tweet?text=${encText}&url=${encUrl}`,
      color: "bg-zinc-950 hover:bg-zinc-900 text-white",
      title: "Share on X",
    },
    {
      id: "bluesky",
      label: "Bluesky",
      icon: "🦋",
      href: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${title}${tagsLine}\n\n${url}`)}`,
      color: "bg-sky-600 hover:bg-sky-500 text-white",
      title: "Share on Bluesky",
    },
    {
      id: "reddit",
      label: "Reddit",
      icon: "👽",
      href: `https://www.reddit.com/submit?url=${encUrl}&title=${encTitle}`,
      color: "bg-orange-600 hover:bg-orange-500 text-white",
      title: "Share on Reddit",
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      icon: "in",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encUrl}`,
      color: "bg-[#0A66C2] hover:bg-[#0958A8] text-white",
      title: "Share on LinkedIn",
    },
    {
      id: "telegram",
      label: "Telegram",
      icon: "✈",
      href: `https://t.me/share/url?url=${encUrl}&text=${encText}`,
      color: "bg-[#26A5E4] hover:bg-[#1d8bbe] text-white",
      title: "Share on Telegram",
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      icon: "💬",
      href: `https://wa.me/?text=${encodeURIComponent(`${title}\n${url}`)}`,
      color: "bg-[#25D366] hover:bg-[#1FB855] text-white",
      title: "Share on WhatsApp",
    },
    {
      id: "facebook",
      label: "Facebook",
      icon: "f",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encUrl}`,
      color: "bg-[#1877F2] hover:bg-[#1466d8] text-white",
      title: "Share on Facebook",
    },
    {
      id: "threads",
      label: "Threads",
      icon: "@",
      href: `https://www.threads.net/intent/post?text=${encodeURIComponent(`${title}${tagsLine}\n\n${url}`)}`,
      color: "bg-zinc-950 hover:bg-zinc-900 text-white",
      title: "Share on Threads",
    },
    {
      id: "email",
      label: "Email",
      icon: "✉",
      href: `mailto:?subject=${encTitle}&body=${encBody}`,
      color: "bg-zinc-700 hover:bg-zinc-600 text-white",
      title: "Share via email",
    },
    {
      id: "sms",
      label: "SMS",
      icon: "📱",
      href: `sms:?&body=${encodeURIComponent(`${title}\n${url}`)}`,
      color: "bg-emerald-700 hover:bg-emerald-600 text-white",
      title: "Share via SMS",
    },
  ];

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API can fail in non-secure contexts or restricted iframes
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); } catch { /* swallow */ }
      document.body.removeChild(ta);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, text: description ?? title, url });
    } catch {
      // User cancelled — that's fine. No-op.
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
        📣 Share — one click each
      </p>
      <p className="mt-1 text-[11px] text-zinc-500">
        Opens a pre-filled post you can review before sending. No accounts linked, no data stored — pure share intent.
      </p>
      <div className={compact ? "mt-2 flex flex-wrap gap-1.5" : "mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"}>
        {canWebShare && (
          <button
            type="button"
            onClick={nativeShare}
            title="OS share sheet (Snapchat, TikTok, IG, etc.)"
            className={`inline-flex items-center justify-center gap-1.5 rounded-md bg-purple-700 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-600 ${compact ? "" : "w-full"}`}
          >
            <span className="text-base">↗</span>
            {!compact && <span>Share to apps</span>}
          </button>
        )}
        {links.map((l) => (
          <a
            key={l.id}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            title={l.title}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold ${l.color} ${compact ? "" : "w-full"}`}
          >
            <span className="text-base font-bold">{l.icon}</span>
            {!compact && <span>{l.label}</span>}
          </a>
        ))}
        <button
          type="button"
          onClick={copyLink}
          title="Copy link"
          className={`inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-emerald-500 ${compact ? "" : "w-full"}`}
        >
          <span>{copied ? "✓" : "🔗"}</span>
          {!compact && <span>{copied ? "Copied" : "Copy link"}</span>}
        </button>
      </div>
    </div>
  );
}
