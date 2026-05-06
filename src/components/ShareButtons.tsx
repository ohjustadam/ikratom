"use client";

import { useState, useTransition } from "react";
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

  function logClick(platform: "facebook" | "x" | "reddit" | "sms" | "threads" | "copy_link") {
    startTransition(async () => {
      await recordShare({
        platform,
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
        href={smsHref}
        onClick={() => logClick("sms")}
        className={btn("border-emerald-900/50 bg-emerald-950/20 text-emerald-300 hover:border-emerald-500")}
        title="Send via text"
      >
        SMS
      </a>
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
