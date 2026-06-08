/**
 * 5calls-officials.mjs — free, non-grounded STATE + FEDERAL officials by location.
 *
 * The 5 Calls Representatives API (apidocs.5calls.org/representatives) returns a
 * person's US House rep, both US Senators, Governor, state Attorney General /
 * Secretary of State, and state legislators for a zip or "lat,lng" — with phone,
 * party, and photo — from a free token (no GPU, no paid tier, key-light fetch).
 *
 * SCOPE / WHY THIS IS NOT WIRED INTO THE LOCAL CHAIN:
 *   The daily officials grounding burn is for LOCAL officials (mayor, city
 *   council, county commissioners) in scripts/auto-fulfill-pending-local-reps.mjs
 *   / officials-slate.mjs. 5 Calls does NOT return city/county officials, so it
 *   cannot replace that grounded call (that slot is filled by Legistar first,
 *   then Gemini grounding). This module exists for the STATE/FEDERAL layer —
 *   the kratom-ban decision-makers (AG / Governor / SoS) and a non-grounded
 *   "find my reps" cross-check — where it adds value without touching grounding.
 *
 * DORMANT until FIVECALLS_TOKEN is set (request a free token via
 * apidocs.5calls.org/representatives). Without it, fetchFiveCallsReps() no-ops
 * with { ok:false, disabled:true } so callers can safely skip it.
 */

const TOKEN = process.env.FIVECALLS_TOKEN;

/** True when a 5 Calls token is configured (the client is live). */
export function fiveCallsEnabled() {
  return !!TOKEN;
}

/**
 * Bucket a 5 Calls `area` string into our level vocabulary.
 * 5 Calls areas seen in the wild: "US House", "US Senate", "Governor",
 * "StateUpper", "StateLower", "AttorneyGeneral", "SecretaryOfState".
 */
export function levelForArea(area) {
  const a = String(area || "").toLowerCase().replace(/[^a-z]/g, "");
  if (a.includes("ushouse") || a.includes("ussenate")) return "federal";
  if (a.includes("governor") || a.includes("attorneygeneral") || a.includes("secretaryofstate")) return "state_executive";
  if (a.includes("stateupper") || a.includes("statelower") || a.startsWith("state")) return "state";
  return "other";
}

/** Normalize a raw 5 Calls representative into our officials shape (pure; testable). */
export function normalizeFiveCallsRep(rep) {
  if (!rep || typeof rep !== "object") return null;
  return {
    full_name: rep.name ?? null,
    phone: rep.phone ?? null,
    website: rep.url ?? null,
    photo: rep.photoURL ?? null,
    party: rep.party ?? null,
    area: rep.area ?? null,
    level: levelForArea(rep.area),
    five_calls_id: rep.id ?? null,
  };
}

/**
 * Fetch state + federal officials for a location (zip code or "lat,lng").
 * Returns { ok, officials, raw } on success, { ok:false, disabled|reason } otherwise.
 * Never throws — callers can treat any non-ok result as "skip, fall through".
 */
export async function fetchFiveCallsReps(location, { signal } = {}) {
  if (!TOKEN) return { ok: false, disabled: true, reason: "FIVECALLS_TOKEN not set" };
  if (!location) return { ok: false, reason: "no location" };
  const url = `https://api.5calls.org/v1/representatives?location=${encodeURIComponent(location)}`;
  try {
    const r = await fetch(url, {
      headers: { "X-5Calls-Token": TOKEN, Accept: "application/json" },
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    if (!r.ok) return { ok: false, reason: `5calls ${r.status}: ${(await r.text()).slice(0, 150)}` };
    const data = await r.json();
    const reps = Array.isArray(data?.representatives) ? data.representatives : [];
    return { ok: true, officials: reps.map(normalizeFiveCallsRep).filter(Boolean), raw: reps.length };
  } catch (e) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
}
