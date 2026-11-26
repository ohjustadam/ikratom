"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useSignIn } from "@/components/auth/SignInContext";
import { checkLink, shareLink, type LinkBoxResult } from "@/modules/link-box/actions";
import { SmartLinkResult } from "./SmartLinkResult";

/**
 * The smart link box (owner ask 2026-11-25): one big box, one button, plain
 * words, large text. A member pastes or shares a link; the site checks it and
 * says "we already have this, here it is" or "thanks, it's new, we're adding
 * it". Lives on the homepage, the dashboard and /alerts/submit (which the
 * phone's share sheet and the app icon's "Share a link" shortcut open).
 *
 * A link that arrives from the share sheet is only LOOKED at automatically.
 * Adding it still takes the member's own tap, so a crafted link can't file a
 * tip in someone's name.
 */
export function SmartLinkBox({
  initialUrl = "",
  autoCheck = false,
  heading = "Seen something about kratom? Share the link.",
  compact = false,
}: {
  initialUrl?: string;
  autoCheck?: boolean;
  heading?: string;
  compact?: boolean;
}) {
  const { user, requireSignIn } = useSignIn();
  const [url, setUrl] = useState(initialUrl);
  const [result, setResult] = useState<{ url: string; r: LinkBoxResult } | null>(null);
  const [pending, start] = useTransition();
  const checkedOnce = useRef(false);

  useEffect(() => {
    if (!autoCheck || checkedOnce.current || !user || !initialUrl.trim()) return;
    checkedOnce.current = true;
    start(async () => {
      const r = await checkLink(initialUrl).catch(() => null);
      if (r) setResult({ url: initialUrl, r });
    });
  }, [autoCheck, initialUrl, user]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const u = url.trim();
    if (!u) {
      setResult({ url: u, r: { status: "invalid", message: "Paste a link in the box first." } });
      return;
    }
    if (!user && !(await requireSignIn())) return;
    start(async () => {
      const r = await shareLink(u).catch(() => ({ status: "error", message: "Something went wrong. Please try again." }) as LinkBoxResult);
      setResult({ url: u, r });
    });
  }

  // An answer for a link that has since been changed is never shown.
  const shown = result && result.url === url.trim() ? result.r : null;

  return (
    <section
      aria-label="Share a link"
      className={`rounded-xl border-2 border-emerald-600/60 bg-emerald-950/20 ${compact ? "p-4" : "p-5 sm:p-6"}`}
    >
      <h2 className={`font-bold text-zinc-50 ${compact ? "text-xl" : "text-2xl"}`}>🔗 {heading}</h2>
      <p className="mt-1 text-lg text-zinc-300">Paste it below. We&apos;ll check if we already have it.</p>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <label htmlFor="smart-link-input" className="sr-only">Link</label>
        <input
          id="smart-link-input"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a link here"
          maxLength={2000}
          className="h-16 w-full rounded-lg border-2 border-zinc-600 bg-zinc-950 px-4 text-xl text-zinc-50 placeholder:text-zinc-500 focus:border-emerald-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-emerald-500 py-4 text-2xl font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-70"
        >
          {pending ? "Checking…" : "Share it"}
        </button>
      </form>
      {!user && <p className="mt-3 text-base text-zinc-400">You&apos;ll be asked to sign in first. It&apos;s free.</p>}
      <div aria-live="polite" className="mt-4 empty:mt-0">
        {pending && <p className="text-xl text-zinc-200">Checking…</p>}
        {!pending && shown && <SmartLinkResult result={shown} url={url.trim()} />}
      </div>
    </section>
  );
}
