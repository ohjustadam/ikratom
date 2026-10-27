#!/usr/bin/env node
/**
 * session-mesh.mjs — one short-term memory for every iKratom Claude session.
 *
 * State lives in <main checkout>/private/mesh/ (gitignored, shared by every
 * worktree; resolved from any worktree via its .git pointer):
 *   sessions.json  registry: who is live, where, on what, holding which files
 *   journal.jsonl  append-only log: merges, PRs, commits, deploys, decisions
 *
 * HOOKS (.claude/settings.json, so every checkout and worktree gets them):
 *   session-start  register; print who's live + the last 48 h of journal
 *   prompt         before every prompt: print what OTHER sessions journaled
 *                  since this session's last turn (nothing when quiet)
 *   pre-edit       editing a shared file (private/, memory/) claims it; warns
 *                  when an active peer already holds it. Never blocks.
 *   post-bash      gh pr merge / gh pr create / git commit / deploy / db:push
 *                  journal themselves (async: adds no latency)
 *   session-end    release this session's claims
 *
 * CLI (sessions and the owner):
 *   node scripts/session-mesh.mjs [status]
 *   ... task "<what I'm doing>"            [--as <id>]
 *   ... say [--kind decision|finding|handoff|owner|note] "<text>" [--as <id>]
 *   ... claim <path> | release <path|--all> [--as <id>]
 *   ... trunk [--clear] [--as <id>]        take (or drop) the coordinating role
 *   ... log [N] | recall <words...> | whoami
 *   ... reserve-migration "<what it's for>" [--as <id>]   prints the next free
 *                  migration number and journals the reservation, under the lock
 *
 * A hook must never break a session: every path is wrapped, and it always
 * exits 0. Outside iKratom, or with no private/ (a fresh clone, a cloud
 * session), it does nothing. SESSION_MESH_DIR overrides the state dir (tests).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  ACTIVE_MS, claimConflicts, findMainCheckout, gitBranch, isActive, isSharedPath, labelOf, memoryDirFor,
  newForMe, nextMigrationNumber, normPath, parseBashEvent, prune, recallMatches, renderStart, renderUpdates, shortId, entryLine,
} from "./lib/session-mesh-core.mjs";

/** Migration file names in the main checkout, every worktree, and origin/main. */
function migrationFiles(main) {
  const names = [];
  const add = (d) => { try { names.push(...readdirSync(join(d, "supabase", "migrations"))); } catch { /* none here */ } };
  add(main);
  try {
    const out = execFileSync("git", ["-C", main, "worktree", "list", "--porcelain"], { encoding: "utf8", timeout: 4000 });
    for (const line of out.split(/\r?\n/)) if (line.startsWith("worktree ")) add(line.slice(9).trim());
  } catch { /* not a git checkout */ }
  try {
    const out = execFileSync("git", ["-C", main, "ls-tree", "--name-only", "origin/main", "supabase/migrations/"], { encoding: "utf8", timeout: 4000 });
    names.push(...out.split(/\r?\n/).map((p) => p.split("/").pop()));
  } catch { /* no remote ref */ }
  return names;
}

const HOOKS = new Set(["session-start", "prompt", "pre-edit", "post-bash", "session-end"]);
const [cmd = "status", ...argv] = process.argv.slice(2);

function opt(name) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  argv.splice(i, v && !v.startsWith("--") ? 2 : 1);
  return v && !v.startsWith("--") ? v : true;
}

