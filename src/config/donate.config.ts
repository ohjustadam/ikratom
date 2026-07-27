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
   * PayPal.me handle. Create at https://paypal.me/setup — it does NOT have to
   * contain a real name. Leave EMPTY and the PayPal option auto-hides from the
   * strip and /donate rather than rendering a dead link.
   */
  paypalHandle: "",
  get paypalUrl() {
    return this.paypalHandle ? `https://paypal.me/${this.paypalHandle}` : "";
  },

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
