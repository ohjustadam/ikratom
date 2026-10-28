"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Opens the floating Lounge (ChatPopup listens for this event). */
export function OpenLoungeButton({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event("ikratom:open-lounge"))}>
      {children}
    </button>
  );
}

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** "12m ago", computed in the browser so a cached page never shows a stale age. */
export function AgoText({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(ago(iso)), [iso]);
  return <span suppressHydrationWarning>{text ?? "recently"}</span>;
}
