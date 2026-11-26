/**
 * Where the Lounge chat sits on screen (B8). Per device, kept in the browser.
 *
 *   - Wide screens get a window the member can drag by its title bar and
 *     resize from its top-left corner (the window starts in the bottom-right
 *     corner, so that is the corner with room to grow). Reset puts it back.
 *   - Phones and tablets get a bottom sheet with three heights instead of free
 *     dragging, which is fiddly with a thumb and easy to lose off screen.
 *
 * Pure geometry, so it is unit-tested; the hook in
 * src/modules/chat/use-chat-window.ts does the pointer events and storage.
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type Viewport = { vw: number; vh: number };

export const EDGE = 8;
export const MIN_W = 288;
export const MIN_H = 320;
const DEFAULT_W = 352;
const DEFAULT_H = 512;
const DEFAULT_MARGIN = 20;

export function defaultRect(vp: Viewport): Rect {
  const w = Math.min(DEFAULT_W, vp.vw - 2 * EDGE);
  const h = Math.min(DEFAULT_H, Math.round(vp.vh * 0.7));
  return clampRect({ x: vp.vw - w - DEFAULT_MARGIN, y: vp.vh - h - DEFAULT_MARGIN, w, h }, vp);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

/** Keep the whole window on screen and no smaller than the minimum. */
export function clampRect(r: Rect, vp: Viewport): Rect {
  const w = clamp(r.w, Math.min(MIN_W, vp.vw - 2 * EDGE), vp.vw - 2 * EDGE);
  const h = clamp(r.h, Math.min(MIN_H, vp.vh - 2 * EDGE), vp.vh - 2 * EDGE);
  return {
    x: clamp(r.x, EDGE, vp.vw - w - EDGE),
    y: clamp(r.y, EDGE, vp.vh - h - EDGE),
    w: Math.round(w),
    h: Math.round(h),
  };
}

export function moveRect(r: Rect, dx: number, dy: number, vp: Viewport): Rect {
  return clampRect({ ...r, x: r.x + dx, y: r.y + dy }, vp);
}

/** Drag the top-left corner: the bottom-right corner stays where it is. */
export function resizeFromTopLeft(r: Rect, dx: number, dy: number, vp: Viewport): Rect {
  const right = r.x + r.w;
  const bottom = r.y + r.h;
  const x = clamp(r.x + dx, EDGE, right - Math.min(MIN_W, right - EDGE));
  const y = clamp(r.y + dy, EDGE, bottom - Math.min(MIN_H, bottom - EDGE));
  return clampRect({ x, y, w: right - x, h: bottom - y }, vp);
}

/** A stored rect, or null if it is missing or not four finite numbers. */
export function parseRect(raw: string | null): Rect | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const nums = [v.x, v.y, v.w, v.h];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return { x: v.x as number, y: v.y as number, w: v.w as number, h: v.h as number };
  } catch {
    return null;
  }
}

export const SHEET_HEIGHTS = ["short", "half", "tall"] as const;
export type SheetHeight = (typeof SHEET_HEIGHTS)[number];

export const SHEET_CSS: Record<SheetHeight, string> = {
  short: "40dvh",
  half: "60dvh",
  tall: "calc(100dvh - 4.5rem)",
};

export const SHEET_LABEL: Record<SheetHeight, string> = { short: "Short", half: "Half", tall: "Tall" };

export function isSheetHeight(x: unknown): x is SheetHeight {
  return typeof x === "string" && (SHEET_HEIGHTS as readonly string[]).includes(x);
}

/** Tap the handle: short → half → tall → short. */
export function cycleSheet(h: SheetHeight): SheetHeight {
  return SHEET_HEIGHTS[(SHEET_HEIGHTS.indexOf(h) + 1) % SHEET_HEIGHTS.length];
}

/** Swipe the handle: up grows, down shrinks, stopping at the ends. */
export function stepSheet(h: SheetHeight, dir: "up" | "down"): SheetHeight {
  const i = SHEET_HEIGHTS.indexOf(h) + (dir === "up" ? 1 : -1);
  return SHEET_HEIGHTS[Math.min(SHEET_HEIGHTS.length - 1, Math.max(0, i))];
}
