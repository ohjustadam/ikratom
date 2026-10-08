/**
 * email-select.mjs — who gets an email, and which hearings belong in a digest.
 * Pure functions, tested in tests/email-select.test.ts.
 */

/** Test/placeholder domains Resend rejects with a 422 (and that count against the day). */
const UNDELIVERABLE = /@(?:example\.(?:com|org|net)|[^@\s]+\.(?:test|invalid|local|localhost|example))$/i;

export function isDeliverable(email) {
  return typeof email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !UNDELIVERABLE.test(email);
}

/**
 * Hearings for one member's digest: ones confirmed since their last digest
 * (`from`), plus anything happening within 48 hours as a reminder. Listing
 * every upcoming hearing made the same hearing arrive every day for three
 * weeks, so "nothing new, no email" was never true (2026-10-05).
 */
export function digestHearings(meetings, from, nowMs = Date.now(), max = 5) {
  const fromMs = Date.parse(from);
  const soon = nowMs + 48 * 3600e3;
  return (meetings ?? [])
    .filter((m) => Date.parse(m.moderation_reviewed_at) > fromMs || Date.parse(m.meeting_at) < soon)
    .slice(0, max);
}
