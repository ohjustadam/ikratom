// Shared bill-status derivation from a bill's free-text `last_action`.
//
// Why this exists: LegiScan's numeric status code maps cleanly (see STATUS_MAP
// in sync-bills-via-legiscan.mjs), but most bills are only ever touched by the
// OpenStates keyword sync, which derives status from `latest_action_description`.
// The old derivation only caught `signed | became law | enacted`, so the exact
// phrasings states actually use — "Becomes law without Governor's signature"
// (OK SB 891), "Approved by Governor" (OK HB 1784), "Act No. 35" (SC S 221),
// "Signed by the Governor on …" (SD/RI/VA) — slipped through and bills sat at
// `passed_chamber`/`introduced` forever. That's why the "enacted" filter was
// empty for OK and why dead bills read as "still in process".
//
// Keep this conservative: a terminal classification overrides a non-terminal
// one, but an absent signal returns null (caller keeps the existing status).

// Veto OVERRIDE means the bill became law despite the veto — check before plain veto.
const VETO_OVERRIDE_RE =
  /(?:\bveto\s+overr\w*|\boverr\w*\s+(?:the\s+)?(?:governor'?s\s+)?veto\b|\bpassed\s+over\s+(?:the\s+)?(?:governor'?s\s+)?veto\b|\bnotwithstanding\s+the\s+(?:governor'?s\s+)?veto\b)/i;

// Strong enactment signals. "signed" is qualified (by governor/president/mayor or
// "into law") so a procedural "Signed by the Speaker/Clerk" is NOT misread as enacted.
const ENACTED_RE =
  /(?:\bsigned\s+(?:into\s+law|by\s+(?:the\s+)?(?:governor|president|mayor))|\bgovernor\s+signed|\bbec(?:ame|omes)\s+law|\bapproved\s+by\s+(?:the\s+)?governor|\benacted\b|\bchaptered\b|\bchapter\s+(?:no\.?\s*|number\s*)?\d+|\bchapter\s+number\s+assigned\b|\bacts\s+of\s+assembly\s+chapter\b|\bsigned\s+chap\b|\bapproval\s+memo\b|\bassigned\s+pa\s+\d|\bact\s+no\.?\s*\d|\bpublic\s+(?:law|act)\b|\bsession\s+law\b|\bfiled\s+with\s+(?:the\s+)?secretary\s+of\s+state\b)/i;

// LA, GA, OR, TX and TN log the effective date as a bill's last action, which
// only happens after it became law (LA SB 154 read "Dead" until 2026-11-05 on
// "Effective date 8/1/2025."). Anchored, so an amendment about a date isn't one.
const EFFECTIVE_RE = /^\s*effective\s+(?:date|on|immediately)\b(?!.*\bamend)/i;

// A line-item veto strikes part of a bill; the rest of it is law.
const LINE_ITEM_RE = /\bline[-\s]item\s+veto\b/i;

const VETO_RE = /\bveto(?:ed|es)?\b/i;

// Tennessee records an enacted bill as "Pub. Ch. 950", and its companion as
// "Comp. became Pub. Ch. 950". The companion did not become law itself, so it
// gets no terminal signal; the session-over cron retires it instead of the
// same law counting twice (TN SB 1656 sat at passed_chamber until 2026-11-03).
const PUB_CH_RE = /\bpub\.?\s*ch\.?\s*\d+/i;
const COMPANION_RE = /\bcomp(?:anion)?\.?\s+(?:bill\s+)?became\b/i;

// Another bill carried on in this one's place: TN "Comp. became Pub. Ch. 950",
// NY "substituted by s8925a", FL "companion bill(s) passed". The number on this
// row stopped, but the idea did not.
const HANDED_OFF_RE = /\bsubstituted\s+by\b|\bcomp(?:anion)?\.?\s+(?:bill(?:\(s\))?\s+)?(?:became|passed)\b/i;

export function companionMovedOn(lastAction) {
  return HANDED_OFF_RE.test(String(lastAction ?? ""));
}

const DEAD_RE =
  /\b(?:died|indefinitely\s+postponed|postponed\s+indefinitely|withdrawn|failed|stricken|tabled|defeated|killed|adjourned\s+sine\s+die|did\s+not\s+pass|enacting\s+clause\s+stricken|sine\s+die)\b/i;

// Returns "enacted" | "vetoed" | "dead" | null (null = no terminal signal).
export function terminalStatusFromAction(lastAction) {
  const s = String(lastAction ?? "");
  if (!s.trim()) return null;
  if (COMPANION_RE.test(s)) return null;
  if (VETO_OVERRIDE_RE.test(s) || LINE_ITEM_RE.test(s)) return "enacted";
  if (ENACTED_RE.test(s) || PUB_CH_RE.test(s) || EFFECTIVE_RE.test(s)) return "enacted";
  if (VETO_RE.test(s)) return "vetoed";
  if (DEAD_RE.test(s)) return "dead";
  return null;
}

// Full status ladder for the OpenStates sync (replaces the old narrow regex).
// Collapses to the schema's stages: introduced | committee | passed_chamber |
// enacted | vetoed | dead.
export function deriveStatusFromAction(lastAction) {
  const t = terminalStatusFromAction(lastAction);
  if (t) return t;
  const s = String(lastAction ?? "").toLowerCase();
  if (s.includes("passed") || s.includes("third reading") || s.includes("read third time") || NY_BOTH_HOUSES_RE.test(s)) return "passed_chamber";
  if (s.includes("committee") || s.includes("referred")) return "committee";
  return "introduced";
}

export const TERMINAL_STATUSES = new Set(["enacted", "vetoed", "dead", "failed"]);

// Waiting on a signature is not lapsing. New York logs "returned to senate" once
// the second house passes a bill, and the governor can get it as late as
// December, so S 8925A read "session over, did not pass" for months after both
// chambers passed it (found 2026-11-06).
const TO_GOVERNOR_RE = /\b(?:delivered|sent|presented|transmitted)\s+to\s+(?:the\s+)?governor\b/i;
const NY_BOTH_HOUSES_RE = /\breturned\s+to\s+(?:senate|assembly)\b/i;

export function awaitingGovernor({ state, last_action }) {
  const action = String(last_action ?? "");
  if (terminalStatusFromAction(action)) return false;
  return TO_GOVERNOR_RE.test(action) || (state === "NY" && NY_BOTH_HOUSES_RE.test(action));
}

// A House or Senate resolution needs one chamber, so passing it is the end.
export function isOneChamberResolution(billNumber) {
  return /^[HSA]\.?\s?R\b/i.test(String(billNumber ?? ""));
}

// What LegiScan's status code proves about a bill that has stopped moving. Code
// 4 means it passed, and that catches wording no regex here knows. A companion's
// 4 is its twin's law, and a one-chamber resolution is adopted rather than
// enacted. Null means no proof either way.
export function statusFromLegiscanCode({ code, billNumber, lastAction }) {
  if (code === 5) return "vetoed";
  if (code === 6) return "dead";
  if (code !== 4 || COMPANION_RE.test(String(lastAction ?? ""))) return null;
  return isOneChamberResolution(billNumber) ? "passed_chamber" : "enacted";
}

// A number gets reused every session, so a stored LegiScan id can point at a
// newer bill (MI SB 433: a 2019 kratom row held the id of a 2026 THC law). Its
// code only counts when the row's last action falls inside that session, plus a
// year for effective dates.
export function legiscanSessionFits(lastActionAt, session) {
  const year = Number(String(lastActionAt ?? "").slice(0, 4));
  const start = Number(session?.year_start);
  const end = Number(session?.year_end);
  if (!year || !start || !end) return false;
  return year >= start && year <= end + 1;
}

const TWIN_RANK = { enacted: 3, vetoed: 2, dead: 1 };

// "WY SF 56" and "WY SF 0056" are one bill, and so is a row each sync wrote for
// it. The same number in another session has a different last action date.
export function billTwinKey(b) {
  const number = String(b.bill_number ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().replace(/^([A-Z]+)0+/, "$1");
  return `${b.state}|${number}|${String(b.last_action_at ?? "").slice(0, 10)}`;
}

// Two rows for one bill must not disagree: each row behind the strongest
// terminal status among its twins moves up to it. Rows with no date are skipped.
export function twinCorrections(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!r.last_action_at) continue;
    const k = billTwinKey(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out = [];
  for (const twins of groups.values()) {
    const best = twins.reduce((a, b) => ((TWIN_RANK[b.status] ?? 0) > (TWIN_RANK[a.status] ?? 0) ? b : a));
    if (!TWIN_RANK[best.status]) continue;
    for (const t of twins) {
      if ((TWIN_RANK[t.status] ?? 0) < TWIN_RANK[best.status]) out.push({ id: t.id, next: best.status });
    }
  }
  return out;
}
