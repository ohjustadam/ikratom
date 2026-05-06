"use client";

import { useState } from "react";

/**
 * Invite-by-personal-message: a kratom-friendly migration nudge for FB
 * users. We don't sync friend lists (ethics), we don't auto-DM anyone
 * (TOS), we don't even track who you invited (privacy).
 *
 * The user clicks a button → opens FB Messenger / X DM / Email / SMS
 * with a pre-filled invite they can edit. Each platform has its own
 * "compose this DM" URL we deep-link to.
 */
export function InviteFriends({
  inviteUrl,
}: {
  inviteUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const message =
    `I just joined iKratom — it's a kratom-advocacy platform that makes ` +
    `emailing your legislators about kratom take like 30 seconds. ` +
    `Personalized, real, not a bot. Worth a look: ${inviteUrl}`;

  const fbMessenger = `https://www.facebook.com/dialog/send?app_id=&link=${encodeURIComponent(inviteUrl)}&redirect_uri=${encodeURIComponent(inviteUrl)}`;
  const fbShare = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(inviteUrl)}`;
  const xDm = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
  const sms = `sms:?body=${encodeURIComponent(message)}`;
  const mailto = `mailto:?subject=${encodeURIComponent("You should check out iKratom")}&body=${encodeURIComponent(message)}`;

  function copyMessage() {
    navigator.clipboard.writeText(message).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => { /* ignore */ });
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-xs text-zinc-400">
        Send a personal note to one or two friends. We don&apos;t see who you invite.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={fbShare}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-blue-900/50 bg-blue-950/20 px-3 py-1.5 text-xs text-blue-300 hover:border-blue-500"
        >
          Share on Facebook
        </a>
        <a
          href={fbMessenger}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-blue-900/50 bg-blue-950/20 px-3 py-1.5 text-xs text-blue-300 hover:border-blue-500"
        >
          Messenger DM
        </a>
        <a
          href={xDm}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-400"
        >
          Post on X
        </a>
        <a
          href={sms}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-900/50 bg-emerald-950/20 px-3 py-1.5 text-xs text-emerald-300 hover:border-emerald-500"
        >
          Text a friend
        </a>
        <a
          href={mailto}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500"
        >
          Email
        </a>
        <button
          type="button"
          onClick={copyMessage}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500"
        >
          {copied ? "✓ Copied" : "Copy invite"}
        </button>
      </div>
    </div>
  );
}
