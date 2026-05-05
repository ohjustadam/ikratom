"use client";

import { useState, useTransition } from "react";
import {
  signOutOtherDevices,
  signOutEverywhere,
  type SessionInfo,
} from "../actions-sessions";

export function SessionsPanel({ initial }: { initial: SessionInfo[] }) {
  const [sessions, setSessions] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function revokeOthers() {
    if (!confirm("Sign out every other device that's currently signed in to this account?")) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const r = await signOutOtherDevices();
      if ("error" in r) setError(r.error);
      else {
        setSessions(sessions.filter((s) => s.isCurrent));
        setSuccess("Signed out other devices.");
      }
    });
  }

  function revokeAll() {
    if (!confirm("Sign out EVERY device, including this one? You'll need to sign back in.")) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const r = await signOutEverywhere();
      if ("error" in r) setError(r.error);
      else window.location.href = "/login";
    });
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-zinc-500">No active sessions to display.</p>;
  }

  const others = sessions.filter((s) => !s.isCurrent);

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li
            key={s.id}
            className={`rounded-md border px-4 py-3 text-sm ${
              s.isCurrent
                ? "border-emerald-700/40 bg-emerald-950/10"
                : "border-zinc-800 bg-zinc-950/60"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-200">
                    {summarizeUserAgent(s.userAgent)}
                  </span>
                  {s.isCurrent && (
                    <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                      THIS DEVICE
                    </span>
                  )}
                  {s.aal === "aal2" && (
                    <span
                      className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400"
                      title="Signed in with two-factor"
                    >
                      2FA
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  {s.ip ?? "(unknown IP)"} · last used {timeAgo(s.updatedAt)}
                  <span className="ml-2 text-zinc-600">
                    · created {new Date(s.createdAt).toLocaleDateString()}
                  </span>
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {others.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={revokeOthers}
            disabled={pending}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:border-amber-500 hover:text-amber-300 disabled:opacity-50"
          >
            Sign out other devices ({others.length})
          </button>
          <button
            onClick={revokeAll}
            disabled={pending}
            className="rounded-md border border-red-900/50 px-3 py-1.5 text-sm text-red-300 hover:border-red-700 disabled:opacity-50"
          >
            Sign out everywhere
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {success}
        </p>
      )}
    </div>
  );
}

function summarizeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const lc = ua.toLowerCase();
  // Browser
  let browser = "Browser";
  if (lc.includes("firefox")) browser = "Firefox";
  else if (lc.includes("edg/")) browser = "Edge";
  else if (lc.includes("chrome")) browser = "Chrome";
  else if (lc.includes("safari")) browser = "Safari";
  // OS
  let os = "Unknown OS";
  if (lc.includes("windows")) os = "Windows";
  else if (lc.includes("mac os") || lc.includes("macintosh")) os = "macOS";
  else if (lc.includes("iphone") || lc.includes("ipad")) os = "iOS";
  else if (lc.includes("android")) os = "Android";
  else if (lc.includes("linux")) os = "Linux";
  return `${browser} on ${os}`;
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const days = Math.floor(sec / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
