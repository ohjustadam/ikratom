"use client";

import { useEffect, useState } from "react";

/**
 * Multi-platform invite component. The privacy-preserving way to invite
 * friends to iKratom.
 *
 * Three tiers, in priority order:
 *   1. Native Web Share API — one tap → user's OS share sheet shows
 *      every messaging app + AirDrop + every contact. Privacy maximum:
 *      we never see who they pick. Falls back gracefully when not
 *      available (older browsers / desktop without share targets).
 *
 *   2. Contact Picker API (Chrome Android only) — user picks contacts
 *      from their phone book. We compose a single multi-recipient SMS
 *      draft. Phone numbers never leave the browser; nothing posts to
 *      our server.
 *
 *   3. Platform deep-link grid (the existing 11-platform set) — opens
 *      a pre-filled share dialog on each platform. User picks the
 *      recipient on the platform itself.
 *
 * Hard privacy rules baked in:
 *   - We don't ask for, store, or transmit any contact list to our DB
 *   - We don't have access to your social platform friends lists; those
 *     APIs were either deprecated (FB 2014) or moved to paid tiers (X)
 *   - The only thing we track is: someone signed up via your invite URL
 *     so we can credit you. The people you didn't invite don't exist
 *     to us.
 *
 * What about real social-platform friends-list "connect"? Honest answer
 * in the UI: those APIs are gone or paid. We don't fake it.
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
  const [canShare, setCanShare] = useState(false);
  const [canPickContacts, setCanPickContacts] = useState(false);
  const [pickedContacts, setPickedContacts] = useState<Array<{ name: string; tel: string }>>([]);
  const [pickerError, setPickerError] = useState<string | null>(null);

  // Feature-detect APIs once mounted (server-render-safe)
  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setCanShare(typeof navigator.share === "function");
      // Contact Picker API: Chrome on Android, HTTPS only
      // @ts-expect-error — Contacts API is not in stock TS lib yet
      setCanPickContacts(Boolean(navigator.contacts?.select));
    }
  }, []);

  const message =
    messageOverride ??
    `Joined iKratom — a nonpartisan kratom advocacy platform. ` +
    `Emailing your reps about kratom takes ~30 seconds, real personalized messages, no bot. ` +
    `Take a look: ${inviteUrl}`;

  const subject = "You should check out iKratom";

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

  async function nativeShare() {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: "iKratom",
        text: message,
        url: inviteUrl,
      });
    } catch (e) {
      // User canceled — that's fine. Don't surface as an error.
      if ((e as Error)?.name !== "AbortError") {
        // eslint-disable-next-line no-console
        console.warn("[invite] share failed:", e);
      }
    }
  }

  async function pickContactsForSms() {
    setPickerError(null);
    // @ts-expect-error — Contacts API is not in TS lib
    if (!navigator.contacts?.select) {
      setPickerError("Your browser doesn't support the contact picker. Try the SMS button below — it opens a blank message you can address yourself.");
      return;
    }
    try {
      // @ts-expect-error — Contacts API is not in TS lib
      const list = await navigator.contacts.select(["name", "tel"], { multiple: true });
      if (!list || list.length === 0) return;
      const flattened = (list as Array<{ name?: string[]; tel?: string[] }>)
        .flatMap((c) =>
          (c.tel ?? []).map((t) => ({
            name: (c.name ?? [])[0] ?? "(no name)",
            tel: t,
          })),
        )
        .filter((c) => c.tel)
        // Deduplicate by phone
        .filter((c, i, arr) => arr.findIndex((o) => o.tel === c.tel) === i);
      setPickedContacts(flattened);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setPickerError(`Couldn't read contacts: ${(e as Error).message?.slice(0, 100)}`);
      }
    }
  }

  // Build a single sms: link addressed to all picked contacts.
  // Comma separator works on iOS (which we won't hit — picker is Android-only)
  // and most Android SMS apps. body= pre-fills the message.
  const bulkSmsHref =
    pickedContacts.length > 0
      ? `sms:${pickedContacts.map((c) => c.tel.replace(/[^\d+]/g, "")).join(",")}?body=${m}`
      : null;

  return (
    <div className={`rounded-md border border-zinc-800 bg-zinc-950/40 ${compact ? "p-3" : "p-4"}`}>
      {!compact && (
        <p className="text-xs text-zinc-400">
          One tap per platform — opens a pre-filled message you edit before
          sending. We never see who you invite.
        </p>
      )}

      {/* Native share button — primary CTA on devices that support it.
          On iOS Safari + Chrome Android this opens the OS share sheet with
          every messaging app + contacts. Privacy-maximum path. */}
      {canShare && (
        <button
          type="button"
          onClick={nativeShare}
          className="mt-3 w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-bold text-zinc-950 hover:bg-emerald-400"
        >
          📲 Share with friends · open my share sheet
        </button>
      )}

      {/* Direct link copy */}
      <div className={`${canShare ? "mt-3" : "mt-3"} flex flex-wrap gap-2`}>
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

      {/* Contact Picker section — Chrome Android only.
          Surfaced only when the API is present; otherwise the section is
          hidden so it doesn't tease unavailable UX. */}
      {canPickContacts && (
        <div className="mt-4 rounded-md border border-emerald-700/30 bg-emerald-950/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
            📇 Pick contacts to text directly
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            <strong className="text-zinc-200">Your phone book stays on your phone.</strong>{" "}
            We never receive the names or numbers — your browser composes one
            SMS draft locally that you send through your texting app.
          </p>
          {pickedContacts.length === 0 ? (
            <button
              type="button"
              onClick={pickContactsForSms}
              className="mt-2 rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-500"
            >
              Pick contacts from my phone →
            </button>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-zinc-300">
                {pickedContacts.length} contact{pickedContacts.length === 1 ? "" : "s"} picked:
              </p>
              <ul className="max-h-32 overflow-y-auto text-[11px] text-zinc-400">
                {pickedContacts.map((c, i) => (
                  <li key={`${c.tel}-${i}`} className="flex gap-2">
                    <span className="truncate">{c.name}</span>
                    <span className="font-mono text-zinc-500">{c.tel}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {bulkSmsHref && (
                  <a
                    href={bulkSmsHref}
                    className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-500"
                  >
                    📤 Open SMS with {pickedContacts.length} recipient{pickedContacts.length === 1 ? "" : "s"}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPickedContacts([])}
                  className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          {pickerError && (
            <p className="mt-2 text-[11px] text-red-400">{pickerError}</p>
          )}
        </div>
      )}

      {/* Per-platform deep-link grid */}
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
