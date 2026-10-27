/**
 * The send record (B9, migration 0276).
 *
 * When a member sends a campaign letter from their own mail program, the
 * compose window carries a hidden copy (BCC) to r-<nonce>@ikratom.org. A
 * Cloudflare Email Worker receives it and calls ingest_send_record(), which
 * stores the letter and marks the click's campaign_actions rows verified.
 * The nonce ties the copy to the click without putting an id or an email
 * address in the BCC line.
 */

export const SEND_RECORD_DOMAIN = "ikratom.org";

/** 16 chars of RFC 4648 base32, lowercase — must match the 0276 CHECK. */
export const RECORD_NONCE_RE = /^[a-z2-7]{16}$/;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function makeRecordNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

export function recordAddress(nonce: string): string {
  return `r-${nonce}@${SEND_RECORD_DOMAIN}`;
}

/** Appends the record address to a comma-separated BCC list. */
export function withRecordBcc(bccList: string, nonce: string | null): string {
  if (!nonce) return bccList;
  const addr = recordAddress(nonce);
  return bccList ? `${bccList},${addr}` : addr;
}

/** Server-side guard for a client-supplied nonce: valid, or null. */
export function cleanRecordNonce(value: unknown): string | null {
  return typeof value === "string" && RECORD_NONCE_RE.test(value) ? value : null;
}

/**
 * The record nonce a compose click carries, for a surface that logs ONE row per
 * letter however many delivery buttons are tried (ComposeModal, GroupComposeModal).
 * The first click mints it and logs it; every later click reuses that nonce,
 * because a fresh one would BCC an address no logged row holds and the ingest
 * would drop the copy. Null when the member opted out, or when the row that was
 * logged carries none (so a copy could never be matched to it).
 */
export function nonceForClick(s: { keepCopy: boolean; logged: boolean; loggedNonce: string | null }): string | null {
  if (!s.keepCopy) return null;
  return s.logged ? s.loggedNonce : makeRecordNonce();
}

/** The "Bcc: …" header line of a copied message, or "" without a nonce. */
export function bccCopyLine(nonce: string | null): string {
  return nonce ? `Bcc: ${recordAddress(nonce)}
` : "";
}
