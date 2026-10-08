/**
 * no-county-government.mjs — county-level "localities" that have NO elected
 * county government, so a county roster request can never be fulfilled.
 *
 * WHY (2026-10-08): seed-hotzone-officials kept filing county roster requests
 * for these places (Hampden/Worcester/Berkshire/Hampshire MA, three Connecticut
 * planning regions), and the batch churned `no-extract` on them forever. Every
 * one was rejected by hand. Their residents' local reps are the city/town
 * councils, which the municipal requests already cover.
 *
 * Sources (verified 2026-10-08):
 *   CT — county government abolished 1960. The 9 planning regions that became
 *        Census county-equivalents in 2022 are councils of governments: town
 *        chief executives, not an elected legislature.
 *   RI — no county government since 1846.
 *   MA — 8 of 14 counties dissolved 1997–2000 (state took over); only a
 *        sheriff and registers remain. Barnstable, Bristol, Dukes, Nantucket,
 *        Norfolk and Plymouth still have county governments and are NOT here.
 */

const NO_GOV_STATES = {
  CT: "Connecticut abolished county government in 1960; its planning regions are councils of town leaders, not elected legislatures",
  RI: "Rhode Island has had no county government since 1846",
};

const MA_DISSOLVED = new Set(["berkshire", "essex", "franklin", "hampden", "hampshire", "middlesex", "suffolk", "worcester"]);

/**
 * @param {string} state  2-letter code
 * @param {string} locality  canonical "Worcester County, MA" / "Capitol Planning Region, CT"
 * @returns {string|null} a ≤200-char reject reason, or null when the county has a government
 */
export function noCountyGovernment(state, locality) {
  const st = String(state ?? "").toUpperCase();
  const name = String(locality ?? "").replace(/,\s*[A-Z]{2}$/i, "").trim();
  let why = NO_GOV_STATES[st] ?? null;
  if (!why && st === "MA") {
    const bare = name.toLowerCase().replace(/\s+county$/, "").trim();
    if (MA_DISSOLVED.has(bare)) why = `Massachusetts dissolved ${name}'s government (only a sheriff and registers remain)`;
  }
  if (!why) return null;
  return `No county government: ${why}. Local reps are the city/town councils.`.slice(0, 200);
}
