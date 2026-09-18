import "server-only";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { createClient } from "@/lib/supabase/server";
import { frontmatterString } from "@/lib/frontmatter";

/**
 * One reader for /whats-new, over two sources.
 *
 * The 40 notes published before 2026-09-17 are markdown files in
 * src/content/patch-notes/ and stay there — they are already indexed and
 * their URLs are permanent. Everything published from now on is a row in
 * `patch_notes` (migration 0250), because a file needs a deploy and a row
 * does not.
 *
 * Both sources produce the same shape. On a slug collision the database wins,
 * so a file-era note can be corrected without touching the repo.
 *
 * FAIL-OPEN: if Supabase is unreachable or unconfigured, the file
 * back-catalogue still renders. A changelog that 500s because the database
 * blinked is worse than a changelog missing its newest entry.
 */

export type PatchNote = {
  slug: string;
  title: string;
  summary: string | null;
  published: string | null;
  totalCommits: number | null;
  source: "db" | "file";
};

export type PatchNoteDetail = PatchNote & { bodyMd: string };

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
    totalCommits: typeof data.total_commits === "number" ? data.total_commits : null,
    bodyMd: content,
    source: "file",
  };
}

/** Published notes only, newest first. Safe on a public, signed-out page. */
export async function listPatchNotes(): Promise<PatchNote[]> {
  const fromFiles: PatchNote[] = fileSlugs()
    .map((s) => readFileNote(s))
    .filter((n): n is PatchNoteDetail => n !== null)
    .map(({ bodyMd: _bodyMd, ...rest }) => rest);

  let fromDb: PatchNote[] = [];
  try {
    const supabase = await createClient();
    // RLS (patch_notes_select_published) already hides drafts; the explicit
    // filter is defence in depth, not decoration — an admin viewing this page
    // passes the admin policy and would otherwise see their own drafts on the
    // PUBLIC changelog.
    const { data } = await supabase
      .from("patch_notes")
      .select("slug, title, summary, published_on, total_commits")
      .eq("status", "published")
      .order("published_on", { ascending: false })
      .limit(200);
    fromDb = (data ?? []).map((r) => ({
      slug: r.slug as string,
      title: r.title as string,
      summary: (r.summary as string | null) ?? null,
      published: (r.published_on as string | null) ?? null,
      totalCommits: (r.total_commits as number | null) ?? null,
      source: "db" as const,
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
    const supabase = await createClient();
    const { data } = await supabase
      .from("patch_notes")
      .select("slug, title, summary, body_md, published_on, total_commits")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    if (data) {
      return {
        slug: data.slug as string,
        title: data.title as string,
        summary: (data.summary as string | null) ?? null,
        published: (data.published_on as string | null) ?? null,
        totalCommits: (data.total_commits as number | null) ?? null,
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
