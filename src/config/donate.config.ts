/**
 * Donation configuration — the ONE place to change how the platform asks for
 * money. The bottom strip and /donate both read from here, so a wording or
 * handle change is a single edit rather than a hunt through JSX.
 *
 * OWNER: you can edit the strip WITHOUT touching this file. Set the
 * `donate.strip` key at /admin/content/donate.strip and it overrides
 * `stripFallback` below; set it to an empty value to HIDE the strip entirely.
 * This file is the default that ships with the code, so the strip still says
 * something sensible if the DB row is missing.
 *
 * PRIVACY NOTE (deliberate): there is no personal email here. A raw address on
 * a public page gets scraped for spam and permanently ties the owner's legal
 * identity to a politically contentious project. PayPal.me gives the same
 * one-click donation with none of that exposure, and `contactEmail` is the
 * project role address, not a personal one.
 */

export const donateConfig = {
  /** Cash App cashtag — the handle only; the URL is built below. */
  cashtag: "$ohjustadam",
  cashAppUrl: "https://cash.app/$ohjustadam",

  /**
   * PayPal — paste EITHER a bare paypal.me handle OR a full PayPal URL.
   * Business accounts often can't use PayPal.Me, so a full URL is supported so
   * whichever link PayPal actually gives you drops straight in with no code
   * change. Leave EMPTY and the PayPal option auto-hides rather than rendering
   * a dead link.
   *
   * Working formats, best first:
   *   "https://www.paypal.com/donate/?hosted_button_id=XXXXXXXX"
   *      ← BEST for a business account. PayPal dashboard → Pay & Get Paid →
   *        Donations → create button. Exposes no email address.
   *   "yourhandle"  → becomes https://paypal.me/yourhandle
   *   "https://www.paypal.com/donate/?business=you@example.com"
   *      ← works instantly, but puts the address in a public URL where
   *        scrapers will find it. Use only as a stopgap.
   */
  // STOPGAP (2026-07-26): PayPal.Me is unavailable on the owner's business
  // account and donations were needed the same night, so this uses the
  // `?business=` donate URL, which works instantly with no setup.
  // ⚠ TRADE-OFF: the address is visible in the link. Swap to a hosted button
  // (PayPal → Pay & Get Paid → Donations → create button) when convenient —
  // it exposes no address, and it is a one-line change here, nothing else.
  paypal: "https://www.paypal.com/donate/?business=deltaday2021@gmail.com&item_name=Support+iKratom&currency_code=USD" as string,
  get paypalUrl(): string {
    if (!this.paypal) return "";
    return this.paypal.startsWith("http") ? this.paypal : `https://paypal.me/${this.paypal}`;
  },
  /** Label under the PayPal button — the URL itself is often unreadable. */
  paypalLabel: "Donate with PayPal",

  /** For donors who want another method (check, crypto, recurring, in-kind). */
  contactEmail: "support@ikratom.org",

  /**
   * Default strip text. Overridden by the `donate.strip` editable-content key.
   * Kept short because it renders on every page at 11px — the /donate page is
   * where the full story lives.
   */
  stripFallback: "💚 We're back — and we need your help to stay here. iKratom runs on donations alone.",

  /** Button label on the strip. */
  ctaLabel: "Support iKratom",
} as const;
