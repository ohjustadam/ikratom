// Helpers for sync-federal-bills.mjs, kept apart so tests can import them.

// LegiScan's US prefixes, mapped to the ones congress.gov and our rows use.
const PREFIX = { HB: "HR", SB: "S", HR: "HRES", SR: "SRES", HJR: "HJRES", SJR: "SJRES", HCR: "HCONRES", SCR: "SCONRES" };

/** "HB8000" → "HR 8000". Null when the prefix is unknown. */
export function federalBillNumber(raw) {
  const m = /^([A-Z]+)\s*(\d+)$/.exec(String(raw ?? "").trim().toUpperCase());
  return m && PREFIX[m[1]] ? `${PREFIX[m[1]]} ${m[2]}` : null;
}

/** The Congress sitting in a given year (the 119th is 2025-2026). */
export function congressFor(year) {
  return Math.floor((year - 1789) / 2) + 1;
}
