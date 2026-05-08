"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { unlinkDiscord, type DiscordLink } from "../actions-discord";

/**
 * "Sign in with Discord" / linked-account display block on /account.
 * Shows the linked Discord username + avatar when present, with an
 * unlink button. When unlinked, shows the connect button which kicks
 * off /api/oauth/discord/start.
 */
export function DiscordConnect({
  link,
  flashError,
  flashConnected,
}: {
  link: DiscordLink;
  flashError?: string | null;
  flashConnected?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onUnlink() {
    if (!confirm("Unlink your Discord account from iKratom?")) return;
    startTransition(async () => {
      await unlinkDiscord();
      router.refresh();
    });
  }

  return (
    <div>
      {flashConnected && (
        <p className="mb-3 rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          ✓ Discord linked. Welcome.
        </p>
      )}
      {flashError && (
        <p className="mb-3 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {flashError === "not_configured"
            ? "Discord OAuth isn't configured yet — admin needs to set DISCORD_OAUTH_CLIENT_ID + DISCORD_OAUTH_CLIENT_SECRET."
            : flashError === "state_mismatch"
            ? "Security check failed (state mismatch). Please try again."
            : flashError === "already_linked_other"
            ? "That Discord account is already linked to a different iKratom profile."
            : flashError === "token_exchange_failed" || flashError === "identity_fetch_failed"
            ? "Discord wouldn't let us complete the link. Try again."
            : `Couldn't link: ${flashError}`}
        </p>
      )}

      {link.linked ? (
        <div className="flex items-center gap-3">
          {link.avatar_url && (
            <img
              src={link.avatar_url}
              alt=""
              className="h-12 w-12 rounded-full border border-zinc-800"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-zinc-100">{link.username}</p>
            <p className="text-xs text-zinc-500">
              Linked {link.linked_at && new Date(link.linked_at).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onUnlink}
            disabled={pending}
            className="rounded-md border border-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:border-red-700 disabled:opacity-50"
          >
            Unlink
          </button>
        </div>
      ) : (
        <a
          href="/api/oauth/discord/start"
          className="inline-flex items-center gap-2 rounded-md bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4752C4]"
        >
          {/* Discord glyph */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M19.27 5.33A18 18 0 0 0 14.92 4l-.21.43a16 16 0 0 0-5.42 0L9.08 4a18 18 0 0 0-4.35 1.33A18.6 18.6 0 0 0 .87 18a18 18 0 0 0 5.41 2.74l.43-.6a13 13 0 0 1-2.07-1l.5-.4a13 13 0 0 0 11.52 0l.5.4a13 13 0 0 1-2.07 1l.43.6A18 18 0 0 0 23.13 18a18.6 18.6 0 0 0-3.86-12.67ZM8.52 14.94a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Zm6.96 0a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Z"/>
          </svg>
          Sign in with Discord
        </a>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        Linking lets us recognize you across the iKratom Discord and (eventually) award the &ldquo;Discord verified&rdquo; badge for participating in trusted kratom communities.
      </p>
    </div>
  );
}
