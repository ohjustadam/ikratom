import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AREA_KEYS,
  TYPE_KEYS,
  countsByArea,
  countsLine,
  filterAndSort,
  headlineCounts,
  shortDate,
  toItems,
  type Area,
  type LedgerFilter,
  type PatchNoteItem,
} from "@/lib/patch-note-items";
import { ledgerBlockedWords, validateLedger } from "@/modules/admin/patch-note-ledger";
import { DRAFT_AREAS, draftItem } from "../scripts/lib/patch-note-draft.mjs";
import { checkLedgerFile } from "../scripts/lib/patch-note-ledger-file.mjs";

/**
 * The What's New ledger (migration 0323): the scoreboard + ledger layout the
 * owner picked on 2026-11-17, and the rule it must keep: only changes members
 * can see (owner, 2026-11-06).
 */

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const item = (over: Partial<PatchNoteItem>): PatchNoteItem => ({
  mergedOn: "2026-11-06",
  pr: 1,
  area: "bills",
  type: "fix",
  title: "A change",
  detail: null,
  memberReport: false,
  sort: 0,
  ...over,
});

const SAMPLE = [
  item({ sort: 0, mergedOn: "2026-11-05", area: "news", title: "Stories reach your feed", pr: 1124 }),
  item({ sort: 1, area: "letters", type: "new", title: "Write to reporters", pr: 1134 }),
  item({ sort: 2, area: "community", type: "new", title: "Image posts in groups", memberReport: true, pr: 1140 }),
  item({ sort: 3, mergedOn: "2026-11-16", area: "speed", type: "faster", title: "Pages load faster", pr: 1151 }),
  item({ sort: 4, mergedOn: "2026-11-16", area: "bills", type: "new", title: "Votes by name", memberReport: true, pr: 1167 }),
  item({ sort: 5, mergedOn: "2026-11-16", area: "bills", title: "Election results", detail: "Minnesota and Florida", pr: 1133 }),
];

const filter = (over: Partial<LedgerFilter> = {}): LedgerFilter => ({
  q: "",
  areas: new Set<Area>(AREA_KEYS),
  type: "all",
  sort: "mergedOn",
  dir: -1,
  ...over,
});

describe("the scoreboard counts", () => {
  it("splits changes into new, fixed and faster, and counts member reports", () => {
    expect(headlineCounts(SAMPLE)).toEqual({ total: 6, new: 3, fix: 2, faster: 1, memberReports: 2 });
    expect(countsLine(headlineCounts(SAMPLE))).toBe("6 changes · 3 new · 2 fixed · 1 faster");
    expect(countsLine({ total: 1, new: 1, fix: 0, faster: 0, memberReports: 0 })).toBe("1 change · 1 new");
  });

  it("counts by area, biggest first, and drops empty areas", () => {
    const rows = countsByArea(SAMPLE);
    expect(rows[0]).toEqual({ area: "bills", n: 2, split: { new: 1, fix: 1, faster: 0 } });
    expect(rows.map((r) => r.area)).not.toContain("account");
    expect(rows.reduce((s, r) => s + r.n, 0)).toBe(SAMPLE.length);
  });
});

describe("the ledger filters and sorts", () => {
  it("shows everything, newest first, by default", () => {
    const rows = filterAndSort(SAMPLE, filter());
    expect(rows).toHaveLength(SAMPLE.length);
    expect(rows[0].mergedOn).toBe("2026-11-16");
    expect(rows.at(-1)!.mergedOn).toBe("2026-11-05");
    // Ties keep the curated order.
    expect(rows.slice(0, 3).map((r) => r.sort)).toEqual([3, 4, 5]);
  });

  it("searches title, detail and area name", () => {
    expect(filterAndSort(SAMPLE, filter({ q: "florida" })).map((r) => r.pr)).toEqual([1133]);
    expect(filterAndSort(SAMPLE, filter({ q: "groups & community" })).map((r) => r.pr)).toEqual([1140]);
  });

  it("filters by area chips, type and member reports", () => {
    expect(filterAndSort(SAMPLE, filter({ areas: new Set<Area>(["bills"]) }))).toHaveLength(2);
    expect(filterAndSort(SAMPLE, filter({ type: "faster" })).map((r) => r.pr)).toEqual([1151]);
    expect(filterAndSort(SAMPLE, filter({ type: "report" })).map((r) => r.pr).sort()).toEqual([1140, 1167]);
  });

  it("sorts by any column, both ways", () => {
    expect(filterAndSort(SAMPLE, filter({ sort: "pr", dir: 1 }))[0].pr).toBe(1124);
    expect(filterAndSort(SAMPLE, filter({ sort: "title", dir: 1 }))[0].title).toBe("Election results");
    expect(filterAndSort(SAMPLE, filter({ sort: "area", dir: 1 }))[0].area).toBe("bills");
  });

  it("reads a civic date as a date, not a UTC instant", () => {
    expect(shortDate("2026-11-16")).toBe("Nov 16");
    expect(shortDate("2026-11-01")).toBe("Nov 1");
  });

  it("drops rows outside the known areas and types", () => {
    const rows = toItems([
      { merged_on: "2026-11-06", pr: 1, area: "bills", type: "fix", title: "ok", detail: " ", member_report: false, sort: 0 },
      { merged_on: "2026-11-06", pr: 2, area: "ops", type: "fix", title: "internal", detail: null, member_report: false, sort: 1 },
      { merged_on: "2026-11-06", pr: 3, area: "bills", type: "chore", title: "chore", detail: null, member_report: false, sort: 2 },
    ]);
    expect(rows.map((r) => r.pr)).toEqual([1]);
    expect(rows[0].detail).toBeNull();
  });
});

