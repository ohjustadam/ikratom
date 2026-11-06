import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { REGISTRY } from "../scripts/lib/cron-pager-registry.mjs";
import { EXPECTED_INTERVAL_HOURS } from "../src/lib/cron-expectations";

/**
 * Publishing a patch note must never require a deploy again, and a push to
 * every member must never go out on its own.
 *
 * The changelog went stale for three weeks because saying what changed cost a
 * 15-credit Netlify build: notes lived in src/content/patch-notes/*.md, and
 * netlify.toml's build `ignore` only skips TOP-LEVEL markdown
 * (`:(exclude,glob)*.md` — git's glob magic stops `*` at a `/`). Seven bot
 * drafts queued unmerged because merging was the expensive option.
 *
 * The push half came later. A Sunday job in cron-weekly.yml pushed the newest
 * FILE note to every member. Once notes moved to the database it never saw a new
 * one, and it kept sending the 2026-10-08 note to each new member until
 * 2026-11-05, while auto-weekly-update.yml said pushes were never automated.
 *
 * These are guards on the shape of the fix, not on its internals.
 */

const ROOT = join(__dirname, "..");
const WF_DIR = join(ROOT, ".github", "workflows");

describe.each(["auto-patch-notes.yml", "auto-weekly-update.yml"])("%s publishes without a deploy", (file) => {
  const wf = readFileSync(join(WF_DIR, file), "utf8");

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

/**
 * The commands in a workflow that would really send a push. A comment does not
 * run and --dry-run sends nothing, so neither counts.
 */
function sendingCommands(yamlText: string): string[] {
  const wf = load(yamlText) as {
    jobs?: Record<string, { steps?: Array<{ run?: unknown }> }>;
  } | null;
  const found: string[] = [];
  for (const job of Object.values(wf?.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (typeof step.run !== "string") continue;
      // Join `\` continuations first, or a --dry-run on the next line goes unseen.
      for (const line of step.run.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
        if (line.trim().startsWith("#")) continue;
        if (line.includes("broadcast-whats-new.mjs") && !line.includes("--dry-run")) {
          found.push(line.trim());
        }
      }
    }
  }
  return found;
}

describe("a push to every member never goes out on its own", () => {
  const workflows = readdirSync(WF_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((file) => ({ file, raw: readFileSync(join(WF_DIR, file), "utf8") }));

  it("the scan reads the real workflows", () => {
    expect(workflows.length).toBeGreaterThan(10);
    expect(workflows.map((w) => w.file)).toContain("cron-weekly.yml");
  });

  it("the scan catches the job that caused this", () => {
    const step = (run: string) => `jobs:\n  a:\n    steps:\n      - run: ${run}\n`;
    const old =
      "node --import=./scripts/lib/egress-meter.mjs scripts/broadcast-whats-new.mjs --slug x --all-users";

    expect(sendingCommands(step(old))).toHaveLength(1);
    expect(sendingCommands(step(`${old} --dry-run`))).toEqual([]);
    expect(sendingCommands(step("|\n          # broadcast-whats-new.mjs\n          true"))).toEqual([]);
    expect(
      sendingCommands(step("|\n          node scripts/broadcast-whats-new.mjs \\\n            --all-users")),
    ).toHaveLength(1);
    expect(
      sendingCommands(step("|\n          node scripts/broadcast-whats-new.mjs \\\n            --dry-run")),
    ).toEqual([]);
  });

  it("no workflow sends one, on any trigger", () => {
    // Every workflow, not just scheduled ones. A manual-only workflow is still on
    // a clock if pg_cron dispatches it (migration 0263), and cron-weekly.yml is
    // one click from /admin/console. If the owner ever wants a push button in CI,
    // that is a decision to make here, in the diff.
    const senders = workflows.flatMap(({ file, raw }) =>
      sendingCommands(raw).map((cmd) => `${file}: ${cmd}`),
    );
    expect(senders).toEqual([]);
  });

  it("a push is not watched as if it were a cron", () => {
    // It runs when the owner approves one, so a quiet month is healthy. Watching
    // it pages the owner about a job that is working, as egress_gate once did.
    expect(REGISTRY.map((e: { source: string }) => e.source)).not.toContain("broadcast_whats_new");
    expect(Object.keys(EXPECTED_INTERVAL_HOURS)).not.toContain("broadcast_whats_new");
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
