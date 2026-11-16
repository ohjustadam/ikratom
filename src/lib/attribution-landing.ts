/**
 * Which attribution params a page load should report to `/api/attribution`.
 * Pure, so the rule can be tested without a browser.
 *
 * WHY (2026-11-10): `?state=XX` is two things on this site. On a shared or
 * embedded link it is a landing signal (`landing_state`, which routes a new
 * member to a matching campaign). On our own pages it is just a filter: every
 * legislator page links back to `/legislators?state=XX`, and the bills, news
 * and campaign lists use it too. AttributionCapture could not tell them apart,
 * so every full page load of a filtered list woke the paid server function,
 * ~300 times a day, mostly bots walking the directory. It also let a member's
 * own browsing overwrite the state they actually arrived with.
 *
 * The rule: a state-only URL reached from one of our own pages is browsing, not
 * a landing, so it reports nothing. Invites (`?via=`) and partner embeds
 * (`?ref=embed&host=`) always report, exactly as before. So does `?state=`
 * arriving from anywhere else, including an empty referrer (apps, typed URLs,
 * `noreferrer` links).
 */

export type AttributionParams = {
  ref: string | null;
  host: string | null;
  state: string | null;
  via: string | null;
};

function sameOrigin(referrer: string, origin: string): boolean {
  if (!referrer) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}

export function attributionToCapture(
  search: string,
  referrer: string,
  origin: string,
): AttributionParams | null {
  const p = new URLSearchParams(search);
  const params: AttributionParams = {
    ref: p.get("ref"),
    host: p.get("host"),
    state: p.get("state"),
    via: p.get("via"),
  };
  const embed = params.ref === "embed" && !!params.host;
  if (!params.via && !params.state && !embed) return null;
  if (!params.via && !embed && sameOrigin(referrer, origin)) return null;
  return params;
}
