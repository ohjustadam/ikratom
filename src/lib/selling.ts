/**
 * iKratom is for advocacy, never selling (owner, 2026-11-03): "so we don't
 * become an advertisers' paradise." Every member-written surface runs this
 * before saving: forum threads and replies, the Lounge, group chat, wall posts
 * and comments, profile bio and story, photo captions and kratom stories.
 * Direct messages are end-to-end encrypted, so the server never sees them;
 * reports cover those.
 *
 * Vendors are welcome as advocates: "my shop will close if HB 12 passes" and
 * "the bill bans sale to minors" must pass. So this matches sales PITCHES
 * (codes, prices per unit, "DM me to order", shop plugs), not the words
 * "shop", "vendor" or "sale". Precision over recall: a report still catches
 * the rest. Groups' names and About text have a stricter screen of their own
 * (coalitions/vendor-screen.ts, migration 0309).
 */

const PITCHES: RegExp[] = [
  // Codes and discounts
  /\b(?:coupons?|promo ?codes?|discount ?codes?|coupon ?codes?)\b/i,
  /\buse (?:my |our |the )?code\b/i,
  // Lookahead, not \b: "-" is a word boundary, so \b would refuse "0% off-topic" (#1107).
  /\b\d{1,2} ?% off(?![\w-])/i,
  /\bfree shipping\b|\bsame[- ]day shipping\b|\bwe ship (?:to|nationwide|anywhere|fast|free|same)\b/i,
  // Calls to buy
  /\b(?:buy|order|shop) now\b/i,
  /\border (?:from|through|with) (?:me|us)\b/i,
  /\b(?:dm|pm|message|text|hmu|hit me up)(?: me)? (?:for|to) (?:prices?|pricing|orders?|order|buy|purchase|samples?|a sample|menus?|the menu|deals?)\b/i,
  /\blink in (?:my |our )?bio\b/i,
  // Shop plugs
  /\b(?:visit|check out|shop at|stop by|come by|swing by) (?:my|our) (?:shop|store|online store|booth|products?|menu|strains?)\b/i,
  /\b(?:my|our) (?:shop|store) (?:sells|carries|stocks|has (?:a )?(?:sale|deal|special)|is (?:running|having) (?:a )?(?:sale|deal|special))\b/i,
  /\b(?:back in stock|in stock now|now in stock|just restocked|now carrying)\b/i,
  // Price lists and per-unit prices
  /\b(?:price ?list|wholesale (?:prices?|pricing|rates|inquir\w*|orders?|accounts?))\b/i,
  /\$\s?\d+(?:\.\d{2})?\s?(?:\/|per |a |for (?:a |an |one )?)(?:kg|kilo(?:gram)?s?|oz|ounces?|g|grams?|lbs?|pounds?|bags?|caps(?:ules)?|bottles?|shots?)\b/i,
];

export const SELLING_MESSAGE =
  "iKratom is for advocacy, not selling. Take out the sales wording (prices, codes, \"DM me to order\", shop plugs) and try again.";

/** True when the text reads as a sales pitch. */
export function looksLikeSelling(text: string | null | undefined): boolean {
  const t = String(text ?? "");
  return t.length > 0 && PITCHES.some((re) => re.test(t));
}

/** The member-facing refusal, or null when the text is fine. */
export function sellingIssue(text: string | null | undefined): string | null {
  return looksLikeSelling(text) ? SELLING_MESSAGE : null;
}
