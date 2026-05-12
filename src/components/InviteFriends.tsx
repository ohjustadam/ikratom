"use client";

import { useState } from "react";

/**
 * Multi-platform share component. Renders a row of one-tap share buttons
 * (FB, Messenger, X, Threads, Bluesky, LinkedIn, Reddit, WhatsApp,
 * Telegram, SMS, Email) plus copy-link / copy-message. Each platform
 * gets the appropriate intent URL.
 *
 * Privacy stance is preserved from v1:
 *   - We don't sync friend lists (ethics)
 *   - We don't auto-DM anyone (every platform's TOS)
 *   - We don't track WHO you invite at the platform layer
 *
 * Attribution comes from the invite URL itself — when someone you
 * invited signs up, the proxy reads the ?via=CODE cookie and writes
 * an invite_redemptions row. You see them in your hub later.
 *
 * Props:
 *   inviteUrl — full URL (with /i/CODE or ?via=CODE) the recipient
 *               clicks. Caller is responsible for building it via
 *               buildInviteUrl().
 *   messageOverride — optional custom invite copy. Default works for
 *               most cases.
 */
export function InviteFriends({
  inviteUrl,
  messageOverride,
  compact = false,
}: {
  inviteUrl: string;
  messageOverride?: string;
  compact?: boolean;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const message =
    messageOverride ??
    `Joined iKratom — a nonpartisan kratom advocacy platform. ` +
    `Emailing your reps about kratom takes ~30 seconds, real personalized messages, no bot. ` +
    `Take a look: ${inviteUrl}`;

  const subject = "You should check out iKratom";

  // Build platform URLs. Most use simple intent / share endpoints.
  const u = encodeURIComponent(inviteUrl);
  const m = encodeURIComponent(message);
  const s = encodeURIComponent(subject);

  const platforms: Array<{
    key: string;
    label: string;
    href: string;
    icon: string;
    accent: string;
  }> = [
    {
      key: "fb",
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
      icon: "📘",
      accent: "border-blue-900/50 bg-blue-950/20 text-blue-300 hover:border-blue-500",
    },
    {
      key: "messenger",
      label: "Messenger",
      // Messenger's standalone share dialog (no app_id required for /share/)
      href: `https://www.facebook.com/dialog/send?app_id=&link=${u}&redirect_uri=${u}`,
      icon: "💬",
      accent: "border-blue-900/50 bg-blue-950/20 text-blue-300 hover:border-blue-500",
    },
    {
      key: "x",
      label: "X / Twitter",
      href: `https://twitter.com/intent/tweet?text=${m}`,
      icon: "𝕏",
      accent: "border-zinc-700 text-zinc-200 hover:border-zinc-400",
    },
    {
      key: "threads",
      label: "Threads",
      href: `https://www.threads.net/intent/post?text=${m}`,
      icon: "@",
      accent: "border-zinc-700 text-zinc-200 hover:border-zinc-400",
    },
    {
      key: "bluesky",
      label: "Bluesky",
      href: `https://bsky.app/intent/compose?text=${m}`,
      icon: "🦋",
      accent: "border-sky-900/50 bg-sky-950/20 text-sky-300 hover:border-sky-500",
    },
    {
      key: "linkedin",
      label: "LinkedIn",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
      icon: "in",
      accent: "border-blue-900/50 bg-blue-950/20 text-blue-300 hover:border-blue-500",
    },
    {
      key: "reddit",
      label: "Reddit",
      href: `https://www.reddit.com/submit?url=${u}&title=${s}`,
      icon: "🟠",
      accent: "border-orange-900/50 bg-orange-950/20 text-orange-300 hover:border-orange-500",
    },
    {
      key: "whatsapp",
      label: "WhatsApp",
      href: `https://wa.me/?text=${m}`,
      icon: "🟢",
      accent: "border-emerald-900/50 bg-emerald-950/20 text-emerald-300 hover:border-emerald-500",
    },
    {
      key: "telegram",
      label: "Telegram",
      href: `https://t.me/share/url?url=${u}&text=${encodeURIComponent(message.replace(inviteUrl, "").trim())}`,
      icon: "✈",
      accent: "border-sky-900/50 bg-sky-950/20 text-sky-300 hover:border-sky-500",
    },
    {
      key: "sms",
      label: "Text / SMS",
      href: `sms:?&body=${m}`,
      icon: "📱",
      accent: "border-emerald-900/50 bg-emerald-950/20 text-emerald-300 hover:border-emerald-500",
    },
    {
      key: "email",
      label: "Email",
      href: `mailto:?subject=${s}&body=${m}`,
      icon: "✉",
      accent: "border-zinc-700 text-zinc-300 hover:border-emerald-500",
    },
  ];

  function copyTo(key: "link" | "message", value: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(value)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2200);
      })
      .catch(() => { /* ignore */ });
  }

  return (
    <div className={`rounded-md border border-zinc-800 bg-zinc-950/40 ${compact ? "p-3" : "p-4"}`}>
      {!compact && (
        <p className="text-xs text-zinc-400">
          One tap per platform — opens a pre-filled message you can edit before
          sending. We don&apos;t see who you invite; we just track that someone
          joined through your link so we can credit you.
        </p>
      )}

      {/* Direct copy of the link itself */}
      <div className="mt-3 flex flex-wrap gap-2">
        <div className="flex flex-1 min-w-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5">
          <input
            readOnly
            value={inviteUrl}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            className="min-w-0 flex-1 bg-transparent text-xs text-zinc-200 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => copyTo("link", inviteUrl)}
            className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium text-emerald-400 hover:bg-zinc-900"
          >
            {copiedKey === "link" ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* Platform buttons */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {platforms.map((p) => (
          <a
            key={p.key}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${p.accent}`}
          >
            <span aria-hidden>{p.icon}</span>
            <span>{p.label}</span>
          </a>
        ))}
        <button
          type="button"
          onClick={() => copyTo("message", message)}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:border-emerald-500"
        >
          <span aria-hidden>📋</span>
          {copiedKey === "message" ? "✓ Copied" : "Copy message"}
        </button>
      </div>
    </div>
  );
}
