/**
 * Who cast a roll-call vote. LegiScan's getRollCall lists each vote as a
 * people_id with no name, so a vote is only readable once that id is tied to
 * a person. getSessionPeople gives the name, chamber and district for every
 * id in a session; these helpers tie that person to our legislators row.
 *
 * Matching is by NAME, never by seat alone: a district match would hand a
 * departed member's votes to whoever holds the seat now. A match must also be
 * unique, and a legislator already tied to a different people_id is never
 * re-tied. Ambiguous people are left unlinked but still get their name.
 */

const TITLES = /\b(rep|representative|sen|senator|del|delegate|asm|assemblymember|assemblyman|assemblywoman|dr|mr|mrs|ms|hon|honorable)\b\.?/g;
const SUFFIXES = /\b(jr|sr|ii|iii|iv)\b\.?/g;

/** "Smith, Jane Q." and "Sen. Jane Q. Smith Jr." both become "jane q smith". */
export function normName(s) {
  if (!s) return "";
  let t = String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (t.includes(",")) {
    const [last, rest] = t.split(",", 2);
    t = `${rest} ${last}`;
  }
  return t.replace(TITLES, " ").replace(SUFFIXES, " ")
    .replace(/[^a-z\s'-]/g, " ").replace(/['-]/g, "")
    .replace(/\s+/g, " ").trim();
}

/** Every reasonable way to write a name: as given, without middle initials, first + last. */
export function nameKeys(...names) {
  const keys = new Set();
  for (const raw of names) {
    const n = normName(raw);
    if (!n) continue;
    const parts = n.split(" ");
    keys.add(n);
    const noInitials = parts.filter((p, i) => i === 0 || i === parts.length - 1 || p.length > 1).join(" ");
    keys.add(noInitials);
    if (parts.length > 2) keys.add(`${parts[0]} ${parts[parts.length - 1]}`);
  }
  keys.delete("");
  return keys;
}

export function lastName(s) {
  const parts = normName(s).split(" ");
  return parts[parts.length - 1] ?? "";
}

export function districtDigits(s) {
  return String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

/** LegiScan role "Sen"/"Rep", or our role/chamber text, as senate | house | "". */
export function chamberOf(s) {
  const t = String(s ?? "").toLowerCase();
  if (/\bsen|upper|senate/.test(t)) return "senate";
  if (/\brep|\bdel|\basm|assembly|house|lower|delegate/.test(t)) return "house";
  return "";
}

/** A getSessionPeople entry as a display name. */
export function personName(p) {
  if (!p) return "";
  const n = String(p.name ?? "").trim();
  if (n) return n;
  return [p.first_name, p.middle_name, p.last_name, p.suffix].filter(Boolean).join(" ").trim();
}

function personKeys(p) {
  return nameKeys(
    personName(p),
    p.first_name && p.last_name ? `${p.first_name} ${p.last_name}` : "",
    p.nickname && p.last_name ? `${p.nickname} ${p.last_name}` : "",
  );
}

/** Whether a LegiScan person and one of our names can be the same person. */
export function sameName(person, fullName) {
  const keys = personKeys(person);
  if ([...nameKeys(fullName)].some((k) => keys.has(k))) return true;
  const last = person?.last_name ? normName(person.last_name).split(" ").pop() : lastName(personName(person));
  return Boolean(last) && lastName(fullName) === last;
}

/**
 * The one legislator this LegiScan person is, or null.
 * `candidates`: the state's state_house + state_senate legislators rows
 * ({ id, full_name, district, role, legiscan_people_id }).
 */
export function matchPerson(person, candidates) {
  const pid = person?.people_id;
  const chamber = chamberOf(person?.role);
  const pool = (candidates ?? []).filter((c) =>
    (c.legiscan_people_id == null || c.legiscan_people_id === pid) &&
    (!chamber || chamberOf(c.role) === chamber));
  const already = pool.filter((c) => c.legiscan_people_id === pid && sameName(person, c.full_name));
  if (already.length === 1) return already[0].id;

  const keys = personKeys(person);
  const byName = pool.filter((c) => [...nameKeys(c.full_name)].some((k) => keys.has(k)));
  if (byName.length === 1) return byName[0].id;

  // Same last name in the same seat (a nickname, or a middle name used as the
  // first). Two people never share both, so this stays a name match.
  const last = person?.last_name ? normName(person.last_name).split(" ").pop() : lastName(personName(person));
  const district = districtDigits(person?.district);
  if (!last || !district) return null;
  const bySeat = (byName.length > 1 ? byName : pool)
    .filter((c) => lastName(c.full_name) === last && districtDigits(c.district) === district);
  return bySeat.length === 1 ? bySeat[0].id : null;
}

/**
 * An OpenStates voter_name ("Smith", "Smith, J.", "Jane Smith") as one
 * legislator id, or null. A bare last name only counts when it is unique in
 * the chamber, and only for votes from `lastNameOnlySince` on: an older vote
 * may belong to a predecessor with the same surname.
 * @param {string} voterName
 * @param {Array<{ id: string, full_name: string, role: string }>} candidates
 * @param {{ chamber?: string, voteDate?: string | null, lastNameOnlySince?: string }} [opts]
 */
export function matchVoterName(voterName, candidates, { chamber = "", voteDate = null, lastNameOnlySince = "2025-01-01" } = {}) {
  const pool = (candidates ?? []).filter((c) => !chamber || chamberOf(c.role) === chamber);
  const keys = nameKeys(voterName);
  const full = pool.filter((c) => [...nameKeys(c.full_name)].some((k) => keys.has(k)));
  if (full.length === 1) return full[0].id;
  if (full.length > 1) return null;

  const n = normName(voterName).split(" ");
  const surname = n[n.length - 1];
  const initial = n.length > 1 && n[0].length === 1 ? n[0] : "";
  if (!surname || (n.length > 1 && !initial)) return null;
  if (!voteDate || voteDate < lastNameOnlySince) return null;
  const same = pool.filter((c) => lastName(c.full_name) === surname &&
    (!initial || normName(c.full_name).startsWith(initial)));
  return same.length === 1 ? same[0].id : null;
}

/** Keep only pairs where each legislator is claimed by a single people_id. */
export function collisionFree(pairs) {
  const count = new Map();
  for (const p of pairs) count.set(p.legId, (count.get(p.legId) ?? 0) + 1);
  return pairs.filter((p) => count.get(p.legId) === 1);
}
