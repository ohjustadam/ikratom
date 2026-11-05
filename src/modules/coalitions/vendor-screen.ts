/**
 * Groups are for advocacy, not selling (owner, 2026-11-03).
 *
 * r/kratom's moderators won't promote anything tied to a group that promotes
 * vendors, and public groups are listed to visitors on /coalitions. Nothing
 * screened a group's name or About text, so this does, at create, edit and
 * going public. Migration 0309 holds the same rule in the database, because
 * the coalitions UPDATE policy lets an owner write through the API directly.
 *
 * Vendors may belong to groups like anyone else; "unite consumers, advocates
 * and vendors" is fine. Selling is not: sales wording, links to anything but
 * government or school sites, and contact details.
 */
import { detectModerationSignals } from "@/lib/moderation";

/** Keep in step with public.coalition_vendor_guard() in migration 0309. */
export const SELLING_RE =
  /\b(coupons?|promo codes?|discount codes?|use (?:my |our )?code|free shipping|for sale|buy now|order now|shop now|wholesale|price list|\d{1,2} ?% off(?![\w-]))\b/i;

const URL_RE = /https?:\/\/([a-z0-9.-]+)/gi;
const ALLOWED_HOST_RE = /(\.gov|\.edu|(^|\.)ikratom\.org)$/i;

/** Why this group name or About text can't be saved, or null when it's fine. */
export function groupTextIssue(text: string): string | null {
  const t = String(text ?? "");
  if (SELLING_RE.test(t)) {
    return "Groups are for advocacy, not selling. Take out the sales wording and try again.";
  }
  for (const m of t.matchAll(URL_RE)) {
    if (!ALLOWED_HOST_RE.test(m[1])) {
      return "A group's name and About can only link to government or school sites (.gov, .edu). Share other links in the group's Resources.";
    }
  }
  const s = detectModerationSignals(t);
  if (s.bareDomains.some((d) => !ALLOWED_HOST_RE.test(d))) {
    return "A group's name and About can only link to government or school sites (.gov, .edu). Share other links in the group's Resources.";
  }
  if (s.phones.length || s.emails.length || s.cryptoWallets.length) {
    return "Keep phone numbers, email addresses and payment details out of a group's name and About. Members can reach organizers inside the group.";
  }
  return null;
}
