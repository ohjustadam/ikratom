import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  findMainCheckout, gitBranch, isSharedPath, parseBashEvent, claimConflicts, prune, newForMe,
  renderUpdates, recallMatches, memoryDirFor, normPath, ACTIVE_MS,
} from "../scripts/lib/session-mesh-core.mjs";

/**
 * The session mesh (2026-10-17) keeps parallel iKratom Claude sessions in
 * sync through hooks. A hook that silently stops working looks exactly like a
 * quiet mesh, so the script itself is driven end to end here against a fake
 * main checkout + linked worktree, the way Claude Code calls it.
 */
function fakeRepo() {
  const root = mkdtempSync(join(tmpdir(), "mesh-"));
  const main = join(root, "ikratom");
  mkdirSync(join(main, ".git", "worktrees", "wt1"), { recursive: true });
  mkdirSync(join(main, "private"), { recursive: true });
  writeFileSync(join(main, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(main, ".git", "worktrees", "wt1", "HEAD"), "ref: refs/heads/feat/x\n");
  const wt = join(root, "ikratom-wt1");
  mkdirSync(join(wt, "src"), { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt1")}\n`);
  return { root, main, wt, mesh: join(root, "mesh") };
}
const fwd = (p: string) => p.replace(/\\/g, "/");

describe("core", () => {
  it("resolves the main checkout from itself, a subfolder and a linked worktree", () => {
    const r = fakeRepo();
    expect(fwd(findMainCheckout(r.main)!)).toBe(fwd(r.main));
    expect(fwd(findMainCheckout(join(r.wt, "src"))!)).toBe(fwd(r.main));
    expect(gitBranch(r.main)).toBe("main");
    expect(gitBranch(r.wt)).toBe("feat/x");
  });

  it("treats private/ and memory/ as shared, everything else as worktree-isolated", () => {
    const r = fakeRepo();
    expect(isSharedPath(join(r.main, "private", "OWNER_TODO.md"), r.main)).toBe(true);
    expect(isSharedPath("/home/u/.claude/projects/C--claude-ikratom/memory/MEMORY.md", r.main)).toBe(true);
    expect(isSharedPath(join(r.wt, "src", "page.tsx"), r.main)).toBe(false);
    expect(isSharedPath(join(r.main, "privateish.md"), r.main)).toBe(false);
  });

  it.each([
    ["gh pr merge 996 --squash", "merged"],
    ["cd /x && gh pr create --title \"fix: y\" --body z", "pr"],
    ["git add a && git commit -q -F - <<EOF", "commit"],
    ["WT=/x bash merge-loop.sh 996 997", "merging"],
    ['node -e \'fetch("https://api.netlify.com/api/v1/sites/abc/builds",{method:"POST"})\'', "deploy"],
    ["npm run db:push", "migration"],
  ])("journals %s as %s", (cmd, kind) => {
    expect(parseBashEvent(cmd, "https://github.com/o/r/pull/12")?.kind).toBe(kind);
  });

  it("ignores ordinary commands, dry runs and its own CLI", () => {
    for (const c of ["ls -la", "git status", "git commit --dry-run", "node scripts/session-mesh.mjs say x", "gh pr view 3"])
      expect(parseBashEvent(c)).toBeNull();
  });

  it("only active, unlapsed claims conflict, and pruning drops the dead", () => {
    const now = Date.now();
    const iso = (ms: number) => new Date(now - ms).toISOString();
    const key = normPath("/repo/private/OWNER_TODO.md", "linux");
    const state = {
      trunk: "gone",
      sessions: {
        a: { id: "a", last_seen: iso(0), claims: { [key]: { at: iso(0) } } },
        b: { id: "b", last_seen: iso(ACTIVE_MS + 1000), claims: { [key]: { at: iso(0) } } },
        gone: { id: "gone", last_seen: iso(8 * 86400e3), claims: {} },
      },
    };
    const hits = claimConflicts(state, "me", "/repo/private/OWNER_TODO.md", now, "linux");
    expect(hits.map((h: { session: { id: string } }) => h.session.id)).toEqual(["a"]);
    prune(state, now);
    expect(Object.keys(state.sessions)).toEqual(["a", "b"]);
    expect(state.trunk).toBeNull();
  });

  it("shows a session only other sessions' entries, newer than its cursor", () => {
    const entries = [{ n: 1, sid: "a", ts: new Date().toISOString(), kind: "x", text: "one" }, { n: 2, sid: "me", ts: new Date().toISOString(), kind: "x", text: "mine" }, { n: 3, sid: "a", ts: new Date().toISOString(), kind: "x", text: "three" }];
    const fresh = newForMe(entries, { id: "me", cursor: 1 });
    expect(fresh.map((e: { n: number }) => e.n)).toEqual([3]);
    expect(renderUpdates(fresh)).toMatch(/1 update from other sessions/);
    expect(renderUpdates([])).toBeNull();
  });

  it("recall ranks lines by how many terms they match", () => {
    const hits = recallMatches([{ source: "a.md", text: "egress cap\nnothing\negress gate cap reset" }], ["egress", "cap", "reset"]);
    expect(hits[0].source).toBe("a.md:3");
    expect(hits).toHaveLength(2);
  });

  it("keys the auto-memory folder by the sanitised project path", () => {
    expect(memoryDirFor("C:/claude/ikratom", "/h")).toBe("/h/.claude/projects/C--claude-ikratom/memory");
  });
});

describe("the script, driven like Claude Code drives it", () => {
  const SCRIPT = new URL("../scripts/session-mesh.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  let r: ReturnType<typeof fakeRepo>;
  const env = () => ({ ...process.env, SESSION_MESH_DIR: r.mesh, SESSION_MESH_OFFLINE: "1" });
  const hook = (event: string, payload: object) => {
    const res = spawnSync(process.execPath, [SCRIPT, event], { input: JSON.stringify(payload), env: env(), encoding: "utf8", timeout: 20000 });
    expect(res.status).toBe(0);
    return res.stdout ? JSON.parse(res.stdout) : null;
  };
  const cli = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: env(), encoding: "utf8", timeout: 20000 }).stdout;

  beforeEach(() => { r = fakeRepo(); });

  it("start → broadcast → the other session hears it once", () => {
    const a = hook("session-start", { session_id: "aaaa1111", cwd: r.main });
    expect(a.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(a.hookSpecificOutput.additionalContext).toMatch(/you are session aaaa11/);
    const b = hook("session-start", { session_id: "bbbb2222", cwd: r.wt });
    expect(b.hookSpecificOutput.additionalContext).toMatch(/Active sessions \(1\)/);

    expect(cli(r.main, "trunk", "--as", "aaaa")).toMatch(/aaaa11 is the trunk/);
    expect(cli(r.main, "say", "--kind", "decision", "owner chose X", "--as", "aaaa")).toMatch(/journaled/);

    const upd = hook("prompt", { session_id: "bbbb2222", cwd: r.wt });
    expect(upd.hookSpecificOutput.additionalContext).toMatch(/decision: owner chose X/);
    expect(hook("prompt", { session_id: "bbbb2222", cwd: r.wt })).toBeNull(); // quiet next turn
    // The trunk's own broadcasts are not echoed back to it.
    expect(hook("prompt", { session_id: "aaaa1111", cwd: r.main })).toBeNull();
  });

  it("an edit to a shared file claims it, and a peer is warned (never blocked)", () => {
    hook("session-start", { session_id: "aaaa1111", cwd: r.main });
    hook("session-start", { session_id: "bbbb2222", cwd: r.wt });
    const file = join(r.main, "private", "OWNER_TODO.md");
    expect(hook("pre-edit", { session_id: "aaaa1111", cwd: r.main, tool_input: { file_path: file } })).toBeNull();
    const warn = hook("pre-edit", { session_id: "bbbb2222", cwd: r.wt, tool_input: { file_path: fwd(file) } });
    expect(warn.systemMessage).toMatch(/also held by active session aaaa11/);
    expect(warn.hookSpecificOutput.permissionDecision).toBeUndefined();
    // Ending the session releases its claim.
    hook("session-end", { session_id: "aaaa1111", cwd: r.main });
    expect(hook("pre-edit", { session_id: "bbbb2222", cwd: r.wt, tool_input: { file_path: file } })).toBeNull();
    // A tracked file in a worktree is not the mesh's business.
    expect(hook("pre-edit", { session_id: "bbbb2222", cwd: r.wt, tool_input: { file_path: join(r.wt, "src", "a.ts") } })).toBeNull();
  });

  it("merges and PRs journal themselves from PostToolUse", () => {
    hook("session-start", { session_id: "aaaa1111", cwd: r.main });
    hook("session-start", { session_id: "bbbb2222", cwd: r.wt });
    hook("post-bash", { session_id: "bbbb2222", cwd: r.wt, tool_input: { command: "gh pr merge 42 --squash" }, tool_response: { stdout: "" } });
    hook("post-bash", { session_id: "bbbb2222", cwd: r.wt, tool_input: { command: "ls" }, tool_response: { stdout: "" } });
    const lines = readFileSync(join(r.mesh, "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((e) => e.kind)).toEqual(["merged"]);
    expect(hook("prompt", { session_id: "aaaa1111", cwd: r.main }).hookSpecificOutput.additionalContext).toMatch(/PR #42 merged/);
  });

  it("does nothing outside a checkout with private/, and never fails", () => {
    const res = spawnSync(process.execPath, [SCRIPT, "session-start"], {
      input: JSON.stringify({ session_id: "x", cwd: tmpdir() }),
      env: { ...process.env, SESSION_MESH_DIR: "" }, encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    const bad = spawnSync(process.execPath, [SCRIPT, "prompt"], { input: "not json", env: env(), encoding: "utf8" });
    expect(bad.status).toBe(0);
  });
});

describe("wiring", () => {
  const settings = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"));
  it.each([
    ["SessionStart", "session-start"], ["UserPromptSubmit", "prompt"], ["PreToolUse", "pre-edit"],
    ["PostToolUse", "post-bash"], ["SessionEnd", "session-end"],
  ])("%s runs the mesh's %s hook", (event, sub) => {
    const cmds = settings.hooks[event].flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks.map((h) => h.command));
    expect(cmds.some((c: string) => c.includes("scripts/session-mesh.mjs") && c.includes(` ${sub}`))).toBe(true);
  });
  it("the post-bash pre-filter lets every journaled command through", () => {
    const cmd: string = settings.hooks.PostToolUse[0].hooks[0].command;
    for (const needle of ["pr merge", "pr create", "commit", "merge-loop", "netlify.com", "db:push"]) expect(cmd).toContain(needle);
    expect(settings.hooks.PostToolUse[0].hooks[0].async).toBe(true);
  });
  it(".claude/settings.json is committed, the rest of .claude/ is not", () => {
    const gi = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
    expect(gi).toMatch(/^\.claude\/\*$/m);
    expect(gi).toMatch(/^!\.claude\/settings\.json$/m);
  });
});
