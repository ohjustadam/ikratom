#!/usr/bin/env node
/**
 * parallel-guard.mjs — preflight for a repo that may have MORE THAN ONE
 * Claude session working in it.
 *
 * WHY THIS EXISTS
 * Two sessions in one checkout share ONE `.git/index` and ONE `HEAD`. Three
 * distinct ways that has already bitten this repo:
 *
 *   1. PR #608 (2026-06-14) merged with 7 files instead of 2 — a `git commit`
 *      swept in files the other session had staged.
 *   2. 2026-08-25: a peer was mid-edit in the SAME FILE. AGENTS.md rule 8 says
 *      commit with an explicit pathspec, but `git commit -- <path>` commits
 *      WORKING-TREE content, so the pathspec does not save you here — it would
 *      have committed their half-finished feature referencing a module they had
 *      not committed yet. A broken build, in a batch queued to deploy.
 *   3. An abandoned worktree under .claude/worktrees/ kept a stale .next/, and
 *      `npm run lint` walked it: 18,583 problems in generated code, so
 *      `verify:full` failed locally while CI stayed green.
 *
 * COMMANDS
 *   status                 report worktrees, index, HEAD, dirty paths
 *   check [--paths a b]    exit 1 if committing those paths is hazardous
 *   snapshot / verify      catch HEAD moving under you (peer committed mid-task)
 *
 * Exit codes: 0 = safe, 1 = hazard (read the remedy it prints), 2 = usage.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();

/**
 * Same, but WITHOUT trimming. `git status --porcelain` encodes state in the
 * first two columns, so a leading space is data: " M .gitignore". Trimming the
 * buffer eats the first line's leading space and shifts the path by one — which
 * silently turned ".gitignore" into "gitignore" and made --paths matching miss
 * every dotfile. Parse status output with this, never with git().
 */
const gitRaw = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "status";
const pathsIdx = argv.indexOf("--paths");
const paths = pathsIdx >= 0 ? argv.slice(pathsIdx + 1).filter((a) => !a.startsWith("--")) : [];
const JSON_OUT = argv.includes("--json");

const root = git("rev-parse", "--show-toplevel");
const SNAP = join(root, ".git", "parallel-guard.json");

/** Every worktree attached to this repo, with staleness signals. */
function worktrees() {
  const out = [];
  let cur = {};
  for (const line of git("worktree", "list", "--porcelain").split("\n")) {
    const l = line.trim();
    if (l.startsWith("worktree ")) cur = { path: l.slice(9) };
    else if (l.startsWith("HEAD ")) cur.head = l.slice(5, 12);
    else if (l.startsWith("branch ")) cur.branch = l.slice(7).replace("refs/heads/", "");
    else if (l === "detached") cur.branch = "(detached)";
    else if (l === "") { if (cur.path) out.push(cur); cur = {}; }
  }
  if (cur.path) out.push(cur);
  const self = root.replace(/\\/g, "/");
  for (const w of out) {
    w.isSelf = w.path.replace(/\\/g, "/") === self;
    // A worktree nobody has touched in >12h is very likely abandoned.
    try {
      w.ageHours = Math.round((Date.now() - statSync(join(w.path, ".git")).mtimeMs) / 3.6e6);
    } catch { w.ageHours = null; }
  }
  return out;
}

/** Anything already staged is, by definition, not ours to commit. */
const stagedFiles = () => git("diff", "--cached", "--name-only").split("\n").filter(Boolean);
const dirtyFiles = () =>
  gitRaw("status", "--porcelain").split("\n").filter((l) => l.length > 3).map((l) => ({
    status: l.slice(0, 2).trim(),
    // Rename entries read "R  old -> new"; the committable path is the new one.
    path: l.slice(3).replace(/\r$/, "").replace(/^"|"$/g, "").split(" -> ").pop(),
  }));

function report() {
  return {
    head: git("rev-parse", "--short", "HEAD"),
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    worktrees: worktrees(),
    staged: stagedFiles(),
    dirty: dirtyFiles(),
  };
}

function printReport(r) {
  console.log("-- parallel-guard ---------------------------------------");
  console.log(`  HEAD        ${r.head} on ${r.branch}`);
  console.log(`  worktrees   ${r.worktrees.length}`);
  for (const w of r.worktrees) {
    const tag = w.isSelf ? "self" : "PEER";
    const age = w.ageHours == null ? "" : `, touched ${w.ageHours}h ago`;
    console.log(`    [${tag}] ${w.path}  @${w.head} ${w.branch}${age}`);
  }
  console.log(`  staged      ${r.staged.length === 0 ? "(clean)" : r.staged.join(", ")}`);
  console.log(`  dirty       ${r.dirty.length === 0 ? "(clean)" : r.dirty.map((d) => `${d.status} ${d.path}`).join(", ")}`);
}

const STAGE_RECIPE = [
  "Stage only YOUR version, leaving their working-tree edits alone:",
  "        git show HEAD:<path> > mine.tmp     # re-apply ONLY your edits to this copy",
  "        blob=$(git hash-object -w --path <path> mine.tmp)",
  "        git update-index --cacheinfo 100644,$blob,<path>",
  "        git diff --cached --name-only        # confirm, then `git commit` with NO pathspec",
].join("\n        ");

