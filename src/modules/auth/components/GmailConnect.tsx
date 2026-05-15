"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectGmailAction } from "../actions-gmail";

export function GmailConnect({
  status,
  flashError,
  flashConnected,
}: {
  status: { account_email: string } | null;
  flashError?: string | null;
  flashConnected?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function disconnect() {
    if (!confirm("Disconnect Gmail? You'll need to reconnect to send emails directly.")) return;
    startTransition(async () => {
      await disconnectGmailAction();
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <GmailIcon />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-zinc-100">Gmail send-on-behalf</h3>
          <p className="mt-1 text-xs text-zinc-400">
            Connect your Gmail and the Send button on campaigns becomes <em>truly</em> one-click —
            we send personalized emails to every legislator from your account, each
            landing in your Sent folder.
          </p>
        </div>
      </div>

      {flashError && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {prettyError(flashError)}
        </p>
      )}
      {flashConnected && !status && (
        <p className="rounded-md border border-amber-900/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
          Gmail connection didn&apos;t save. Try again.
        </p>
      )}

      {status ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-3">
          <div className="text-sm">
            <span className="font-semibold text-emerald-300">✓ Connected</span>
            <span className="ml-2 text-zinc-400">{status.account_email}</span>
          </div>
          <button
            onClick={disconnect}
            disabled={pending}
            className="rounded-md border border-zinc-700 px-3 py-1 text-xs hover:border-red-500 hover:text-red-300 disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <a
          href="/api/oauth/google/start"
          className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-100"
        >
          <GmailIcon size={16} /> Connect Gmail
        </a>
      )}
    </div>
  );
}

function GmailIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path fill="#EA4335" d="M5.5 19V8.7l-2-1.5C2.6 6.5 2 5.4 2 4.3 2 3 3 2 4.3 2c.6 0 1.1.2 1.5.5L12 7.5 18.2 2.5c.4-.3.9-.5 1.5-.5C21 2 22 3 22 4.3c0 1.1-.6 2.2-1.5 2.9l-2 1.5V19h-3v-9l-3.5 2.6L8.5 10v9h-3z" />
    </svg>
  );
}

function prettyError(code: string): string {
  switch (code) {
    case "not_configured":
      return "Gmail OAuth isn't configured on the server (admin: set GOOGLE_OAUTH_CLIENT_ID/SECRET).";
    case "bad_state":
      return "Security check failed (CSRF token mismatch). Please try again.";
    case "access_denied":
      return "You denied the Gmail permission. Try again to enable one-click sending.";
    case "no_refresh":
      return "Google didn't return a refresh token. Try again — and accept the consent screen.";
    case "redirect_uri_mismatch":
      return "Google's OAuth config doesn't have this site's URL registered yet. Notify the admin — they can fix this in 60 seconds via /admin/oauth-config.";
    case "token_exchange":
    case "token_fetch":
      return "Couldn't exchange the auth code with Google. Try again in a moment.";
    case "db_write":
      return "Couldn't save the connection. Try again.";
    case "missing_code":
      return "OAuth callback was missing a code parameter.";
    default:
      return `Gmail error: ${code}`;
  }
}
