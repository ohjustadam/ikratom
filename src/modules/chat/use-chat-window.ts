"use client";

import { useCallback, useEffect, useState } from "react";
import {
  clampRect, defaultRect, isSheetHeight, moveRect, parseRect, resizeFromTopLeft,
  type Rect, type SheetHeight,
} from "@/lib/chat-window";

const RECT_KEY = "ikratom:lounge:rect";
const SHEET_KEY = "ikratom:lounge:sheet";
// Matches the site's touch chrome switch (MobileTabBar is lg:hidden).
const WIDE_QUERY = "(min-width: 1024px)";

const viewport = () => ({ vw: window.innerWidth, vh: window.innerHeight });
const save = (k: string, v: string | null) => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ }
};

/**
 * Where the Lounge sits, per device. Wide screens: a window moved by its
 * title bar and resized from its top-left corner, with a reset. Phones and
 * tablets: a bottom sheet with three heights. Geometry is in
 * src/lib/chat-window.ts; this hook does pointer events and storage.
 */
export function useChatWindow() {
  const [wide, setWide] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [sheet, setSheet] = useState<SheetHeight>("half");

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const onMq = () => setWide(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    const stored = parseRect(localStorage.getItem(RECT_KEY));
    if (stored) setRect(clampRect(stored, viewport()));
    const s = localStorage.getItem(SHEET_KEY);
    if (isSheetHeight(s)) setSheet(s);
    const onResize = () => setRect((r) => (r ? clampRect(r, viewport()) : r));
    window.addEventListener("resize", onResize);
    return () => { mq.removeEventListener("change", onMq); window.removeEventListener("resize", onResize); };
  }, []);

  /** Pointer-drag the title bar ("move") or the corner grip ("resize"). */
  const startDrag = useCallback((mode: "move" | "resize", e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (mode === "move" && (e.target as HTMLElement).closest("button, a, input, label")) return;
    e.preventDefault();
    const start = clampRect(rect ?? defaultRect(viewport()), viewport());
    const x0 = e.clientX;
    const y0 = e.clientY;
    let last = start;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      last = mode === "move" ? moveRect(start, dx, dy, viewport()) : resizeFromTopLeft(start, dx, dy, viewport());
      setRect(last);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      save(RECT_KEY, JSON.stringify(last));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [rect]);

  /** Arrow keys on the corner grip resize in 24px steps (keyboard users). */
  const nudgeSize = useCallback((dx: number, dy: number) => {
    const next = resizeFromTopLeft(clampRect(rect ?? defaultRect(viewport()), viewport()), dx, dy, viewport());
    setRect(next);
    save(RECT_KEY, JSON.stringify(next));
  }, [rect]);

  const reset = useCallback(() => { setRect(null); save(RECT_KEY, null); }, []);

  const setSheetHeight = useCallback((h: SheetHeight) => { setSheet(h); save(SHEET_KEY, h); }, []);

  const current = wide && typeof window !== "undefined" ? clampRect(rect ?? defaultRect(viewport()), viewport()) : null;
  return { wide, rect: current, moved: rect !== null, sheet, setSheetHeight, startDrag, nudgeSize, reset };
}

export type ChatWindow = ReturnType<typeof useChatWindow>;
