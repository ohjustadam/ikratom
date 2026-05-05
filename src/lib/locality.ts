/**
 * Canonical locality formatting.
 * Used at every entry point that writes to legislators.locality so we never
 * end up with "oklahoma city, OK" vs "Oklahoma City, OK" duplicates again.
 */

export function normalizeLocality(input: string | null | undefined, defaultState?: string): string | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;

  // Split on the LAST comma (so "Saint Paul, MN" works, "St. Louis, MO" works)
  const lastComma = trimmed.lastIndexOf(",");
  let cityPart: string;
  let statePart: string;
  if (lastComma >= 0) {
    cityPart = trimmed.slice(0, lastComma).trim();
    statePart = trimmed.slice(lastComma + 1).trim();
  } else {
    cityPart = trimmed;
    statePart = (defaultState ?? "").trim();
  }

  // Title-case each word in the city portion. Handle prefixes like "St." and "Mc".
  const titledCity = cityPart
    .split(/\s+/)
    .map((word) => {
      if (!word) return word;
      // McX, MacX — capitalize the X too
      if (/^mc[a-z]/i.test(word)) return "Mc" + word.charAt(2).toUpperCase() + word.slice(3).toLowerCase();
      if (/^mac[a-z]/i.test(word) && word.length > 4) return "Mac" + word.charAt(3).toUpperCase() + word.slice(4).toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");

  // Uppercase state code
  const upperState = statePart.toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(upperState)) {
    // No valid state suffix — return city alone
    return titledCity;
  }
  return `${titledCity}, ${upperState}`;
}
