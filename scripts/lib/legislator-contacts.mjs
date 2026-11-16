/**
 * legislator-contacts.mjs — the pure half of the state-legislator contact
 * refresh (scripts/sync-state-legislator-contacts.mjs).
 *
 * Why it exists (PJ, 2026-11-11): one-click letters to three Michigan House
 * members bounced. Two addresses carried a doubled letter
 * (jaydeboyerr@, jerryneyerr@) that openstates/people had long since fixed,
 * but every state legislator row was last written by the one-off API seed on
 * 2026-05-04. The roster diff adds and retires people; nothing refreshed the
 * contact fields of the people who stayed.
 *
 * Rules, each one a lesson from the first nationwide diff (464 rows):
 *   - Upstream only ever FILLS or REPLACES a field. A blank upstream never
 *     clears ours: our value may come from another source (a county directory,
 *     a corrected typo) and an empty YAML field is no evidence against it.
 *   - Compare normalised values, so formatting noise (case, spacing, phone
 *     punctuation) never shows up as a change and never costs a write.
 *   - An email never steps DOWN in officialness. Upstream lists some members'
 *     personal Gmail or day-job address (AL Rep. Matt Simpson: alhouse.gov ->
 *     gmail.com). A letter to a staffed official inbox beats one to a personal
 *     account, so an official address is kept; an empty one is still filled.
 *   - Phone and address are replaced only from the member's CAPITOL office.
 *     Kentucky's YAML has dropped the capitol office for some members, so the
 *     "first office" became a district PO box, or just "KY". Anything else may
 *     only fill an empty field, and an address must look like one.
 *   - A phone number several members share is the chamber switchboard (North
 *     Dakota lists 701-328-3373 as everyone's capitol line). It fills an empty
 *     field but never replaces a member's direct number. The caller marks it
 *     with `phone_shared`, since only the whole roster shows the sharing.
 *   - An address our own checkers already rejected is never put back. The
 *     domain checker writes `Email corrected …: "<old>" …` / `Email removed …:
 *     "<old>" …` into verified_sources_md. If upstream still carries that exact
 *     address, we would undo the fix every run and the checker would redo it.
 */

export const ROLE_TYPES = new Set(["upper", "lower", "legislature"]);

/** The contact fields this refresh owns. Website is left out on purpose: the
 * first upstream link is often a party caucus page, not the member's own. */
export const CONTACT_FIELDS = ["email", "phone", "office_address"];

const clean = (v) => {
  const s = typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim() : "";
  return s || null;
};

const kind = (o) => String(o?.classification ?? "").toLowerCase();

/** The office a field is read from: capitol first, then any other with the
 * field, a `capitol-mail` PO box last. */
function pickOffice(offices, field) {
  const list = Array.isArray(offices) ? offices.filter((o) => clean(o?.[field])) : [];
  const rank = (o) => (kind(o) === "capitol" ? 0 : kind(o) === "capitol-mail" ? 2 : 1);
  return list.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i;
export const isEmail = (v) => EMAIL_RE.test(String(v ?? "").trim());

/** A street or PO-box address, not a bare state code or a placeholder. */
export const looksLikeAddress = (v) => {
  const s = clean(v);
  return !!s && s.length >= 12 && /\d/.test(s);
};

/** Contact fields from one openstates/people YAML doc, with where each came from. */
export function contactFromPerson(doc) {
  const email = clean(doc?.email);
  const phoneOffice = pickOffice(doc?.offices, "voice");
  const addrOffice = pickOffice(doc?.offices, "address");
  const address = clean(addrOffice?.address);
  return {
    email: email && isEmail(email) ? email : null,
    phone: clean(phoneOffice?.voice),
    phone_capitol: kind(phoneOffice) === "capitol",
    office_address: looksLikeAddress(address) ? address : null,
    office_address_capitol: kind(addrOffice) === "capitol",
  };
}

/**
 * Mark each contact whose phone `threshold` or more members of the same state
 * share (a switchboard). Mutates and returns the list of { state, contact }.
 */
export function markSharedPhones(entries, threshold = 5) {
  const counts = new Map();
  const key = (e) => `${e.state}|${normalise("phone", e.contact.phone)}`;
  for (const e of entries) if (e.contact.phone) counts.set(key(e), (counts.get(key(e)) ?? 0) + 1);
  for (const e of entries) e.contact.phone_shared = !!e.contact.phone && counts.get(key(e)) >= threshold;
  return entries;
}

/** Normalised form used only for comparison. */
export function normalise(field, v) {
  const s = clean(v);
  if (!s) return null;
  if (field === "email") return s.toLowerCase();
  if (field === "phone") {
    const d = s.replace(/\D/g, "");
    return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  }
  return s.toLowerCase().replace(/[.,]/g, "");
}

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|aol|hotmail|outlook|live|msn|icloud|me|mac|comcast|att|sbcglobal|bellsouth|verizon|charter|cox|earthlink|protonmail|proton)\.[a-z.]+$/;
/** A label like house.mi, arkansashouse, ilsenategop, wyoleg, leg.ne. */
const legislatureLabel = (label) => /legis|senate|house|assembly|capitol/.test(label) || /leg$/.test(label);

/**
 * How official an email's domain is: 2 = government or a legislature/caucus
 * domain, 1 = any other (campaign, business), 0 = free personal mail.
 */
export function emailRank(email) {
  const domain = String(email ?? "").split("@").pop().trim().toLowerCase();
  if (!domain) return -1;
  if (/\.(gov|us|mil)$/.test(domain) || domain.split(".").slice(0, -1).some(legislatureLabel)) return 2;
  if (FREE_MAIL.test(domain)) return 0;
  return 1;
}

/** Addresses our checkers have already corrected or removed on this row. */
export function rejectedEmails(verifiedSourcesMd) {
  const out = new Set();
  for (const m of String(verifiedSourcesMd ?? "").matchAll(/Email (?:corrected|removed)[^"\n]*"([^"\n]+)"/g)) {
    out.add(m[1].trim().toLowerCase());
  }
  return out;
}

/**
 * The changes upstream asks for on one of our rows.
 * @returns {{ field: string, from: string|null, to: string }[]}
 */
export function diffContacts(row, upstream) {
  const changes = [];
  for (const field of CONTACT_FIELDS) {
    const to = upstream?.[field] ?? null;
    if (!to) continue; // a blank upstream never clears ours
    const from = row?.[field] ?? null;
    if (normalise(field, to) === normalise(field, from)) continue;
    // `from` is "filled" only when it holds a usable value of its kind; a
    // contact-page URL in the email column is no address at all.
    const ours = field === "email" ? isEmail(from) : field === "office_address" ? looksLikeAddress(from) : !!clean(from);
    if (field === "email") {
      if (rejectedEmails(row?.verified_sources_md).has(normalise("email", to))) continue;
      if (ours && emailRank(to) < emailRank(from)) continue;
    } else if (ours && !upstream[`${field}_capitol`]) {
      continue;
    } else if (field === "phone" && ours && upstream.phone_shared) {
      continue; // a switchboard many members share never replaces a direct line
    }
    changes.push({ field, from, to });
  }
  return changes;
}

/** One provenance line per changed row, old values kept so it can be undone. */
export function provenanceLine(changes, ocdId, today) {
  const parts = changes.map((c) => `${c.field} "${c.from ?? ""}" -> "${c.to}"`);
  return `- Contact refreshed ${today} from openstates/people (${ocdId}): ${parts.join("; ")}.`;
}
