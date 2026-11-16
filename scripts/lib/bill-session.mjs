// Which legislative session a bills row belongs to, read from its label.
//
// Bill numbers are reused every session, so a sync that looks a bill up by
// number can find the newer bill and copy its actions onto an old row. The
// LegiScan sync guards against that by comparing the row's session with the
// session of the bill it fetched. The guard used to read only four-digit years
// out of the label, and a third of the labels have none:
//   - OpenStates ordinals: Illinois "101st", Texas "89R", Ohio "136".
//   - LegiScan session ids from the dataset sync: "2176" is Illinois's 104th.
// It also let the next session through, so "103rd" (2023-24) passed against
// the 104th (2025-26). That is how 12 Illinois kratom rows came to show
// bingo, FOIA and Chicago cultural-district bills (found 2026-11-06).

import { deriveStatusFromAction, statusFromLegiscanCode, terminalStatusFromAction } from "./bill-status.mjs";

/** The year range written in a label: "2019-2020", "2021", "2025_26". */
export function labelYears(label) {
  const s = String(label ?? "");
  const years = (s.match(/(?:19|20)\d{2}/g) ?? []).map(Number);
  if (years.length === 0) return null;
  const short = s.match(/((?:19|20)\d{2})[_-](\d{2})(?!\d)/);
  if (short) years.push(Number(short[1].slice(0, 2) + short[2]));
  return { year_start: Math.min(...years), year_end: Math.max(...years) };
}

/** "101st", "89R", "136" and "55th-1st-regular" name an assembly by number. */
function labelOrdinal(label) {
  const m = String(label ?? "").match(/^(\d{1,3})(?:st|nd|rd|th|R)?(?:\b|-|$)/i);
  return m ? Number(m[1]) : null;
}

const overlaps = (a, b) => a.year_start <= b.year_end && b.year_start <= a.year_end;
const regularFirst = (list) => [...list.filter((r) => !r.special), ...list.filter((r) => r.special)];

/** The session whose LegiScan id the label is ("2176"). */
function sessionsById(label, rows) {
  return /^\d+$/.test(label) ? rows.filter((r) => Number(r.legiscan_session_id) === Number(label)) : [];
}

/** The sessions of the assembly the label numbers ("101st", "89R", "136"). */
function sessionsByOrdinal(label, rows) {
  const n = labelOrdinal(label);
  if (!n) return [];
  const re = new RegExp(`\\b${n}(?:st|nd|rd|th)\\b`, "i");
  return regularFirst(rows.filter((r) => re.test(r.session_name ?? "")));
}

/**
 * Every one of the state's sessions (legislative_sessions rows) a label can
 * mean, best first: the LegiScan session id it names, then the assembly number
 * in the session's name, then the years. Within each, regular sessions come
 * before special ones.
 */
export function sessionsForLabel(label, sessions) {
  const rows = sessions ?? [];
  const s = String(label ?? "").trim();
  if (!s) return [];
  const years = labelYears(s);
  const dated = years ? rows.filter((r) => overlaps(r, years)) : [];
  return [...new Set([...sessionsById(s, rows), ...sessionsByOrdinal(s, rows), ...regularFirst(dated)])];
}

/**
 * True when a fetched bill's session can't be the row's own. Each reading of
 * the label counts: "2020" in Illinois is both a year and the 103rd GA's
 * LegiScan id. Only when none of them fits the bill's years is it someone
 * else's bill. A label with no reading proves nothing, so it never blocks.
 *
 * A one-year year or session may be a year off and still be the same bill:
 * OpenStates names Oklahoma's two-year legislature by its end year (HB 1784,
 * enacted 2021, is "2022"), Virginia relabels a continued bill with the next
 * year, and an annual LegiScan session can hold a carried-over bill. Anything
 * longer names a whole biennium, and bills die with it, so it is exact: the
 * 103rd GA (2023-24) is not the 104th (2025-26). So is an assembly number,
 * even for its one-year special session.
 */
export function sessionMismatch(label, detailSession, sessions) {
  const start = Number(detailSession?.year_start ?? detailSession?.year_end ?? 0);
  const end = Number(detailSession?.year_end ?? start);
  if (!start) return false;
  const s = String(label ?? "").trim();
  const rows = sessions ?? [];
  const range = (r) => ({ year_start: Number(r.year_start), year_end: Number(r.year_end) });
  const loose = (r) => (r.year_start === r.year_end ? { year_start: r.year_start - 1, year_end: r.year_end + 1 } : r);
  const years = labelYears(s);
  const readings = [
    ...sessionsById(s, rows).map(range).map(loose),
    ...sessionsByOrdinal(s, rows).map(range),
    ...(years ? [loose(years)] : []),
  ];
  if (readings.length === 0) return false;
  return !readings.some((r) => overlaps(r, { year_start: start, year_end: end }));
}

/** "HB 0622", "HB622" and "hb 622" are one number. */
export function normBillNumber(n) {
  return String(n ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().replace(/^([A-Z]+)0+(?=\d)/, "$1");
}

/** LegiScan's history sorted by date (it isn't always), dated entries only. */
export function sortedHistory(detail) {
  return (detail?.history ?? [])
    .filter((h) => h?.date && h?.action)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

const RANK = { enacted: 3, vetoed: 2, dead: 1 };

/**
 * A bill's status from its own LegiScan record, for rebuilding a row whose
 * stored status came from another bill. The record proves a terminal outcome
 * through its code (statusFromLegiscanCode) or any action's wording, and the
 * stronger one wins, so dead never beats enacted. Codes 2 and 3 (engrossed,
 * enrolled) mean it passed a chamber. Otherwise the last action says how far
 * it got. Old age is never a reason to call it dead.
 */
export function statusFromOwnLegiscanBill(detail, billNumber) {
  const history = sortedHistory(detail);
  const last = history[history.length - 1]?.action ?? null;
  const code = Number(detail?.status);
  let fromText = null;
  for (let i = history.length - 1; i >= 0 && !fromText; i--) fromText = terminalStatusFromAction(history[i].action);
  const fromCode = statusFromLegiscanCode({ code, billNumber, lastAction: last });
  const terminal = [fromText, fromCode].filter(Boolean).sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0))[0];
  if (terminal) return terminal;
  if (code === 2 || code === 3) return "passed_chamber";
  return last ? deriveStatusFromAction(last) : null;
}

/** A bill can act the year before its session (prefiled) but not after it. */
export function actionInSession(date, session) {
  const year = Number(String(date ?? "").slice(0, 4));
  if (!year || !session?.year_start) return false;
  return year >= Number(session.year_start) - 1 && year <= Number(session.year_end ?? session.year_start);
}