/**
 * Hazards block; warnings inform.
 *
 * The split matters. A tool that flags your OWN dirty files as a peer hazard
 * every single run teaches people to ignore it, and then it is worth nothing on
 * the day it is right. So a dirty target file is only a HAZARD when there is
 * actual evidence of another session (a peer worktree, or files in the index
 * that you did not stage); otherwise it is a warning.
 *
 * Caveat worth knowing: a peer session can share this very checkout WITHOUT a
 * separate worktree — that is exactly what happened on 2026-08-25 — and nothing
 * in git can detect that. If you know a peer is live, run with --strict, which
 * promotes every warning to a hazard.
 */
function check(targetPaths, { strict = false } = {}) {
  const r = report();
  const hazards = [];
  const warnings = [];

  const foreign = r.staged.filter((f) => !targetPaths.includes(f));
  if (foreign.length) {
    hazards.push({
      kind: "foreign-staged",
      detail: `Index already holds ${foreign.length} file(s) you did not stage: ${foreign.join(", ")}`,
      remedy: "Another session staged these. Do NOT `git commit` — it commits the WHOLE index. Wait, or coordinate.",
    });
  }

  const peerWorktrees = r.worktrees.filter((w) => !w.isSelf);
  const peerEvidence = peerWorktrees.length > 0 || foreign.length > 0;

  // The rule-8 blind spot: your target file is ALSO dirty from someone else.
  for (const p of targetPaths) {
    const d = r.dirty.find((x) => x.path === p);
    if (d && d.status.includes("M")) {
      const item = {
        kind: "shared-file-dirty",
        detail: `${p} has uncommitted working-tree changes.`,
        remedy: peerEvidence || strict
          ? `A peer may own some of those edits. \`git commit -- ${p}\` WILL include them. ${STAGE_RECIPE}`
          : `Presumed yours (no peer worktree, clean index). If a peer session shares this checkout, re-run with --strict.`,
      };
      (peerEvidence || strict ? hazards : warnings).push(item);
    }
  }

  for (const w of peerWorktrees) {
    if (w.ageHours != null && w.ageHours > 12) {
      warnings.push({
        kind: "stale-worktree",
        detail: `${w.path} untouched for ${w.ageHours}h — likely abandoned.`,
        remedy:
          "Its stale .next/ would break `npm run lint` (already ignored in eslint.config.mjs).\n" +
          "      To remove it safely, FIRST list every reparse point in the worktree — the junction\n" +
          "      is often NESTED, not the top-level node_modules (checking only the top level is what\n" +
          "      emptied packages in the MAIN node_modules on 2026-08-25, and `npm ci` was the fix):\n" +
          "        Get-ChildItem <wt> -Recurse -Force -Attributes ReparsePoint | ForEach-Object { $_.Delete() }\n" +
          "      THEN `git worktree remove --force <wt>`, and afterwards prove the main install is intact:\n" +
          "        node -e \"require.resolve('require-in-the-middle')\" && npm run verify\n" +
          "      If anything fails to resolve, run `npm ci` — emptied package dirs still count as entries,\n" +
          "      so a node_modules entry-count comparison does NOT prove the install survived.",
      });
    } else {
      hazards.push({
        kind: "active-peer-worktree",
        detail: `${w.path} was touched ${w.ageHours}h ago — a session may be live in it.`,
        remedy: "Branch from origin/main, and verify `gh pr view <n> --json files` before merging.",
      });
    }
  }
  return { report: r, hazards, warnings };
}

if (cmd === "snapshot") {
  writeFileSync(SNAP, JSON.stringify({ head: git("rev-parse", "HEAD"), at: Date.now() }, null, 2));
  console.log(`parallel-guard: snapshot at ${git("rev-parse", "--short", "HEAD")}`);
  process.exit(0);
}

if (cmd === "verify") {
  if (!existsSync(SNAP)) {
    console.error("parallel-guard: no snapshot — run `snapshot` first.");
    process.exit(2);
  }
  const snap = JSON.parse(readFileSync(SNAP, "utf8"));
  const now = git("rev-parse", "HEAD");
  if (snap.head !== now) {
    console.error("x HEAD MOVED since snapshot — a peer session committed while you worked.");
    console.error(`  was ${snap.head.slice(0, 7)} -> now ${now.slice(0, 7)}`);
    console.error("  Do NOT `git commit --amend` — you would rewrite THEIR commit.");
    console.error("  Confirm your edits survived:  git show HEAD:<path> | grep -c <your-symbol>");
    process.exit(1);
  }
  console.log(`ok HEAD unchanged (${now.slice(0, 7)}) — safe to amend/commit.`);
  process.exit(0);
}

if (cmd === "status") {
  const r = report();
  if (JSON_OUT) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  printReport(r);
  process.exit(0);
}

if (cmd === "check") {
  const strict = argv.includes("--strict");
  const { report: r, hazards, warnings } = check(paths, { strict });
  if (JSON_OUT) {
    console.log(JSON.stringify({ ...r, hazards, warnings }, null, 2));
    process.exit(hazards.length ? 1 : 0);
  }
  printReport(r);
  for (const w of warnings) console.log(`\n  ! [${w.kind}] ${w.detail}\n    -> ${w.remedy}`);
  if (!hazards.length) {
    const tail = warnings.length ? ` (${warnings.length} warning(s) above)` : "";
    console.log(`\nok No blocking parallel-session hazards${tail}. Safe to commit.`);
    process.exit(0);
  }
  console.log(`\nx ${hazards.length} hazard(s):`);
  for (const h of hazards) console.log(`\n  [${h.kind}] ${h.detail}\n    -> ${h.remedy}`);
  process.exit(1);
}

console.error(`parallel-guard: unknown command "${cmd}" (status|check|snapshot|verify)`);
process.exit(2);
