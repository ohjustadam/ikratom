"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "@/components/Link";
import type { TickerItem } from "@/lib/ticker";

/**
 * The news-channel style crawl under the site header (owner ask 2026-10-21).
 * Items come from /api/ticker (cached 10 min at the CDN) and are kept 10 min in
 * the browser, so a visitor clicking around costs one request, not one per page.
 * Pauses on hover and keyboard focus; with reduced motion it doesn't scroll and
 * becomes a swipeable row instead. "×" hides it until tomorrow.
 */

const CACHE_KEY = "ikratom-ticker-v1";
const HIDE_KEY = "ikratom-ticker-hidden-until";
const TTL_MS = 10 * 60 * 1000;

const TAG: Record<TickerItem["kind"], string> = {
  breaking: "bg-red-600 text-white",
  action: "bg-emerald-600 text-white",
  meeting: "bg-sky-600 text-white",
  alert: "bg-amber-500 text-zinc-950",
};

function Entry({ item, hidden }: { item: TickerItem; hidden?: boolean }) {
  return (
    <Link href={item.href} tabIndex={hidden ? -1 : undefined} className="inline-flex items-center gap-2 hover:text-emerald-300">
      <span className={`rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ${TAG[item.kind]}`}>{item.label}</span>
      <span>{item.text}</span>
    </Link>
  );
}

export function IntelTicker() {
  const path = usePathname();
  const [items, setItems] = useState<TickerItem[]>([]);
  const [hidden, setHidden] = useState(true); // server renders nothing; decided after mount

  useEffect(() => {
    let cancelled = false;
    try {
      if (Date.now() < Number(localStorage.getItem(HIDE_KEY) ?? 0)) return;
    } catch { /* storage blocked: show it */ }
    setHidden(false);
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
      if (c && Date.now() - c.t < TTL_MS && Array.isArray(c.items)) { setItems(c.items); return; }
    } catch { /* fall through to fetch */ }
    fetch("/api/ticker")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !Array.isArray(j?.items)) return;
        setItems(j.items);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), items: j.items })); } catch { /* ignore */ }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (hidden || !items.length || path?.startsWith("/embed") || path?.startsWith("/admin")) return null;

  function hideForToday() {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    try { localStorage.setItem(HIDE_KEY, String(end.getTime())); } catch { /* ignore */ }
    setHidden(true);
  }

  const seconds = Math.max(30, items.length * 9);
  return (
    <div role="region" aria-label="Latest kratom policy intel" className="border-t border-zinc-800/80 bg-zinc-900/70">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1 text-xs text-zinc-300 sm:px-6 lg:px-8">
        <span className="shrink-0 font-semibold uppercase tracking-wider text-red-400" aria-hidden>● Live</span>
        <div className="group min-w-0 flex-1 overflow-hidden motion-reduce:overflow-x-auto">
          <div
            className="flex w-max gap-10 whitespace-nowrap motion-safe:animate-ticker group-hover:[animation-play-state:paused] group-has-[:focus-visible]:[animation-play-state:paused]"
            style={{ animationDuration: `${seconds}s` }}
          >
            {items.map((it) => <Entry key={it.href} item={it} />)}
            {/* Second copy makes the loop seamless; hidden from screen readers and tab order. */}
            <span aria-hidden className="flex gap-10 motion-reduce:hidden">
              {items.map((it) => <Entry key={`dup-${it.href}`} item={it} hidden />)}
            </span>
          </div>
        </div>
        <button type="button" onClick={hideForToday} aria-label="Hide the intel ticker until tomorrow" className="shrink-0 rounded px-1.5 text-zinc-500 hover:text-zinc-200">
          ×
        </button>
      </div>
    </div>
  );
}
