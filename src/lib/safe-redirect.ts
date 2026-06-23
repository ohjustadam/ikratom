/**
 * Open-redirect guard. Returns `raw` only if it's a safe SAME-ORIGIN relative
 * path, else null. Rejects protocol-relative ("//"), any backslash (the URL
 * parser folds "\" → "/", turning "/\evil.com" into an external host), and any
 * whitespace/control char (a stripped tab/newline can turn "/<tab>//evil.com"
 * into an external redirect). Mirrors the auth-callback fix; use everywhere a
 * `?redirect=`/`?next=` value feeds a redirect() or window.location.
 */
export function safeRelativePath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.includes("\\")) return null;
  if (/[\s\0]/.test(raw)) return null;
  return raw;
}
