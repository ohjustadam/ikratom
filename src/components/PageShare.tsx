"use client";

import { useState } from "react";

/**
 * Per-page share button — sits on bill / legislator / news / briefing
 * / library pages so a user can share THIS PAGE not just the platform.
 *
 * Compact: a single "Share" button that opens an inline dropdown with
 * the same 11 platform buttons as the header share modal. Different
 * surface from HeaderShare because:
 *   - It carries the specific page's URL + title + summary, not the
 *     user's personal invite link.
 *   - It anchors inline at the page-header level, not a global modal.
 *
 * The url param is the canonical URL (including the user's invite code
 * if they're signed in — caller passes that in).
 */
export function PageShare({
  url,
  title,
  summary,
  align = "right",
}: {
  url: string;
  title: string;
  summary?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const message = summary
    ? `${title} — ${summary} ${url}`
    : `${title} ${url}`;
  const u = encodeURIComponent(url);
  const m = encodeURIComponent(message);
  const s = encodeURIComponent(title);

  const platforms = [
    { key: "fb", label: "Facebook", icon: "📘", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { key: "x", label: "X", icon: "𝕏", href: `https://twitter.com/intent/tweet?text=${m}` },
    { key: "threads", label: "Threads", icon: "@", href: `https://www.threads.net/intent/post?text=${m}` },
    { key: "bluesky", label: "Bluesky", icon: "🦋", href: `https://bsky.app/intent/compose?text=${m}` },
    { key: "linkedin", label: "LinkedIn", icon: "in", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { key: "reddit", label: "Reddit", icon: "🟠", href: `https://www.reddit.com/submit?url=${u}&title=${s}` },
    { key: "whatsapp", label: "WhatsApp", icon: "🟢", href: `https://wa.me/?text=${m}` },
    { key: "telegram", label: "Telegram", icon: "✈", href: `https://t.me/share/url?url=${u}&text=${s}` },
    { key: "sms", label: "Text", icon: "📱", href: `sms:?&body=${m}` },
    { key: "email", label: "Email", icon: "✉", href: `mailto:?subject=${s}&body=${m}` },
  ];

  function copy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  // Native share API if available (mobile primarily). Falls through to
  // dropdown if not. Better UX on iOS/Android since it uses the native
  // share sheet (all installed apps appear).
  function nativeShare() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      navigator
        .share({ title, text: summary ?? title, url })
        .catch(() => setOpen((o) => !o));
      return;
    }
    setOpen((o) => !o);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={nativeShare}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-400"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        Share
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute top-full z-30 mt-1 w-72 rounded-md border border-zinc-800 bg-zinc-950 p-2 shadow-2xl ${align === "right" ? "right-0" : "left-0"}`}
        >
          <div className="grid grid-cols-3 gap-1">
            {platforms.map((p) => (
              <a
                key={p.key}
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="inline-flex flex-col items-center justify-center gap-0.5 rounded px-2 py-2 text-[11px] text-zinc-300 hover:bg-zinc-900 hover:text-emerald-400"
              >
                <span className="text-base" aria-hidden>{p.icon}</span>
                {p.label}
              </a>
            ))}
            <button
              type="button"
              onClick={copy}
              className="inline-flex flex-col items-center justify-center gap-0.5 rounded px-2 py-2 text-[11px] text-zinc-300 hover:bg-zinc-900 hover:text-emerald-400"
            >
              <span className="text-base" aria-hidden>📋</span>
              {copied ? "✓ Copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
