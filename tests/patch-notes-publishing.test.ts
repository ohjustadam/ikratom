import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Publishing a patch note must never require a deploy again.
 *
 * The changelog went stale for three weeks because saying what changed cost a
 * 15-credit Netlify build: notes lived in src/content/patch-notes/*.md, and
 * netlify.toml's build `ignore` only skips TOP-LEVEL markdown
 * (`:(exclude,glob)*.md` — git's glob magic stops `*` at a `/`). Seven bot
 * drafts queued unmerged because merging was the expensive option.
 *
 * These are guards on the shape of the fix, not on its internals.
 */

const ROOT = join(__dirname, "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "auto-patch-notes.yml");

describe("the daily patch-note job publishes without a deploy", () => {
  const wf = readFileSync(WORKFLOW, "utf8");

  it("writes to the database", () => {
    expect(wf).toMatch(/generate-patch-note\.mjs .*--db/);
  });

  it("does not open a pull request", () => {
    // A PR here is a merge, and a merge is a production build. If this ever
    // comes back, the stale-changelog failure comes back with it.
    expect(wf).not.toMatch(/gh pr create/);
    expect(wf).not.toMatch(/git push/);
  });

  it("does not ask for write permissions it no longer needs", () => {
    // Line-anchored: the file's own comments mention these keys by name.
    expect(wf).not.toMatch(/^\s+pull-requests:\s*write\s*$/m);
    expect(wf).not.toMatch(/^\s+contents:\s*write\s*$/m);
  });

  it("is registered with the self-pager", () => {
    const registry = readFileSync(
      join(ROOT, "scripts", "lib", "cron-pager-registry.mjs"),
      "utf8",
    );
    expect(registry).toMatch(/source:\s*"patch_note_draft"/);
  });
});

describe("drafts cannot reach the public page on their own", () => {
  const migration = readdirSync(join(ROOT, "supabase", "migrations"))
    .filter((f) => /patch_notes/.test(f))
    .sort()
    .pop();

  it("the migration exists", () => {
    expect(migration).toBeTruthy();
  });

  const sql = readFileSync(join(ROOT, "supabase", "migrations", migration!), "utf8");

  it("public SELECT is limited to published rows", () => {
    expect(sql).toMatch(/FOR SELECT TO public[\s\S]{0,120}status = 'published'/);
  });

  it("rows default to draft", () => {
    expect(sql).toMatch(/status\s+text NOT NULL DEFAULT 'draft'/);
  });

  it("the generator only ever writes drafts", () => {
    const gen = readFileSync(join(ROOT, "scripts", "generate-patch-note.mjs"), "utf8");
    expect(gen).toMatch(/status:\s*"draft"/);
    expect(gen).not.toMatch(/status:\s*"published"/);
  });

  it("the generator refuses to overwrite a curated note", () => {
    const gen = readFileSync(join(ROOT, "scripts", "generate-patch-note.mjs"), "utf8");
    expect(gen).toMatch(/existing\.status !== "draft"/);
  });
});

describe("the public reader rejects a hostile slug before touching disk", () => {
  it("constrains the slug", () => {
    const lib = readFileSync(join(ROOT, "src", "lib", "patch-notes.ts"), "utf8");
    const m = /\/\^\[a-z0-9\]\[a-z0-9-\]\{0,80\}\$\//.exec(lib);
    expect(m, "patch-notes.ts must validate the slug before path.join").not.toBeNull();

    const re = /^[a-z0-9][a-z0-9-]{0,80}$/;
    expect(re.test("2026-09-17-update")).toBe(true);
    expect(re.test("../../../etc/passwd")).toBe(false);
    expect(re.test("..")).toBe(false);
    expect(re.test("a/b")).toBe(false);
  });
});
