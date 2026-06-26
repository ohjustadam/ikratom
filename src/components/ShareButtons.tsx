"use client";

import { useEffect, useState, useTransition } from "react";
import { recordShare } from "@/modules/campaigns/actions-attachments";

/**
 * Constituent-empowerment share buttons. User clicks → opens the
 * destination platform's share URL with content pre-filled. They post
 * personally on their account, in their voice. We log the click for
 * impact stats.
 *
 * Deliberately NOT automated mass-posting. Distributed organic
 * mobilization, not bot networks.
 */

export type ShareTarget =
  | { kind: "campaign"; campaignId: string }
  | { kind: "bill"; billId: string }
  | { kind: "story"; storyId: string };

export function ShareButtons({
  url,
  title,
  text,
  target,
  compact = false,
}: {
  url: string;
  title: string;
  text: string;
  target: ShareTarget;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  // Gate browser-only feature detection behind mount so the first client render
  // matches the server HTML (navigator is undefined on the server). Computing
  // navigator.share during render made the "More apps" button appear only on the
  // client → hydration text mismatch (React #418). It now appears post-mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  type Platform = "facebook" | "x" | "reddit" | "sms" | "threads" | "copy_link" | "bluesky" | "linkedin" | "telegram" | "whatsapp" | "email" | "native";
  function logClick(platform: Platform) {
    // recordShare's underlying enum only knows the original 6; cast new
    // platforms to "copy_link" so the click still gets counted as a
    // share-engagement event without a schema migration today. The
    // platform-specific breakdown can be added when the enum is expanded.
    const trackedPlatform: "facebook" | "x" | "reddit" | "sms" | "threads" | "copy_link" =
      platform === "facebook" || platform === "x" || platform === "reddit" ||
      platform === "sms" || platform === "threads" || platform === "copy_link"
        ? platform
        : "copy_link";
    startTransition(async () => {
      await recordShare({
        platform: trackedPlatform,
        campaignId: target.kind === "campaign" ? target.campaignId : undefined,
        billId: target.kind === "bill" ? target.billId : undefined,
        storyId: target.kind === "story" ? target.storyId : undefined,
      }).catch(() => { /* shares are best-effort */ });
    });
  }

  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  const xHref = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`;
  const redditHref = `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
  const smsHref = `sms:?body=${encodeURIComponent(`${title} — ${url}`)}`;
  const threadsHref = `https://www.threads.net/intent/post?text=${encodeURIComponent(`${title} ${url}`)}`;
  // Q3 #2 additions — Bluesky, LinkedIn, Telegram, WhatsApp, email, native:
  const blueskyHref = `https://bsky.app/intent/compose?text=${encodeURIComponent(`${title}\n\n${url}`)}`;
  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`;
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${title}\n${url}`)}`;
  const emailHref = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${title}\n\n${text}\n\n${url}`)}`;

  // Lazy-detect Web Share API for the mobile OS share-sheet button. Gated on
  // `mounted` so it's false during hydration (matching the server) and only
  // turns on after mount — avoids the SSR/client text mismatch (React #418).
  const canNativeShare = mounted && typeof navigator !== "undefined" && typeof navigator.share === "function";
  async function nativeShare() {
    try {
      await navigator.share({ title, text, url });
      logClick("native");
    } catch { /* user cancelled */ }
  }

  function copyLink() {
    navigator.clipboard.writeText(`${title}\n\n${text}\n\n${url}`).then(() => {
      setCopied(true);
      logClick("copy_link");
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => { /* ignore */ });
  }

  const btn = (extra: string) =>
    `inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs transition ${extra}`;

  return (
    <div className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"}>
      <a
        href={fbHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => logClick("facebook")}
        className={btn("border-blue-900/50 bg-blue-950/20 text-blue-300 hover:border-blue-500")}
        title="Share to Facebook"
      >
        Facebook
      </a>
      <a
        href={xHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => logClick("x")}
        className={btn("border-zinc-700 text-zinc-200 hover:border-zinc-400")}
        title="Share to X / Twitter"
      >
        X / Twitter
      </a>
      <a
        href={redditHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => logClick("reddit")}
        className={btn("border-orange-900/50 bg-orange-950/20 text-orange-300 hover:border-orange-500")}
        title="Share to Reddit"
      >
        Reddit
      </a>
      <a
        href={threadsHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => logClick("threads")}
        className={btn("border-zinc-700 text-zinc-200 hover:border-zinc-400")}
        title="Share to Threads"
      >
        Threads
      </a>
      <a
        href={blueskyHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => logClick("bluesky")}
        className={btn("border-sky-700/50 bg-sky-950/20 text-sky-200 hover:border-sky-400")}
        title="Share to Bluesky"
      >
        Bluesky
      </a>
      <a
        href={linkedinHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => logClick("linkedin")}
        className={btn("border-blue-800/50 bg-blue-950/20 text-blue-200 hover:border-blue-500")}
        title="Share to LinkedIn"
      >
        LinkedIn
      </a>
      <a
        href={telegramHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => logClick("telegram")}
        className={btn("border-sky-700/50 bg-sky-950/20 text-sky-200 hover:border-sky-400")}
        title="Share to Telegram"
      >
        Telegram
      </a>
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => logClick("whatsapp")}
        className={btn("border-emerald-700/50 bg-emerald-950/20 text-emerald-200 hover:border-emerald-400")}
        title="Share to WhatsApp"
      >
        WhatsApp
      </a>
      <a
        href={smsHref}
        onClick={() => logClick("sms")}
        className={btn("border-emerald-900/50 bg-emerald-950/20 text-emerald-300 hover:border-emerald-500")}
        title="Send via text"
      >
        SMS
      </a>
      <a
        href={emailHref}
        onClick={() => logClick("email")}
        className={btn("border-zinc-700 text-zinc-300 hover:border-emerald-500")}
        title="Send via email"
      >
        Email
      </a>
      {canNativeShare && (
        <button
          type="button"
          onClick={nativeShare}
          className={btn("border-purple-700/50 bg-purple-950/20 text-purple-200 hover:border-purple-400")}
          title="Share via system share sheet (Snapchat, TikTok, Instagram, etc.)"
        >
          ↗ More apps
        </button>
      )}
      <button
        type="button"
        onClick={copyLink}
        className={btn("border-zinc-700 text-zinc-300 hover:border-emerald-500")}
        title="Copy link + text"
      >
        {copied ? "✓ Copied" : "Copy link"}
      </button>
    </div>
  );
}
