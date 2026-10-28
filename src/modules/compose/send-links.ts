/**
 * Compose-window URL builders shared by every email surface.
 *
 * mailto: is built with encodeURIComponent (%20 for spaces) per RFC 6068 —
 * NOT URLSearchParams, whose '+' space-encoding renders as literal plus
 * signs in some mail clients (the OperationResponseClient bug).
 * Gmail/Outlook web composes are HTML form-style query strings, where
 * URLSearchParams is correct.
 */

export function buildMailtoUrl(to: string, subject: string, body: string, bcc?: string): string {
  // Encode the recipient too — synced/admin email data could contain spaces or
  // extra `?`/`&` that would otherwise inject mailto header fields.
  const parts = [`subject=${encodeURIComponent(subject)}`];
  if (bcc) parts.push(`bcc=${encodeURIComponent(bcc)}`);
  parts.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${encodeURIComponent(to)}?${parts.join("&")}`;
}

/**
 * Rough guard against the ~2000-char mailto ceiling that Chromium / Windows
 * ShellExecute silently drop (the "Open in email does nothing" class of bug).
 * Callers show a copy-first fallback when this returns false.
 */
export function mailtoWithinLimit(url: string): boolean {
  return url.length <= 1900;
}

/**
 * Returns the URL only if it's a safe http(s) link, else null. Guards against
 * javascript:/data: URLs sneaking out of a synced/admin-editable
 * legislators.website into an href (script execution / phishing).
 */
export function httpUrlOrNull(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function buildGmailComposeUrl(to: string, subject: string, body: string, bcc?: string): string {
  const params = new URLSearchParams();
  params.set("view", "cm");
  params.set("fs", "1");
  params.set("to", to);
  if (bcc) params.set("bcc", bcc);
  params.set("su", subject);
  params.set("body", body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * Gmail's mobile website ignores compose links and just opens the inbox (Paul,
 * 2026-10-28, Android). On Android, hand the same letter to the Gmail APP via
 * an intent; if the app isn't installed, Chrome follows the fallback to the web
 * compose URL as before. Build it at click time only (it reads the user agent),
 * so the server render and hydration still agree.
 */
export function gmailAndroidIntent(webComposeUrl: string): string | null {
  let u: URL;
  try { u = new URL(webComposeUrl); } catch { return null; }
  if (u.hostname !== "mail.google.com" || u.searchParams.get("view") !== "cm") return null;
  const parts = [`subject=${encodeURIComponent(u.searchParams.get("su") ?? "")}`];
  const bcc = u.searchParams.get("bcc");
  if (bcc) parts.push(`bcc=${encodeURIComponent(bcc)}`);
  parts.push(`body=${encodeURIComponent(u.searchParams.get("body") ?? "")}`);
  const to = encodeURIComponent(u.searchParams.get("to") ?? "").replace(/%40/g, "@").replace(/%2C/gi, ",");
  return `intent:${to}?${parts.join("&")}#Intent;scheme=mailto;package=com.google.android.gm;S.browser_fallback_url=${encodeURIComponent(webComposeUrl)};end`;
}

/**
 * Call from an "Open in Gmail" click handler, after the href is final. On
 * Android it swaps the web compose URL for the Gmail-app intent and drops
 * target=_blank (an intent opened in a new tab leaves a blank tab behind).
 */
export function preferGmailAppOnAndroid(anchor: HTMLAnchorElement): void {
  if (typeof navigator === "undefined" || !/Android/i.test(navigator.userAgent)) return;
  const intent = gmailAndroidIntent(anchor.href);
  if (!intent) return;
  anchor.href = intent;
  anchor.removeAttribute("target");
}

export function buildOutlookComposeUrl(to: string, subject: string, body: string, bcc?: string): string {
  const params = new URLSearchParams();
  params.set("to", to);
  if (bcc) params.set("bcc", bcc);
  params.set("subject", subject);
  params.set("body", body);
  return `https://outlook.office.com/mail/deeplink/compose?${params.toString()}`;
}

/** legislators.email doubles as a webform URL (sync-congress convention). */
export function isContactFormUrl(email: string | null | undefined): boolean {
  return !!email && /^https?:\/\//i.test(email);
}
