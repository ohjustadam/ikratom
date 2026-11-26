"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { cycleSheet, SHEET_CSS, SHEET_LABEL, stepSheet } from "@/lib/chat-window";
import type { ChatWindow } from "./use-chat-window";

/**
 * The Lounge's outer box. Wide screens: a floating window with a corner grip
 * (top-left) for resizing; the title bar inside is the drag handle. Phones and
 * tablets: a bottom sheet with a big handle that switches between three
 * heights (tap to cycle, or swipe up / down).
 */
export function ChatFrame({
  win,
  vars,
  fontClass,
  children,
}: {
  win: ChatWindow;
  vars: Record<string, string>;
  fontClass: string;
  children: ReactNode;
}) {
  const box = win.wide && win.rect
    ? { left: win.rect.x, top: win.rect.y, width: win.rect.w, height: win.rect.h }
    : { height: SHEET_CSS[win.sheet] };
  const shape = win.wide
    ? "rounded-xl"
    : "inset-x-0 bottom-0 rounded-t-2xl border-b-0 pb-[env(safe-area-inset-bottom)]";
  return (
    <div
      role="dialog"
      aria-label="Lounge live chat"
      style={{ ...vars, ...box } as CSSProperties}
      className={`fixed z-50 flex flex-col overflow-hidden border border-[var(--lc-border)] bg-[var(--lc-bg)] text-[var(--lc-text)] shadow-2xl shadow-black/60 ${shape} ${fontClass}`}
    >
      {win.wide ? <ResizeGrip win={win} /> : <SheetHandle win={win} />}
      {children}
    </div>
  );
}

function ResizeGrip({ win }: { win: ChatWindow }) {
  const step = 24;
  return (
    <button
      type="button"
      aria-label="Resize chat. Drag, or use the arrow keys."
      title="Drag to resize"
      onPointerDown={(e) => win.startDrag("resize", e)}
      onKeyDown={(e) => {
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d) { e.preventDefault(); win.nudgeSize(d[0], d[1]); }
      }}
      className="absolute left-0 top-0 z-10 flex h-7 w-7 items-center justify-center cursor-nwse-resize touch-none rounded-br-md border-b border-r border-[var(--lc-border)] bg-[var(--lc-surface)] text-xs leading-none text-[var(--lc-muted)] hover:text-[var(--lc-text)] focus-visible:outline-2 focus-visible:outline-[var(--lc-accent)]"
    >
      <span aria-hidden>⤡</span>
    </button>
  );
}

function SheetHandle({ win }: { win: ChatWindow }) {
  const y0 = useRef<number | null>(null);
  const swiped = useRef(false);
  return (
    <button
      type="button"
      aria-label={`Chat height: ${SHEET_LABEL[win.sheet]}. Tap to change.`}
      onPointerDown={(e) => { y0.current = e.clientY; swiped.current = false; }}
      onPointerUp={(e) => {
        const dy = y0.current === null ? 0 : e.clientY - y0.current;
        y0.current = null;
        if (Math.abs(dy) <= 30) return;
        swiped.current = true;
        win.setSheetHeight(stepSheet(win.sheet, dy < 0 ? "up" : "down"));
      }}
      // A tap, or Enter / Space from a keyboard: short → half → tall.
      onClick={() => {
        if (swiped.current) { swiped.current = false; return; }
        win.setSheetHeight(cycleSheet(win.sheet));
      }}
      className="flex w-full shrink-0 touch-none flex-col items-center gap-1 bg-[var(--lc-surface)] pb-1.5 pt-2"
    >
      <span aria-hidden className="h-1.5 w-12 rounded-full bg-[var(--lc-muted)]" />
      <span className="text-[11px] text-[var(--lc-muted)]">{SHEET_LABEL[win.sheet]} · tap or swipe to resize</span>
    </button>
  );
}
