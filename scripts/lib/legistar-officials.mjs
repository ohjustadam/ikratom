/**
 * Non-grounded local-officials source: the Legistar (Granicus) webapi.
 *
 * WHY: finding local council members was 100% dependent on Gemini
 * grounded search — free-tier-capped at ~6-10 successful calls/day, so
 * member rep requests routinely sat unfulfilled (see private/
 * STATE_MISSION_CONTROL_PLAN + V2_KICKOFF). Every city/county that runs
 * its agendas on Legistar exposes a PUBLIC, key-less, uncapped JSON API
 * with the authoritative current roster — the city's OWN system. For
 * those localities we never need to spend a grounded call.
 *
 *   Base:  https://webapi.legistar.com/v1/{client}
 *   /bodies          → the legislative bodies (find the council/board)
 *   /officeRecords   → person↔body memberships with term start/end
 *   /persons/{id}    → contact info (email/phone/website)
 *
 * This is the FIRST attempt in the auto-fulfill flow; Gemini grounding
 * is the fallback for localities not on Legistar. Free, forever.
 *
 * Quality note: Legistar emails/terms come straight from the clerk's
 * system (authoritative). Phone/website vary by tenant. We return what's
 * there and leave the rest null — never fabricate.
 */

const WEBAPI = "https://webapi.legistar.com/v1";

// A handful of tenants whose Legistar webapi CLIENT code differs from the
// calendar subdomain in legistar-tenants.mjs. Everything else: client ==
// subdomain. Unknown/wrong codes just 404 → caller skips gracefully.
const CLIENT_OVERRIDES = {
  "council.nyc.gov": "nyc",
  "cookcountyil": "cookcounty",
  "metro": "oregonmetro",
  "kansascity": "kansascity", // calendar is on kcmo.org, webapi still kansascity
};

export function webapiClientFor(tenant) {
  return CLIENT_OVERRIDES[tenant.subdomain] ?? tenant.subdomain;
}

async function getJson(url, timeoutMs = 20_000) {
  const res = await fetch(encodeURI(url), {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "iKratom Civic Data (contact@ikratom.org)" },
  });
  if (!res.ok) throw new Error(`legistar ${res.status} for ${url.replace(WEBAPI, "")}`);
  return res.json();
}

// Pick the body that represents the primary elected chamber. We match the
// tenant's known body name first (e.g. "Board of Supervisors"), then fall
// back to type/name keywords.
// Bodies that are MEETINGS/COMMITTEES, not the elected membership chamber.
// Legistar tenants create many of these ("City Council A Session",
// "Council Briefing", "Rules Committee"); they'd otherwise match a naive
// "council" keyword and return the wrong/empty roster.
const NON_MEMBERSHIP = /\b(session|briefing|committee|subcommittee|special|closed|agenda|hearing|workshop|study|joint|ad hoc|task force|select|meeting|quorum|youth|young adult|advisory|ethics|redistricting)\b/i;

function pickCouncilBody(bodies, bodyHint) {
  const active = bodies.filter((b) => b.BodyActiveFlag === 1 || b.BodyActiveFlag === true);
  const norm = (s) => (s ?? "").toLowerCase();
  const hint = norm(bodyHint);
  // 1. exact match on the tenant's declared body name/type (most reliable)
  if (hint) {
    const exact = active.find((b) => norm(b.BodyName) === hint || norm(b.BodyTypeName) === hint);
    if (exact) return exact;
  }
  // 2. keyword match, but skip meeting/committee bodies.
  const KW = ["city council", "board of supervisors", "board of county commissioners",
    "board of commissioners", "county council", "municipal council",
    "city commission", "metro council", "board of aldermen", "common council", "council"];
  const eligible = active.filter((b) => !NON_MEMBERSHIP.test(b.BodyName));
  if (hint) {
    const byHint = eligible.find((b) => norm(b.BodyName).includes(hint));
    if (byHint) return byHint;
  }
  for (const kw of KW) {
    const hit = eligible.find((b) => norm(b.BodyName).includes(kw) || norm(b.BodyTypeName).includes(kw));
    if (hit) return hit;
  }
  return null;
}

function mapRole({ level, title }) {
  const t = (title ?? "").toLowerCase();
  if (level === "county") {
    if (/executive|judge|mayor/.test(t)) return "county_executive";
    return "county_commissioner";
  }
  if (/mayor/.test(t)) return "mayor";
  return "city_council";
}