function readStdin() {
  try {
    if (process.stdin.isTTY) return {};
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function meshDirFor(cwd) {
  if (process.env.SESSION_MESH_DIR) return process.env.SESSION_MESH_DIR.replace(/\\/g, "/");
  const main = findMainCheckout(cwd);
  if (!main || !existsSync(join(main, "private"))) return null;
  return `${main}/private/mesh`;
}

// ── state, under a mkdir lock (atomic on every OS) ──────────────────────────
function withLock(dir, fn) {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, ".lock");
  for (let i = 0; i < 60; i++) {
    try { mkdirSync(lock); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 5000) rmSync(lock, { recursive: true, force: true }); } catch { /* raced */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try { return fn(); } finally { try { rmSync(lock, { recursive: true, force: true }); } catch { /* gone */ } }
}

function loadState(dir) {
  try { return JSON.parse(readFileSync(join(dir, "sessions.json"), "utf8")); } catch { return { seq: 0, trunk: null, sessions: {} }; }
}
function saveState(dir, state) {
  const f = join(dir, "sessions.json");
  writeFileSync(`${f}.tmp`, JSON.stringify(state, null, 1));
  renameSync(`${f}.tmp`, f);
}
function loadJournal(dir, max = 3000) {
  try {
    const lines = readFileSync(join(dir, "journal.jsonl"), "utf8").split("\n").filter(Boolean);
    return lines.slice(-max).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function append(dir, state, sid, kind, text, extra = {}) {
  state.seq = Number(state.seq ?? 0) + 1;
  const e = { n: state.seq, ts: new Date().toISOString(), sid, kind, text: String(text).slice(0, 600), ...extra };
  appendFileSync(join(dir, "journal.jsonl"), `${JSON.stringify(e)}\n`);
  if (state.sessions?.[sid]) state.sessions[sid].cursor = Math.max(Number(state.sessions[sid].cursor ?? 0), e.n);
  return e;
}

function touch(state, sid, cwd) {
  const now = new Date().toISOString();
  const s = (state.sessions[sid] ??= { id: sid, started: now, claims: {}, cursor: Number(state.seq ?? 0) });
  s.cwd = (cwd ?? s.cwd ?? "").replace(/\\/g, "/");
  s.branch = gitBranch(s.cwd) ?? s.branch ?? null;
  s.last_seen = now;
  delete s.ended;
  s.claims ??= {};
  return s;
}

/** CLI identity: --as <prefix>, else the most recently seen active session in this cwd, else any. */
function resolveMe(state, cwd) {
  const as = opt("as");
  const all = Object.values(state.sessions ?? {});
  if (typeof as === "string") {
    const hit = all.find((s) => s.id === as) ?? all.find((s) => s.id.startsWith(as));
    if (hit) return hit;
  }
  const here = normPath(cwd);
  const pick = (xs) => xs.sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen))[0];
  return pick(all.filter((s) => isActive(s) && normPath(s.cwd) === here)) ?? pick(all.filter((s) => isActive(s))) ?? null;
}

const emit = (event, text) => {
  if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
};

// ── hooks ────────────────────────────────────────────────────────────────────
function runHook(name) {
  const input = readStdin();
  const cwd = input.cwd ?? process.cwd();
  const sid = input.session_id;
  const dir = meshDirFor(cwd);
  if (!dir || !sid) return;
  const main = findMainCheckout(cwd);

  if (name === "session-start") {
    const out = withLock(dir, () => {
      const state = prune(loadState(dir));
      const me = touch(state, sid, cwd);
      const entries = loadJournal(dir);
      me.cursor = Math.max(Number(me.cursor ?? 0), Number(state.seq ?? 0));
      saveState(dir, state);
      const mine = memoryDirFor(cwd), shared = memoryDirFor(main);
      const hint = normPath(mine) !== normPath(shared)
        ? `This checkout's auto-memory folder is separate from the project's. The shared long-term memory index is ${shared}/MEMORY.md — read it before relying on what you remember.`
        : null;
      return renderStart({ me, state, entries, mainDir: main, memoryHint: hint, meshDir: dir });
    });
    return emit("SessionStart", out);
  }

  if (name === "prompt") {
    const out = withLock(dir, () => {
      const state = loadState(dir);
      const me = touch(state, sid, cwd);
      const fresh = newForMe(loadJournal(dir), me);
      me.cursor = Math.max(Number(me.cursor ?? 0), Number(state.seq ?? 0));
      saveState(dir, state);
      return renderUpdates(fresh);
    });
    return emit("UserPromptSubmit", out);
  }

  if (name === "pre-edit") {
    const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (!isSharedPath(file, main)) return;
    const warn = withLock(dir, () => {
      const state = loadState(dir);
      const me = touch(state, sid, cwd);
      const conflicts = claimConflicts(state, sid, file);
      me.claims[normPath(file)] = { at: new Date().toISOString() };
      saveState(dir, state);
      if (!conflicts.length) return null;
      const who = conflicts.map(({ session: s, claim: c }) => `${shortId(s.id)} ${labelOf(s)} (since ${c.at.slice(11, 16)}Z${state.trunk === s.id ? ", the TRUNK" : ""})`).join("; ");
      return `⚠ ${file} is also held by active session ${who}. Coordinate before writing: message it (ListAgents + SendMessage), or keep your change to a separate section and say so with \`node scripts/session-mesh.mjs say\`.`;
    });
    if (warn) process.stdout.write(JSON.stringify({ systemMessage: warn, hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: warn } }));
    return;
  }

  if (name === "post-bash") {
    const command = input.tool_input?.command ?? "";
    const stdout = typeof input.tool_response === "string" ? input.tool_response : (input.tool_response?.stdout ?? "");
    const ev = parseBashEvent(command, stdout);
    if (!ev) return;
    if (ev.kind === "commit") {
      // Only a commit that just happened: "nothing to commit" must not re-log the old HEAD.
      try {
        const [sha, ct, subject] = execFileSync("git", ["-C", cwd, "log", "-1", "--format=%h%x09%ct%x09%s"], { encoding: "utf8", timeout: 4000 }).trim().split("\t");
        if (Date.now() / 1000 - Number(ct) > 120) return;
        ev.text = `${gitBranch(cwd) ?? "?"} ${sha} ${subject}`;
      } catch { return; }
    }
    if (ev.kind === "merged" && !process.env.SESSION_MESH_OFFLINE) {
      try {
        const title = execFileSync("gh", ["pr", "view", String(ev.ref), "--json", "title", "-q", ".title"], { cwd, encoding: "utf8", timeout: 8000 }).trim();
        if (title) ev.text = `PR #${ev.ref} merged — ${title}`;
      } catch { /* number alone is still news */ }
    }
    withLock(dir, () => {
      const state = loadState(dir);
      touch(state, sid, cwd);
      append(dir, state, sid, ev.kind, ev.text, ev.ref ? { ref: ev.ref } : {});
      saveState(dir, state);
    });
    return;
  }

  if (name === "session-end") {
    withLock(dir, () => {
      const state = loadState(dir);
      const s = state.sessions[sid];
      if (s) { s.claims = {}; s.ended = new Date().toISOString(); }
      saveState(dir, state);
    });
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function runCli() {
  const cwd = process.cwd();
  const dir = meshDirFor(cwd);
  if (!dir) { console.log("No session mesh here (needs the iKratom main checkout's private/ folder)."); return; }
  const kind = opt("kind");
  const clear = opt("clear");
  const all = opt("all");

  if (cmd === "log") {
    const n = Number(argv[0]) || 30;
    for (const e of loadJournal(dir).slice(-n)) console.log(entryLine(e));
    return;
  }

  if (cmd === "recall") {
    const terms = argv.filter((a) => !a.startsWith("--"));
    const main = findMainCheckout(cwd);
    const docs = loadJournal(dir).map((e) => ({ source: `journal#${e.n}`, text: `${e.kind}: ${e.text}` }));
    const addDir = (d, label) => {
      try {
        for (const f of readdirSync(d)) if (f.endsWith(".md")) docs.push({ source: `${label}/${f}`, text: readFileSync(join(d, f), "utf8") });
      } catch { /* missing dir */ }
    };
    addDir(join(main, "private"), "private");
    addDir(join(main, "private", "plans"), "private/plans");
    addDir(memoryDirFor(main), "memory");
    const hits = recallMatches(docs, terms);
    if (!hits.length) console.log(`Nothing in the journal, private/ or memory matches: ${terms.join(" ")}`);
    for (const h of hits) console.log(`${h.source}: ${h.line}`);
    return;
  }

  withLock(dir, () => {
    const state = prune(loadState(dir));
    const me = resolveMe(state, cwd);
    const sid = me?.id ?? "cli";
    const text = argv.filter((a) => !a.startsWith("--")).join(" ").trim();

    if (cmd === "whoami") {
      console.log(me ? `${shortId(me.id)} ${labelOf(me)} (pass --as <id> if this is not you)` : "No active session resolved; pass --as <id>.");
    } else if (cmd === "task") {
      if (!me) { console.log("No active session to label; pass --as <id>."); return; }
      me.task = text.slice(0, 120);
      append(dir, state, sid, "task", `now on: ${me.task}`);
      console.log(`${shortId(me.id)} task: ${me.task}`);
    } else if (cmd === "say") {
      if (!text) { console.log('Usage: say [--kind decision|finding|handoff|owner|note] "<text>"'); return; }
      const e = append(dir, state, sid, typeof kind === "string" ? kind : "note", text);
      console.log(`journaled #${e.n} as ${shortId(sid)}`);
    } else if (cmd === "reserve-migration") {
      if (!text) { console.log('Usage: reserve-migration "<what it is for>" [--as <id>]'); return; }
      const n = nextMigrationNumber({
        fileNames: migrationFiles(findMainCheckout(cwd)),
        reserved: state.migrations ?? [],
        journalTexts: loadJournal(dir).map((e) => e.text),
      });
      const num = String(n).padStart(4, "0");
      (state.migrations ??= []).push({ n, sid, for: text.slice(0, 120), at: new Date().toISOString() });
      append(dir, state, sid, "decision", `reserved migration ${num} for ${text.slice(0, 120)}`);
      console.log(num);
    } else if (cmd === "claim" || cmd === "release") {
      if (!me) { console.log("No active session resolved; pass --as <id>."); return; }
      if (cmd === "release" && all) { me.claims = {}; console.log("released all claims"); }
      else if (!text) { console.log(`Usage: ${cmd} <path>`); return; }
      else if (cmd === "claim") {
        const others = claimConflicts(state, me.id, text);
        me.claims[normPath(text)] = { at: new Date().toISOString() };
        console.log(others.length ? `claimed — but ALSO held by ${others.map((o) => shortId(o.session.id)).join(", ")}` : "claimed");
      } else { delete me.claims[normPath(text)]; console.log("released"); }
    } else if (cmd === "trunk") {
      if (clear) { state.trunk = null; append(dir, state, sid, "trunk", "trunk role released"); console.log("trunk cleared"); }
      else if (!me) { console.log("No active session resolved; pass --as <id>."); return; }
      else {
        const prev = state.trunk;
        state.trunk = me.id;
        append(dir, state, sid, "trunk", `${shortId(me.id)} is now the trunk${prev && prev !== me.id ? ` (was ${shortId(prev)})` : ""}`);
        console.log(`${shortId(me.id)} is the trunk`);
      }
    } else {
      const now = Date.now();
      const sessions = Object.values(state.sessions).sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen));
      console.log(`mesh: ${dir}`);
      console.log(`trunk: ${state.trunk ? `${shortId(state.trunk)} ${labelOf(state.sessions[state.trunk])}` : "none"}`);
      for (const s of sessions) {
        const live = isActive(s, now) ? "ACTIVE" : s.ended ? "ended " : "idle  ";
        const mins = Math.round((now - Date.parse(s.last_seen)) / 60000);
        const claims = Object.keys(s.claims ?? {});
        console.log(`  ${live} ${shortId(s.id)} ${labelOf(s)} · seen ${mins}m ago${claims.length ? ` · holding ${claims.length}: ${claims.slice(0, 3).join(", ")}` : ""}`);
      }
      console.log(`journal (last 10 of ${state.seq ?? 0}):`);
      for (const e of loadJournal(dir).slice(-10)) console.log(`  ${entryLine(e)}`);
      console.log(`active window: ${ACTIVE_MS / 3600e3} h`);
    }
    saveState(dir, state);
  });
}

try {
  if (HOOKS.has(cmd)) runHook(cmd);
  else runCli();
} catch (e) {
  if (!HOOKS.has(cmd)) console.error(`session-mesh: ${e.message}`);
}
process.exit(0);
