"use client";

import { useEffect, useState, useTransition } from "react";
import { markTourSurfaceSeen } from "./actions";

/**
 * First-visit tooltip — fires once per (user, surface) combo.
 *
 * Backed by profiles.tour_seen (jsonb map from migration 0075).
 * The first time a user opens a page that uses this, a small
 * popup appears anchored to a target selector. Once dismissed
 * (Got it / clicking outside / 12 seconds elapsed), we write
 * { [surface]: <iso-timestamp> } into profiles.tour_seen so
 * future visits stay quiet.
 *
 * Usage:
 *   <TourTooltip
 *     surface="pulse-news"
 *     alreadySeen={profile.tour_seen["pulse-news"] != null}
 *     title="📰 Most Critical News"
 *     body="National + your state's biggest kratom-policy stories, refreshed every hour."
 *     anchorSelector="#pulse-news-section"
 *   />
 *
 * Surfaces in use:
 *   pulse-news            — /pulse first visit; explains the news section
 *   campaign-personalize  — first campaign send card; teases ✨ Personalize button
 *   character-fields      — /account/character first visit
 *   intel-submit          — /alerts/submit first visit
 *   leader-tools          — /leader first visit (in addition to the leader tour)
 *
 * Anonymous users (no profile) never see tooltips. Tooltips are
 * additive — they never block UI; users can dismiss instantly.
 */
export function TourTooltip({
  surface,
  alreadySeen,
  title,
  body,
  anchorSelector,
  autoDismissMs = 12_000,
}: {
  surface: string;
  alreadySeen: boolean;
  title: string;
  body: string;
  anchorSelector?: string;
  autoDismissMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (alreadySeen) return;
    // Delay 600ms so the page has time to render the anchor element
    const t = setTimeout(() => {
      if (anchorSelector) {
        const el = document.querySelector(anchorSelector);
        if (el) {
          const rect = el.getBoundingClientRect();
          setPosition({
            top: rect.bottom + window.scrollY + 8,
            left: Math.max(8, rect.left + window.scrollX),
          });
        }
      }
      setOpen(true);
    }, 600);
    return () => clearTimeout(t);
  }, [alreadySeen, anchorSelector]);

  // Auto-dismiss
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => dismiss(), autoDismissMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoDismissMs]);

  function dismiss() {
    if (!open) return;
    setOpen(false);
    startTransition(async () => {
      try { await markTourSurfaceSeen(surface); } catch { /* best-effort */ }
    });
  }

  if (alreadySeen || !open) return null;

  // Centered floating when no anchor; positioned otherwise
  const style: React.CSSProperties = position
    ? { top: position.top, left: position.left }
    : { top: "auto", bottom: "1.5rem", left: "50%", transform: "translateX(-50%)" };

  return (
    <div
      className="fixed z-40 w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-emerald-500/60 bg-zinc-900 p-4 shadow-2xl"
      style={style}
      role="dialog"
      aria-label={`First visit tip: ${title}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-emerald-300">{title}</h3>
        <button
          onClick={dismiss}
          className="text-xs text-zinc-500 hover:text-zinc-200"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-300">{body}</p>
      <button
        onClick={dismiss}
        className="mt-3 rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
      >
        Got it
      </button>
    </div>
  );
}
