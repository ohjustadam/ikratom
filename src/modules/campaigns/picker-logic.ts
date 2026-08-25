/**
 * picker-logic.ts — the decisions behind the manual recipient picker.
 *
 * Extracted from StateRepPicker so the parts that can be WRONG can be tested.
 * The JSX is not the risky half: grouping, which chambers start collapsed, and
 * what "select all" actually produces are, and those were previously inline in
 * a client component where nothing could reach them.
 *
 * This matters more than it looks. The bugs this feature has already produced
 * were all quiet arithmetic — a cap that sent 20 of 198 and reported success,
 * a mailto 386% over the URL limit. Set maths that silently drops a chamber
 * would be the same class of failure, so it gets tests rather than trust.
 */

export type PickerLegislator = {
  id: string;
  role: string;
  full_name: string;
  district?: string | null;
};

/**
 * Groups above this start collapsed. A 158-member State Rep. list rendered
 * open pushes every other chamber and the send button out of the scroll
 * viewport; a 3-member delegation collapsed helps nobody.
 */
export const COLLAPSE_OVER = 25;

/** Group by role, each group ordered by district then name. */
export function groupByRole<T extends PickerLegislator>(reps: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const r of reps) {
    if (!grouped.has(r.role)) grouped.set(r.role, []);
    grouped.get(r.role)!.push(r);
  }
  for (const arr of grouped.values()) {
    arr.sort(
      (a, b) =>
        (a.district ?? "").localeCompare(b.district ?? "") ||
        a.full_name.localeCompare(b.full_name),
    );
  }
  return grouped;
}

/** Which role groups should start collapsed. */
export function defaultCollapsed(reps: PickerLegislator[]): Set<string> {
  const counts = new Map<string, number>();
  for (const r of reps) counts.set(r.role, (counts.get(r.role) ?? 0) + 1);
  return new Set(
    [...counts.entries()].filter(([, n]) => n > COLLAPSE_OVER).map(([role]) => role),
  );
}

/** Add or remove one id. */
export function togglePicked(picked: Set<string>, id: string): Set<string> {
  const next = new Set(picked);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Select or clear a whole group, leaving every other group untouched — the
 * property that makes "all 40 senators, no representatives" possible.
 */
export function setGroupPicked(
  picked: Set<string>,
  group: PickerLegislator[],
  on: boolean,
): Set<string> {
  const next = new Set(picked);
  for (const r of group) {
    if (on) next.add(r.id);
    else next.delete(r.id);
  }
  return next;
}

/**
 * The send target. Returns the "all" sentinel when everything is selected
 * rather than enumerating ids: 198 UUIDs is a ~7.4 KB query string, past what
 * several servers and proxies accept. The page re-resolves "all" from the
 * campaign's own scope, so the two can never disagree.
 */
export function buildTargetsParam(
  picked: Set<string>,
  totalAvailable: number,
): string | null {
  if (picked.size === 0) return null;
  if (totalAvailable > 0 && picked.size === totalAvailable) return "all";
  return [...picked].join(",");
}