describe("there is no area for internal work, anywhere", () => {
  const sql = read("supabase", "migrations", "0323_patch_note_items.sql");
  const checked = /area\s+text NOT NULL\s+CHECK \(area IN \(([^)]*)\)\)/.exec(sql);

  it("the database, the page and the generator share one list of areas", () => {
    expect(checked, "the area CHECK must be readable").not.toBeNull();
    const dbAreas = checked![1].match(/'([a-z]+)'/g)!.map((s) => s.replaceAll("'", ""));
    expect(dbAreas).toEqual([...AREA_KEYS]);
    expect(DRAFT_AREAS).toEqual([...AREA_KEYS]);
    expect(sql).toMatch(/CHECK \(type IN \('new','fix','faster'\)\)/);
    expect([...TYPE_KEYS]).toEqual(["new", "fix", "faster"]);
  });

  it("no list offers ops, internal or security", () => {
    for (const bad of ["ops", "internal", "security", "infra"]) {
      expect(AREA_KEYS as readonly string[]).not.toContain(bad);
    }
  });
});

describe("visibility follows the parent note", () => {
  const sql = read("supabase", "migrations", "0323_patch_note_items.sql");

  it("public read only for a published note, on both tables", () => {
    for (const t of ["patch_note_items", "patch_note_figures"]) {
      const re = new RegExp(`ON public\\.${t}\\s+FOR SELECT TO public[\\s\\S]{0,200}n\\.status = 'published'`);
      expect(sql).toMatch(re);
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`GRANT SELECT ON public\\.${t} TO anon, authenticated`));
    }
  });

  it("the counts view runs as the visitor, so drafts never get counted", () => {
    expect(sql).toMatch(/VIEW public\.patch_note_item_counts\s+WITH \(security_invoker = true\)/);
  });
});

describe("drafting items from commits", () => {
  it("suggests an area and type from the commit, and keeps the PR", () => {
    expect(draftItem("fix(votes): every roll-call vote is named [skip netlify] (#1167)", "2026-11-16T21:00:00-05:00")).toEqual({
      merged_on: "2026-11-16",
      pr: 1167,
      area: "bills",
      type: "fix",
      title: "Every roll-call vote is named",
      detail: null,
      member_report: false,
    });
    expect(draftItem("feat(media): members can reply to reporters [skip netlify] (#1134)", "2026-11-06T12:00:00Z")).toMatchObject({ area: "letters", type: "new", pr: 1134 });
    expect(draftItem("perf(api): signed-out calls skip the database [skip netlify] (#1163)", "2026-11-16T12:00:00Z")).toMatchObject({ area: "speed", type: "faster" });
    expect(draftItem("fix(groups): group posts hold 10,000 characters", "2026-11-11T12:00:00Z")).toMatchObject({ area: "community", pr: null });
  });

  it("dates an evening commit by the Eastern day, not the UTC one", () => {
    expect(draftItem("fix(bills): x (#1)", "2026-11-17T02:30:00Z")!.merged_on).toBe("2026-11-16");
  });

  it("drafts nothing for chores, docs or CI", () => {
    expect(draftItem("chore(cron): pause the weekly job (#1130)", "2026-11-06T12:00:00Z")).toBeNull();
    expect(draftItem("docs(state): forum roles (#1143)", "2026-11-06T12:00:00Z")).toBeNull();
  });

  it("the generator drafts items only for a note that is still a draft", () => {
    const gen = read("scripts", "generate-patch-note.mjs");
    expect(gen).toMatch(/draftItem\(c\.subject, c\.date\)/);
    // Items are written after the curated-note guard, never before it.
    expect(gen.indexOf('existing.status !== "draft"')).toBeGreaterThan(0);
    expect(gen.indexOf('from("patch_note_items")')).toBeGreaterThan(gen.indexOf('existing.status !== "draft"'));
    // Only public commits reach draftItem: it sits after the held/security skips.
    expect(gen.indexOf("draftItem(c.subject")).toBeGreaterThan(gen.indexOf('klass === "held"'));
  });
});

