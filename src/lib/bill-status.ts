// Canonical bill-status display labels + filter grouping.
//
// Two sync sources write the "in committee" stage under different strings:
// OpenStates (`sync-bills.mjs`) writes `committee`; LegiScan (`sync-bills-via-legiscan.mjs`,
// datasets, the AI verifier, momentum scoring) writes `in_committee`. They are the
// SAME stage — group them at the display layer so a bill never renders a raw
// `in_committee` and the status filter offers a single "In committee" option that
// matches both. `vetoed`/`failed` are writable (LegiScan code 7 / dead-signal) but
// were previously unlabeled, so they fell through to the raw string and were
// effectively unfilterable.
export const BILL_STATUS_LABELS: Record<string, string> = {
  introduced: "Introduced",
  committee: "In committee",
  in_committee: "In committee",
  in_chamber: "On the floor",
  passed_chamber: "Passed chamber",
  enacted: "Enacted",
  vetoed: "Vetoed",
  dead: "Dead",
  failed: "Failed",
};

// Stable display order for the filter dropdown.
const STATUS_ORDER = [
  "introduced",
  "committee",
  "in_committee",
  "in_chamber",
  "passed_chamber",
  "enacted",
  "vetoed",
  "dead",
  "failed",
];

export function billStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return BILL_STATUS_LABELS[status] ?? status;
}

// Build deduped filter options from the statuses actually present, collapsing
// committee/in_committee into one "In committee" option. The returned `value`
// is a representative raw status; matching is done by label via billStatusMatches.
export function billStatusFilterOptions(
  statuses: (string | null | undefined)[],
): { value: string; label: string }[] {
  const present = new Set(statuses.filter(Boolean) as string[]);
  const seen = new Map<string, string>(); // label -> representative raw value
  for (const raw of STATUS_ORDER) {
    if (!present.has(raw)) continue;
    const label = BILL_STATUS_LABELS[raw] ?? raw;
    if (!seen.has(label)) seen.set(label, raw);
  }
  // Any unrecognized raw values still get an option.
  for (const raw of present) {
    if (STATUS_ORDER.includes(raw)) continue;
    const label = BILL_STATUS_LABELS[raw] ?? raw;
    if (!seen.has(label)) seen.set(label, raw);
  }
  return Array.from(seen, ([label, value]) => ({ value, label }));
}

// True when a bill's status belongs to the same display group as the selected
// filter value (so the "In committee" option matches both committee variants).
export function billStatusMatches(
  billStatus: string | null | undefined,
  filterValue: string,
): boolean {
  if (filterValue === "all") return true;
  const want = BILL_STATUS_LABELS[filterValue] ?? filterValue;
  const have = billStatus ? BILL_STATUS_LABELS[billStatus] ?? billStatus : null;
  return have === want;
}
