import "server-only";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { createAnonClient } from "@/lib/supabase/anon";
import { frontmatterString } from "@/lib/frontmatter";
import {
  toItems,
  type ItemRow,
  type HeadlineCounts,
  type PatchNoteFigure,
  type PatchNoteItem,
} from "@/lib/patch-note-items";

/**
 * One reader for /whats-new, over two sources.
 *
 * The notes published before 2026-09-17 are markdown files in
 * src/content/patch-notes/ and stay there. Everything published since is a row in
 * `patch_notes` (migration 0250), because a file needs a deploy and a row
 * does not.
 *
 * Both sources produce the same shape. On a slug collision the database wins,
 * so a file-era note can be corrected without touching the repo.
 *
 * FAIL-OPEN: if Supabase is unreachable or unconfigured, the file
 * back-catalogue still renders. A changelog that 500s because the database
 * blinked is worse than a changelog missing its newest entry.
 *
 * ── Why the ANON client, not the cookie-bound one ─────────────────────────
 * Reading cookies opts a route out of static generation, and these pages are
 * public and crawlable (/whats-new is NOT in the robots cost-control block).
 * A dynamic public page is a live database render on every bot hit, which is
 * the exact shape that put the project's egress in breach territory in
 * September 2026 — measured traffic on that page class is 99.97% bots.
 *
 * Going through createAnonClient keeps these routes ISR-cacheable, and it is
 * also the safer read: RLS always evaluates as an anonymous visitor, so the
 * cached payload is exactly what a logged-out person may see. An admin
 * browsing the public changelog cannot pull their own drafts into a shared
 * cache.
 */

export type PatchNote = {
  slug: string;
  title: string;
  summary: string | null;
  published: string | null;
  source: "db" | "file";
  /** Headline counts when the note has ledger items (migration 0323), else null. */
  counts: HeadlineCounts | null;
};

/**
 * `items` empty means the note renders its body_md, exactly as before 0323.
 * The markdown stays the fallback for every note, including ones with items.
 */
export type PatchNoteDetail = Omit<PatchNote, "counts"> & {
  bodyMd: string;
  items: PatchNoteItem[];
  figures: PatchNoteFigure[];
};

const NOTES_DIR = path.join(process.cwd(), "src", "content", "patch-notes");

function fileSlugs(): string[] {
  if (!fs.existsSync(NOTES_DIR)) return [];
  return fs
    .readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

function readFileNote(slug: string): PatchNoteDetail | null {
  const filePath = path.join(NOTES_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  const { data, content } = matter(fs.readFileSync(filePath, "utf8"));
  return {
    slug: frontmatterString(data.slug) ?? slug,
    title: frontmatterString(data.title) ?? slug,
    summary: frontmatterString(data.summary) ?? null,
    published: frontmatterString(data.published) ?? null,
    bodyMd: content,
    source: "file",
    items: [],
    figures: [],
  };
}

type CountsRow = {
  note_id: string;
  total: number;
  new_count: number;
  fix_count: number;
  faster_count: number;
  member_reports: number;
};

/**
 * The items and tiles of one published note. Fail-open: a missing table (before
 * 0323 is applied) or a blip returns empty lists, and the page falls back to the
 * note's markdown.
 */
async function readLedger(
  supabase: ReturnType<typeof createAnonClient>,
  noteId: string,
): Promise<{ items: PatchNoteItem[]; figures: PatchNoteFigure[] }> {
  try {
    const [items, figures] = await Promise.all([
      supabase
        .from("patch_note_items")
        .select("merged_on, pr, area, type, title, detail, member_report, sort")
        .eq("note_id", noteId)
        .order("sort", { ascending: true })
        .limit(500),
      supabase
        .from("patch_note_figures")
        .select("key, value, label, detail")
        .eq("note_id", noteId)
        .order("sort", { ascending: true })
        .limit(24),
    ]);
    return {
      items: toItems((items.data ?? []) as ItemRow[]),
      figures: ((figures.data ?? []) as PatchNoteFigure[]).map((f) => ({ ...f, value: Number(f.value) })),
    };
  } catch {
    return { items: [], figures: [] };
  }
}

/** Published notes only, newest first. Safe on a public, signed-out page. */
export async function listPatchNotes(): Promise<PatchNote[]> {
  const fromFiles: PatchNote[] = fileSlugs()
    .map((s) => readFileNote(s))
    .filter((n): n is PatchNoteDetail => n !== null)
    .map((n) => ({
      slug: n.slug,
      title: n.title,
      summary: n.summary,
      published: n.published,
      source: n.source,
      counts: null,
    }));

  let fromDb: PatchNote[] = [];
  try {
    const supabase = createAnonClient();
    // RLS (patch_notes_select_published) already hides drafts from the anon
    // role; the explicit filter is defence in depth against a future policy
    // edit, not decoration.
    const { data } = await supabase
      .from("patch_notes")
      .select("id, slug, title, summary, published_on")
      .eq("status", "published")
      .order("published_on", { ascending: false })
      .limit(200);
    // One row per note that has ledger items (view in migration 0323). Its own
    // try: the list must still render if the view is missing or blinks.
    const counts = new Map<string, HeadlineCounts>();
    try {
      const { data: rows } = await supabase
        .from("patch_note_item_counts")
        .select("note_id, total, new_count, fix_count, faster_count, member_reports")
        .limit(1000);
      for (const r of (rows ?? []) as CountsRow[]) {
        counts.set(r.note_id, {
          total: r.total,
          new: r.new_count,
          fix: r.fix_count,
          faster: r.faster_count,
          memberReports: r.member_reports,
        });
      }
    } catch {
      // Cards render without counts.
    }
    fromDb = (data ?? []).map((r) => ({
      slug: r.slug as string,
      title: r.title as string,
      summary: (r.summary as string | null) ?? null,
      published: (r.published_on as string | null) ?? null,
      source: "db" as const,
      counts: counts.get(r.id as string) ?? null,
    }));
  } catch {
    // Fall through to files only.
  }

  const bySlug = new Map<string, PatchNote>();
  for (const n of fromFiles) bySlug.set(n.slug, n);
  for (const n of fromDb) bySlug.set(n.slug, n); // db wins

  return [...bySlug.values()].sort((a, b) => {
    if (!a.published) return 1;
    if (!b.published) return -1;
    return a.published < b.published ? 1 : a.published > b.published ? -1 : 0;
  });
}

/** One published note by slug, or null. Database first, then the file. */
export async function getPatchNote(slug: string): Promise<PatchNoteDetail | null> {
  // A slug reaches this function straight off the URL. Constrain it before it
  // touches the filesystem — `path.join` with "../../etc/passwd" would
  // otherwise escape NOTES_DIR.
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) return null;

  try {
    const supabase = createAnonClient();
    const { data } = await supabase
      .from("patch_notes")
      .select("id, slug, title, summary, body_md, published_on")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    if (data) {
      const ledger = await readLedger(supabase, data.id as string);
      return {
        ...ledger,
        slug: data.slug as string,
        title: data.title as string,
        summary: (data.summary as string | null) ?? null,
        published: (data.published_on as string | null) ?? null,
        bodyMd: data.body_md as string,
        source: "db",
      };
    }
  } catch {
    // Fall through to the file.
  }

  return readFileNote(slug);
}

/** Slugs that exist as files — the set that can still be prerendered. */
export function patchNoteFileSlugs(): string[] {
  return fileSlugs();
}
