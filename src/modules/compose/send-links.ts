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
