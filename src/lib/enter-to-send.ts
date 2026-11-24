/**
 * When Enter sends a chat message, and when it starts a new line.
 *
 * A keyboard sends on Enter, and Shift+Enter adds a line. A phone keyboard has
 * no Shift+Enter, so on a phone Enter adds a line and the Send button sends
 * (member report, 2026-11-23: a phone could never write a second line).
 * Enter never sends while an IME or predictive-text word is still composing.
 */
type EnterEvent = { key: string; shiftKey: boolean; nativeEvent?: { isComposing?: boolean } };

/** A touch screen with no mouse or trackpad attached: a phone, or a tablet on its own. */
export function isTouchOnly(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches;
}

export function isSendKey(e: EnterEvent, touchOnly: boolean = isTouchOnly()): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  if (e.nativeEvent?.isComposing) return false;
  return !touchOnly;
}
