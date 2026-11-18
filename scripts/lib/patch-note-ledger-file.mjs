/**
 * Checks for a ledger data file (scripts/data/patch-notes/<slug>.json), shared
 * by the fill script and the CI test, so a file that would be refused at
 * Publish can't merge either.
 */
import { publishBlocklistMatches } from "./changelog-safety.mjs";
import { DRAFT_AREAS } from "./patch-note-draft.mjs";

const TYPES = ["new", "fix", "faster"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with a ledger file, one line each (empty = clean). */
export function checkLedgerFile(data) {
  const out = [];
  if (!Array.isArray(data?.items) || !Array.isArray(data?.figures)) return ["needs items[] and figures[]"];
  data.items.forEach((it, n) => {
    const at = `item ${n + 1}`;
    if (!YMD.test(it.merged_on ?? "")) out.push(`${at}: merged_on must be YYYY-MM-DD`);
    if (it.pr != null && !(Number.isInteger(it.pr) && it.pr > 0)) out.push(`${at}: bad pr`);
    if (!DRAFT_AREAS.includes(it.area)) out.push(`${at}: unknown area "${it.area}"`);
    if (!TYPES.includes(it.type)) out.push(`${at}: unknown type "${it.type}"`);
    if (!it.title || it.title.length > 200) out.push(`${at}: title must be 1-200 characters`);
    if (it.detail && it.detail.length > 500) out.push(`${at}: detail over 500 characters`);
    if (typeof it.member_report !== "boolean") out.push(`${at}: member_report must be true or false`);
  });
  const keys = new Set();
  data.figures.forEach((f, n) => {
    const at = `figure ${n + 1}`;
    if (!/^[a-z0-9_]{1,40}$/.test(f.key ?? "")) out.push(`${at}: bad key`);
    if (keys.has(f.key)) out.push(`${at}: repeats key ${f.key}`);
    keys.add(f.key);
    if (!Number.isFinite(f.value)) out.push(`${at}: value must be a number`);
    if (!f.label || f.label.length > 80) out.push(`${at}: label must be 1-80 characters`);
    if (f.detail && f.detail.length > 200) out.push(`${at}: detail over 200 characters`);
  });
  const text = [
    ...data.items.flatMap((i) => [i.title, i.detail ?? ""]),
    ...data.figures.flatMap((f) => [f.label, f.detail ?? ""]),
  ].join("\n");
  const words = publishBlocklistMatches(text);
  if (words.length) out.push(`not for What's New (members-only changes): ${words.join(", ")}`);
  return out;
}
