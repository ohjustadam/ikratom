"use client";

import { useState, useEffect } from "react";
import {
  buildShareUrl,
  withShareRef,
  NETWORK_LABEL,
  NETWORK_EMOJI,
  type ShareNetwork,
} from "./share";

/**
 * Amplify / share row. Replaces the old "bomb run" that opened 5 popups at once
 * (popup-blocked on desktop, broken on mobile). Three reliable paths instead:
 *
 *   1. Share (native sheet) — navigator.share opens the device's own share menu,
 *      so one tap posts to ANY installed app, including Instagram, TikTok,
 *      Snapchat, SMS, WhatsApp — the platforms that have NO web prefill URL.
 *      Shown when supported (all mobile + Safari/Edge desktop).
 *   2. Copy — copies the message + link to the clipboard so it can be pasted
 *      anywhere (Facebook strips prefilled text; IG/TikTok/Snap are app-only).
 *   3. Per-platform buttons — open ONE network on click (a user gesture, so no
 *      popup blocker), for X/Bluesky/Telegram/Mastodon/Facebook/Reddit/WhatsApp/Email.
 *
 * Attribution: every path tags ?ref=share&host=<channel> for proxy.ts crediting.
 */
const NETWORKS: ShareNetwork[] = [
  "x", "bluesky", "telegram", "mastodon", "facebook", "reddit", "whatsapp", "email",
];

export function ShareButtons({
  url,
  text: initialText,
  hashtags,
  compact = false,
}: {
  url: string;
  text: string;
  hashtags?: string[];
  compact?: boolean;
}) {
  const [text, setText] = useState(initialText);
  const [showEditor, setShowEditor] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  // Feature-detect after mount to avoid SSR hydration mismatch.
  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  function shareTo(network: ShareNetwork) {
    window.open(buildShareUrl({ network, text, url, hashtags }), "_blank", "noopener,noreferrer,width=560,height=620");
  }

  async function nativeShare() {
    try {
      await navigator.share({ text, url: withShareRef(url, "native") });
    } catch {
      /* user cancelled or unsupported — no-op */
    }
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(`${text} ${withShareRef(url, "copy")}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <div className={compact ? "" : "rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"}>
      {!compact && (
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">amplify</p>
            <h3 className="text-sm font-bold text-zinc-100">Spread the word</h3>
          </div>
          <button onClick={() => setShowEditor((v) => !v)} className="text-xs text-emerald-400 hover:underline">
            {showEditor ? "Hide" : "Edit"} message
          </button>
        </div>
      )}

      {showEditor && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="mb-3 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
        />
      )}

      {/* Primary actions: native share (mobile → any app incl. IG/TikTok/Snap) + copy */}
      <div className="flex flex-wrap gap-2">
        {canNativeShare && (
          <button
            onClick={nativeShare}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-bold text-zinc-950 hover:bg-emerald-400"
          >
            📲 Share…
          </button>
        )}
        <button
          onClick={copyMessage}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-4 py-1.5 text-xs font-semibold hover:border-emerald-500"
        >
          {copied ? "✓ Copied" : "📋 Copy message"}
        </button>
      </div>

      {/* Per-platform quick buttons — one at a time (no popup blast). */}
      <div className="mt-2 flex flex-wrap gap-2">
        {NETWORKS.map((n) => (
          <button
            key={n}
            onClick={() => shareTo(n)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
          >
            <span className="font-mono text-sm">{NETWORK_EMOJI[n]}</span>
            <span>{NETWORK_LABEL[n]}</span>
          </button>
        ))}
      </div>

      {!compact && (
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          {canNativeShare ? "Tap " : "On your phone, tap "}<span className="font-semibold text-zinc-400">Share</span> to post to
          {" "}<span className="text-zinc-400">Instagram, TikTok, Snapchat</span> & any app. Facebook strips typed text — use{" "}
          <span className="font-semibold text-zinc-400">Copy</span> and paste.
        </p>
      )}
    </div>
  );
}