describe("items are held to the same rule as the note", () => {
  it("Publish checks the ledger, not just the markdown", () => {
    const actions = read("src", "modules", "admin", "patch-note-actions.ts");
    const publish = actions.slice(actions.indexOf("export async function setPatchNoteStatus"));
    expect(publish).toMatch(/ledgerBlockReason\(supabase, note\.id/);
  });

  it("saving live items checks them", () => {
    const save = read("src", "modules", "admin", "patch-note-ledger-actions.ts");
    expect(save).toMatch(/note\.status === "published"[\s\S]{0,120}ledgerBlockedWords\(v\.items, v\.figures\)/);
  });

  it("names the words in items and tiles that stop a note going public", () => {
    expect(ledgerBlockedWords([{ title: "Security hardening for sign-in", detail: null }], [])).toContain("security");
    expect(ledgerBlockedWords([], [{ label: "cron runs", detail: null }])).toEqual(["cron"]);
    expect(ledgerBlockedWords([{ title: "Votes show every legislator by name", detail: "Links to their page." }], [])).toEqual([]);
  });

  it("validates what the editor sends", () => {
    const ok = validateLedger([item({ title: "  Votes by name  ", pr: 1167 })], [{ key: "votes", value: 19233, label: "votes on record", detail: "" }]);
    expect(ok).toMatchObject({ ok: true });
    if ("ok" in ok) {
      expect(ok.items[0]).toMatchObject({ title: "Votes by name", merged_on: "2026-11-06", detail: null });
      expect(ok.figures[0]).toEqual({ key: "votes", value: 19233, label: "votes on record", detail: null });
    }
    expect(validateLedger([item({ area: "ops" as Area })], [])).toEqual({ error: "Item 1 has an unknown area." });
    expect(validateLedger([item({ title: " " })], [])).toEqual({ error: "Item 1 needs a title." });
    expect(validateLedger([item({ pr: -4 })], [])).toEqual({ error: "Item 1 has a bad PR number." });
    expect(validateLedger([], [{ key: "a", value: 1, label: "x", detail: null }, { key: "a", value: 2, label: "y", detail: null }])).toEqual({
      error: 'Figure 2 repeats the key "a".',
    });
  });
});

describe("ledger data files (scripts/data/patch-notes)", () => {
  const dir = join(ROOT, "scripts", "data", "patch-notes");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("finds files to check", () => {
    expect(files).toContain("2026-11-17-update.json");
  });

  for (const f of files) {
    it(`clean: ${f}`, () => {
      expect(checkLedgerFile(JSON.parse(readFileSync(join(dir, f), "utf8")))).toEqual([]);
    });
  }

  it("the 2026-11-17 note carries the 29 member-visible changes", () => {
    const data = JSON.parse(readFileSync(join(dir, "2026-11-17-update.json"), "utf8"));
    expect(data.items).toHaveLength(29);
    expect(data.items.filter((i: { member_report: boolean }) => i.member_report)).toHaveLength(8);
    expect(new Set(data.items.map((i: { pr: number }) => i.pr)).size).toBe(29);
  });

  it("the check catches a bad file", () => {
    const bad = {
      items: [{ merged_on: "Nov 6", pr: 0, area: "ops", type: "chore", title: "Security fix for the cron", member_report: "no" }],
      figures: [{ key: "Bad Key", value: "x", label: "" }],
    };
    const problems = checkLedgerFile(bad).join("\n");
    for (const want of ["merged_on", "bad pr", "unknown area", "unknown type", "member_report", "bad key", "value", "label", "security", "cron"]) {
      expect(problems).toContain(want);
    }
  });
});
