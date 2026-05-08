"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setForumSubscription } from "@/modules/forum/engagement-actions";
import { type SubMode } from "@/modules/forum/engagement-keys";

/**
 * Three-state subscribe pill: "Subscribe" → "Alerts on" / "Digest" /
 * "Muted." Click cycles through Alerts → Digest → Mute → Off.
 *
 * Modes:
 *   alerts — push notification on every new thread (high signal, for
 *            forums you care deeply about)
 *   digest — once-a-day summary of new threads (low signal)
 *   mute   — explicitly suppress (used to drown out a noisy state
 *            forum without unsubscribing entirely)
 *   null   — default — no opt-in either way
 *
 * Why client-side cycling instead of a dropdown: the most common
 * action is "I want alerts" or "stop alerting me," which are one tap
 * apart. A dropdown adds friction without much information gain.
 */
export function ForumSubscribeButton({
  forumKey,
  initialMode,
  signedIn,
}: {
  forumKey: string;
  initialMode: SubMode | null;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<SubMode | null>(initialMode);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    // Anonymous users see a sign-in prompt instead — clicking subscribe
    // before auth would just error.
    return (
      <a
        href="/login"
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
      >
        🔔 Sign in to subscribe
      </a>
    );
  }

  function next(current: SubMode | null): SubMode | null {
    if (current === null) return "alerts";
    if (current === "alerts") return "digest";
    if (current === "digest") return "mute";
    return null; // mute → off
  }

  function onClick() {
    setError(null);
    const target = next(mode);
    startTransition(async () => {
      const r = await setForumSubscription({ forumKey, mode: target });
      if ("error" in r) {
        setError(r.error ?? "Failed");
      } else {
        setMode(target);
        router.refresh();
      }
    });
  }

  const label =
    mode === "alerts" ? "🔔 Alerts on" :
    mode === "digest" ? "📰 Daily digest" :
    mode === "mute" ? "🔕 Muted" :
    "🔔 Subscribe";

  const cls =
    mode === "alerts" ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-300 hover:border-emerald-500" :
    mode === "digest" ? "border-blue-700/50 bg-blue-950/20 text-blue-300 hover:border-blue-500" :
    mode === "mute" ? "border-zinc-700 bg-zinc-950/40 text-zinc-500 hover:border-zinc-500" :
    "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-emerald-500 hover:text-emerald-300";

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        title={
          mode === "alerts" ? "Click for daily digest instead" :
          mode === "digest" ? "Click to mute this forum" :
          mode === "mute" ? "Click to clear the mute" :
          "Click to get alerts on every new thread"
        }
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs disabled:opacity-50 ${cls}`}
      >
        {pending ? "…" : label}
      </button>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  );
}
