/**
 * The structured half of a What's New note (migration 0323): one row per change
 * a member can see, plus the note's number tiles. Pure, so the public page, the
 * client ledger, the admin editor and the tests all share one definition.
 *
 * There is no area for internal or security work, on purpose. What's New carries
 * only changes members can see (owner, 2026-11-06), and the database CHECK has
 * the same six values as AREAS below.
 */

export const AREA_KEYS = ["bills", "letters", "community", "news", "account", "speed"] as const;
export type Area = (typeof AREA_KEYS)[number];

export const TYPE_KEYS = ["new", "fix", "faster"] as const;
export type ChangeType = (typeof TYPE_KEYS)[number];

/**
 * Colors are one categorical set checked against both site surfaces (#0a0a0a and
 * the light theme's #fafafa) for color-blind separation. The light theme's amber
 * sits just under 3:1, which is why every bar carries its label and count in text
 * and the ledger below is the table view.
 */
export const AREAS: Record<Area, { label: string; dot: string }> = {
  bills: { label: "Bills & votes", dot: "bg-[#3987e5]" },
  letters: { label: "Letters & campaigns", dot: "bg-[#d95926]" },
  community: { label: "Groups & community", dot: "bg-[#199e70]" },
  news: { label: "News", dot: "bg-[#c98500]" },
  account: { label: "Account & feedback", dot: "bg-[#d55181]" },
  speed: { label: "Speed", dot: "bg-[#0ca30c]" },
};

export const TYPES: Record<ChangeType, string> = { new: "New", fix: "Fixed", faster: "Faster" };

export type PatchNoteItem = {
  mergedOn: string; // YYYY-MM-DD
  pr: number | null;
  area: Area;
  type: ChangeType;
  title: string;
  detail: string | null;
  memberReport: boolean;
  sort: number;
};

export type PatchNoteFigure = {
  key: string;
  value: number;
  label: string;
  detail: string | null;
};

export type HeadlineCounts = {
  total: number;
  new: number;
  fix: number;
  faster: number;
  memberReports: number;
};

export const isArea = (v: unknown): v is Area => AREA_KEYS.includes(v as Area);
export const isChangeType = (v: unknown): v is ChangeType => TYPE_KEYS.includes(v as ChangeType);

/** A patch_note_items row as PostgREST returns it. */
export type ItemRow = {
  merged_on: string;
  pr: number | null;
  area: string;
  type: string;
  title: string;
  detail: string | null;
  member_report: boolean;
  sort: number;
};

/** Rows to items, dropping anything outside the known areas and types. */
export function toItems(rows: ItemRow[]): PatchNoteItem[] {
  return rows.flatMap((r) =>
    isArea(r.area) && isChangeType(r.type)
      ? [
          {
            mergedOn: r.merged_on,
            pr: r.pr,
            area: r.area,
            type: r.type,
            title: r.title,
            detail: r.detail?.trim() ? r.detail : null,
            memberReport: r.member_report,
            sort: r.sort,
          },
        ]
      : [],
  );
}

export function headlineCounts(items: PatchNoteItem[]): HeadlineCounts {
  return {
    total: items.length,
    new: items.filter((i) => i.type === "new").length,
    fix: items.filter((i) => i.type === "fix").length,
    faster: items.filter((i) => i.type === "faster").length,
    memberReports: items.filter((i) => i.memberReport).length,
  };
}

/** "29 changes · 9 new · 17 fixed · 3 faster": zero parts drop out. */
export function countsLine(c: HeadlineCounts): string {
  const parts = [`${c.total} change${c.total === 1 ? "" : "s"}`];
  if (c.new) parts.push(`${c.new} new`);
  if (c.fix) parts.push(`${c.fix} fixed`);
  if (c.faster) parts.push(`${c.faster} faster`);
  return parts.join(" · ");
}

export type AreaCount = { area: Area; n: number; split: Record<ChangeType, number> };

/** Changes per area, biggest first; ties keep the AREAS order. Empty areas drop. */
export function countsByArea(items: PatchNoteItem[]): AreaCount[] {
  return AREA_KEYS.map((area) => {
    const mine = items.filter((i) => i.area === area);
    const split = { new: 0, fix: 0, faster: 0 };
    for (const i of mine) split[i.type] += 1;
    return { area, n: mine.length, split };
  })
    .filter((a) => a.n > 0)
    .sort((a, b) => b.n - a.n);
}

export type SortKey = "mergedOn" | "area" | "title" | "type" | "pr";
export type LedgerFilter = {
  q: string;
  areas: ReadonlySet<Area>;
  type: ChangeType | "all" | "report";
  sort: SortKey;
  dir: 1 | -1;
};

const sortValue = (i: PatchNoteItem, k: SortKey): string | number =>
  k === "area" ? AREAS[i.area].label : k === "type" ? TYPES[i.type] : k === "pr" ? (i.pr ?? 0) : i[k];

/** The ledger's search, area chips, type filter and column sort, in one place. */
export function filterAndSort(items: PatchNoteItem[], f: LedgerFilter): PatchNoteItem[] {
  const q = f.q.trim().toLowerCase();
  const rows = items.filter(
    (i) =>
      f.areas.has(i.area) &&
      (f.type === "all" || (f.type === "report" ? i.memberReport : i.type === f.type)) &&
      (!q || `${i.title} ${i.detail ?? ""} ${AREAS[i.area].label}`.toLowerCase().includes(q)),
  );
  return rows.sort((a, b) => {
    const x = sortValue(a, f.sort);
    const y = sortValue(b, f.sort);
    // Ties fall back to the curated order, so a re-sort never shuffles equal rows.
    return (x > y ? 1 : x < y ? -1 : 0) * f.dir || a.sort - b.sort;
  });
}

/** "Nov 16" for a YYYY-MM-DD civic date, read as a date, never as a UTC instant. */
export function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export const prUrl = (pr: number) => `https://github.com/ohjustadam/ikratom/pull/${pr}`;