/**
 * Fetch the current roster for one Legistar tenant.
 *
 * @param {object} opts
 * @param {string} opts.client   webapi client code (use webapiClientFor)
 * @param {string} opts.bodyHint tenant's declared body name (optional)
 * @param {"municipal"|"county"} opts.level
 * @param {string} opts.subdomain calendar subdomain (for person-page URLs)
 * @param {string} opts.todayIso  ISO date string for the term filter
 * @returns {Promise<{ok:true, officials:Array, body:string} | {error:string}>}
 */
export async function fetchLegistarOfficials({ client, bodyHint, level, subdomain, todayIso }) {
  let bodies;
  try {
    bodies = await getJson(`${WEBAPI}/${client}/bodies`);
  } catch (e) {
    return { error: e.message };
  }
  if (!Array.isArray(bodies)) return { error: "bodies: unexpected shape" };

  const body = pickCouncilBody(bodies, bodyHint);
  if (!body) return { error: `no council/board body found among ${bodies.length} bodies` };

  const today = (todayIso ?? new Date().toISOString()).slice(0, 19);
  let records;
  try {
    // A sitting member is one whose term hasn't ended. Many tenants set a
    // future EndDate (Seattle/Chicago); others leave it NULL for current
    // members (San Francisco). Include both, then drop not-yet-started
    // (future StartDate) records client-side.
    records = await getJson(
      `${WEBAPI}/${client}/officeRecords?$filter=OfficeRecordBodyId eq ${body.BodyId} and (OfficeRecordEndDate gt datetime'${today}' or OfficeRecordEndDate eq null)`,
    );
  } catch (e) {
    return { error: `officeRecords: ${e.message}` };
  }
  if (Array.isArray(records)) {
    const todayMs = new Date(today).getTime();
    records = records.filter((r) => !r.OfficeRecordStartDate || new Date(r.OfficeRecordStartDate).getTime() <= todayMs);
  }
  if (!Array.isArray(records) || records.length === 0) {
    return { error: `no current members for body "${body.BodyName}"` };
  }

  // De-dupe by person (a member can hold multiple overlapping records);
  // keep the one with the latest end date.
  const byPerson = new Map();
  for (const r of records) {
    const prev = byPerson.get(r.OfficeRecordPersonId);
    if (!prev || new Date(r.OfficeRecordEndDate) > new Date(prev.OfficeRecordEndDate)) {
      byPerson.set(r.OfficeRecordPersonId, r);
    }
  }

  const officials = [];
  for (const r of byPerson.values()) {
    // Join the person record for phone/website (email is often on the
    // officeRecord already). Best-effort — email-only is still useful.
    let person = {};
    try {
      person = await getJson(`${WEBAPI}/${client}/persons/${r.OfficeRecordPersonId}`);
    } catch { /* contact join is best-effort */ }

    const email = r.OfficeRecordEmail || person.PersonEmail || null;
    const phone = person.PersonPhone || null;
    const website = person.PersonWWW
      || `https://${subdomain}.legistar.com/PersonDetail.aspx?ID=${r.OfficeRecordPersonId}`;
    const title = r.OfficeRecordTitle || (level === "county" ? "Commissioner" : "Council Member");

    officials.push({
      full_name: r.OfficeRecordFullName?.trim() || `${r.OfficeRecordFirstName} ${r.OfficeRecordLastName}`.trim(),
      role: mapRole({ level, title }),
      title,
      district: null,
      email: email && /@/.test(email) ? email : null,
      phone: phone && phone.trim() ? phone.trim() : null,
      website,
      party: null,
      term_end_date: r.OfficeRecordEndDate ? r.OfficeRecordEndDate.slice(0, 10) : null,
      source_url: `https://${subdomain}.legistar.com/People.aspx`,
      source_note: `Legistar (official ${body.BodyName} roster), retrieved ${today.slice(0, 10)}`,
    });
  }

  return { ok: true, officials, body: body.BodyName };
}

/**
 * Resolve a (state, locality) to a Legistar tenant from LEGISTAR_TENANTS.
 * Locality compare is loose: strip ", ST" and case/space-normalize.
 */
export function resolveTenant(tenants, state, locality) {
  const norm = (s) => (s ?? "").toLowerCase().replace(/,\s*[a-z]{2}$/i, "").replace(/\s+/g, " ").trim();
  const wantState = (state ?? "").toUpperCase();
  const wantLoc = norm(locality);
  return tenants.find((t) => t.state === wantState && norm(t.locality) === wantLoc) ?? null;
}
