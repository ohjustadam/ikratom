"use client";

import { useState } from "react";
import {
  buildShareUrl,
  NETWORK_LABEL,
  NETWORK_EMOJI,
  type ShareNetwork,
} from "./share";

/**
 * "Social media bombing" — share-everywhere button row + edit-text
 * popover. Each button opens the network's compose dialog with text
 * + URL prefilled. Hashtags optional (X/Mastodon use them, others
 * ignore).
 *
 * "Bomb all" button opens every network's dialog in sequence (with
 * a small delay so popup blockers don't squash them all).
 *
 * Attribution: every share URL gets ?ref=share&host=<network>
 * appended so proxy.ts cookie-credits any landing user.
 */
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

  const networks: ShareNetwork[] = ["x", "bluesky", "telegram", "mastodon", "facebook"];

  function shareTo(network: ShareNetwork) {
    const shareUrl = buildShareUrl({ network, text, url, hashtags });
    window.open(shareUrl, "_blank", "noopener,noreferrer,width=560,height=620");
  }

  async function bombAll() {
    if (!confirm(`Open share dialogs for all ${networks.length} networks?`)) return;
    // Stagger so popup blockers (and the user) don't drown.
    for (const n of networks) {
      shareTo(n);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return (
    <div className={compact ? "" : "rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"}>
      {!compact && (
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">amplify</p>
            <h3 className="text-sm font-bold text-zinc-100">Share — every channel at once</h3>
          </div>
          <button
            onClick={() => setShowEditor((v) => !v)}
            className="text-xs text-emerald-400 hover:underline"
          >
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

      <div className="flex flex-wrap gap-2">
        {networks.map((n) => (
          <button
            key={n}
            onClick={() => shareTo(n)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
          >
            <span className="font-mono text-sm">{NETWORK_EMOJI[n]}</span>
            <span>{NETWORK_LABEL[n]}</span>
          </button>
        ))}
        {!compact && (
          <button
            onClick={bombAll}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400"
            title="Opens compose dialogs for all networks. You confirm + send each."
          >
            🚀 Bomb run
          </button>
        )}
      </div>
    </div>
  );
}
