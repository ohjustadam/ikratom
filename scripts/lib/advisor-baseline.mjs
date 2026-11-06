/**
 * What the Supabase security advisor is allowed to say. Every finding in the
 * baseline was reviewed and is intentional; more of them, or a kind we have
 * never seen, means a migration changed the security picture.
 *
 * The kinds are stored as hashes because this repo is public and a finding name
 * says what to look for. To accept a change: review it, then raise the total
 * here (and add the new kind's typeHash).
 */
import { createHash } from "node:crypto";

export const BASELINE_TOTAL = 131; // +1 press_contacts: no member policy on purpose (0316)
export const BASELINE_TYPES = new Set([
  "5cca109bf0f23243", "5ef23c8e87a9b262", "7315b323c230fbf8", "db2dd3591be93007", "f05671f0e276f3cb",
]);

/** @param {string} name */
export const typeHash = (name) => createHash("sha256").update(name).digest("hex").slice(0, 16);

/**
 * @param {{ name: string }[]} lints
 * @param {{ total: number, types: Set<string> }} [baseline]
 */
export function judgeAdvisors(lints, baseline = { total: BASELINE_TOTAL, types: BASELINE_TYPES }) {
  const total = lints.length;
  const newTypes = [...new Set(lints.map((l) => l.name))].filter((n) => !baseline.types.has(typeHash(n)));
  // Zero findings isn't a clean bill of health: the baseline never empties, so it means we read nothing.
  const readNothing = total === 0;
  return { total, newTypes, over: Math.max(0, total - baseline.total), readNothing, ok: !readNothing && total <= baseline.total && newTypes.length === 0 };
}
