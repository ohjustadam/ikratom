/**
 * Is this an address a letter can be sent to?
 *
 * `legislators.email` holds three kinds of value: a real address, a
 * contact-form URL (offices with no public inbox), and, from some county
 * directories, the link text itself ("Email Jim Hamsher"). Checking only
 * `startsWith("http")` let "hhttps://fine.house.gov/..." through to Gmail on
 * 2026-11-03 ("Invalid To header"). Every send path asks this instead.
 */
const MAILBOX_RE = /^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i;

export function isMailbox(email: string | null | undefined): email is string {
  return !!email && MAILBOX_RE.test(email.trim());
}
