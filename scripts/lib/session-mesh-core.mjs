/**
 * session-mesh-core.mjs — the pure half of the session mesh (no I/O beyond
 * reading .git pointers). The CLI and hook dispatcher is scripts/session-mesh.mjs.
 *
 * WHY (owner ask 2026-10-17): parallel Claude sessions on iKratom kept
 * fracturing. One thread shipped a dozen PRs while another, nine days stale,
 * was about to re-list the same work as outstanding; two sessions were handed
 * the identical cleanup and only avoided overwriting each other because one
 * happened to message the other. The mesh gives every session the same
 * short-term memory: who else is live, what they are holding, and what they
 * shipped or decided, delivered automatically by Claude Code hooks at session
 * start and before every prompt.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export const ACTIVE_MS = 2 * 3600e3; // seen within 2 h = active
export const FORGET_MS = 7 * 86400e3; // unseen 7 days = dropped from the registry
export const CLAIM_MS = 8 * 3600e3; // a claim not renewed for 8 h lapses
export const START_WINDOW_MS = 48 * 3600e3; // session start shows 48 h of journal

const fwd = (p) => String(p ?? "").replace(/\\/g, "/");

/** Comparable path: absolute, forward slashes, lower-case on Windows. */
export function normPath(p, platform = process.platform) {
  const s = fwd(resolve(String(p ?? "."))).replace(/\/+$/, "");
  return platform === "win32" ? s.toLowerCase() : s;
}

/**
 * The MAIN checkout for a directory. A linked worktree's `.git` is a file
 * ("gitdir: <main>/.git/worktrees/<name>"), so every worktree resolves to the
 * one main checkout, and with it the one private/ folder they all share.
 */
export function findMainCheckout(cwd) {
  let dir = resolve(String(cwd ?? "."));
  for (let i = 0; i < 40; i++) {
    const g = join(dir, ".git");
    if (existsSync(g)) {
      try {
        if (statSync(g).isDirectory()) return fwd(dir);
        const m = readFileSync(g, "utf8").match(/^gitdir:\s*(.+)$/m);
        if (m) {
          const gd = fwd(resolve(dir, m[1].trim()));
          const at = gd.lastIndexOf("/.git/worktrees/");
          if (at >= 0) return gd.slice(0, at);
        }
      } catch { /* unreadable pointer: treat this dir as the checkout */ }
      return fwd(dir);
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/** Current branch from .git/HEAD, without spawning git (hooks run on every prompt). */
export function gitBranch(cwd) {
  let dir = resolve(String(cwd ?? "."));
  for (let i = 0; i < 40; i++) {
    const g = join(dir, ".git");
    if (existsSync(g)) {
      try {
        let gitDir = g;
        if (!statSync(g).isDirectory()) {
          const m = readFileSync(g, "utf8").match(/^gitdir:\s*(.+)$/m);
          if (!m) return null;
          gitDir = resolve(dir, m[1].trim());
        }
        const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
        const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
        return ref ? ref[1] : `detached@${head.slice(0, 7)}`;
      } catch { return null; }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/** Claude Code's auto-memory directory for a project path (it is keyed by the sanitized cwd). */
export function memoryDirFor(projectPath, home = homedir()) {
  const key = fwd(projectPath).replace(/[:/]/g, "-");
  return fwd(join(home, ".claude", "projects", key, "memory"));
}

/**
 * Files more than one session may write that git does not protect: private/
 * (gitignored, shared by every worktree) and the auto-memory directory.
 * Tracked files are already isolated per worktree.
 */
export function isSharedPath(file, mainDir, platform = process.platform) {
  if (!file || !mainDir) return false;
  const f = normPath(file, platform);
  const priv = normPath(join(mainDir, "private"), platform);
  return f.startsWith(`${priv}/`) || /\/\.claude\/projects\/[^/]+\/memory\//.test(f);
}

export const shortId = (id) => String(id ?? "?").slice(0, 6);

export function isActive(s, now = Date.now()) {
  return !!s && !s.ended && now - Date.parse(s.last_seen ?? 0) < ACTIVE_MS;
}

export function labelOf(s) {
  if (!s) return "?";
  return s.task ? `"${s.task}"` : `${s.branch ?? "?"} @ ${s.cwd ?? "?"}`;
}

/** Claims other active sessions hold on `file` (normalised keys). */
export function claimConflicts(state, myId, file, now = Date.now(), platform = process.platform) {
  const key = normPath(file, platform);
  const out = [];
  for (const s of Object.values(state.sessions ?? {})) {
    if (s.id === myId || !isActive(s, now)) continue;
    const c = s.claims?.[key];
    if (c && now - Date.parse(c.at) < CLAIM_MS) out.push({ session: s, claim: c });
  }
  return out;
}

/** Drop sessions unseen for FORGET_MS and claims that lapsed. Mutates and returns state. */
export function prune(state, now = Date.now()) {
  for (const [id, s] of Object.entries(state.sessions ?? {})) {
    if (now - Date.parse(s.last_seen ?? 0) > FORGET_MS) { delete state.sessions[id]; continue; }
    for (const [k, c] of Object.entries(s.claims ?? {})) {
      if (now - Date.parse(c.at) > CLAIM_MS || s.ended) delete s.claims[k];
    }
  }
  if (state.trunk && !state.sessions?.[state.trunk]) state.trunk = null;
  return state;
}

/**
 * What a Bash command did that the other sessions should hear about, or null.
 * Only the cheap parse lives here; the dispatcher fills in commit hashes and
 * PR titles. The mesh's own CLI is never journaled (it journals itself).
 */
export function parseBashEvent(command, stdout = "") {
  const c = String(command ?? "");
  if (/session-mesh\.mjs|npm run mesh\b/.test(c)) return null;
  let m;
  if ((m = c.match(/\bgh\s+pr\s+merge\s+(\d+)/))) return { kind: "merged", ref: Number(m[1]), text: `PR #${m[1]} merged` };
  if ((m = c.match(/merge-loop\.sh((?:\s+\d+)+)/))) {
    const prs = m[1].trim().split(/\s+/).map((n) => `#${n}`).join(" ");
    return { kind: "merging", text: `merge loop started for ${prs}` };
  }
  if (/\bgh\s+pr\s+create\b/.test(c)) {
    const url = String(stdout).match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/)?.[0];
    const title = c.match(/--title\s+(?:"([^"]+)"|'([^']+)')/);
    const t = title ? (title[1] ?? title[2]) : null;
    return { kind: "pr", text: [url ? `opened ${url}` : "opened a PR", t ? `— ${t}` : null].filter(Boolean).join(" ") };
  }
  if (/\bgit\b[^|;&]*\bcommit\b/.test(c) && !/--dry-run/.test(c)) return { kind: "commit", text: "commit" };
  if (/api\.netlify\.com\/api\/v1\/sites\/[^\s"'`]+\/builds/.test(c)) return { kind: "deploy", text: "production build triggered" };
  if (/\bnpm run db:push\b/.test(c)) return { kind: "migration", text: "migrations pushed (npm run db:push)" };
  return null;
}

const when = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const ago = (ts, now) => {
  const m = Math.max(0, Math.round((now - Date.parse(ts)) / 60000));
  return m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const clip = (s, n = 180) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

export function entryLine(e) {
  return `- ${when(e.ts)} ${shortId(e.sid)} ${e.kind}: ${clip(e.text)}`;
}

/** The block a session sees when it starts (or resumes, or is compacted). */
export function renderStart({ me, state, entries, now = Date.now(), mainDir, memoryHint = null, meshDir }) {
  const others = Object.values(state.sessions ?? {})
    .filter((s) => s.id !== me.id && isActive(s, now))
    .sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen));
  const trunk = state.trunk ? state.sessions?.[state.trunk] : null;
  const lines = [];
  lines.push(`🕸 iKratom session mesh — you are session ${shortId(me.id)} (${me.branch ?? "?"} @ ${me.cwd}). Shared state: ${meshDir}.`);
  if (trunk && trunk.id === me.id) {
    lines.push("You are the TRUNK: you own private/OWNER_TODO.md and private/PLAN_OF_ACTION.md, and you fold the other sessions' journal entries into them.");
  } else if (trunk && isActive(trunk, now)) {
    lines.push(`TRUNK: ${shortId(trunk.id)} ${labelOf(trunk)}. It owns private/OWNER_TODO.md + PLAN_OF_ACTION.md: journal your outcomes (\`say\`) instead of editing those two.`);
  } else {
    lines.push("No active trunk. If you are the coordinating session, take the role: node scripts/session-mesh.mjs trunk --as " + shortId(me.id));
  }
  if (others.length) {
    lines.push(`Active sessions (${others.length}):`);
    for (const s of others.slice(0, 8)) {
      const claims = Object.keys(s.claims ?? {}).map((k) => k.replace(normPath(mainDir ?? ""), "").replace(/^\//, ""));
      lines.push(`- ${shortId(s.id)}${state.trunk === s.id ? " TRUNK" : ""} · ${labelOf(s)} · seen ${ago(s.last_seen, now)} ago${claims.length ? ` · holding ${claims.slice(0, 4).join(", ")}` : ""}`);
    }
  } else {
    lines.push("No other active sessions.");
  }
  const recent = entries.filter((e) => now - Date.parse(e.ts) < START_WINDOW_MS).slice(-12).reverse();
  if (recent.length) {
    lines.push("Recent journal (48 h, newest first):");
    for (const e of recent) lines.push(entryLine(e));
  }
  lines.push(`Protocol (AGENTS.md rule 11): say what you're on — node scripts/session-mesh.mjs task "<one line>" --as ${shortId(me.id)}. Broadcast every decision, finding, handoff or owner instruction — node scripts/session-mesh.mjs say --kind decision "<text>" --as ${shortId(me.id)}. Merges, PRs, commits and deploys journal themselves. Editing a private/ or memory file claims it, and you are warned if a peer holds it. \`recall <words>\` searches journal + private/ + memory. Talk to a live peer with ListAgents + SendMessage.`);
  if (memoryHint) lines.push(memoryHint);
  return lines.join("\n");
}

/** Entries from OTHER sessions newer than this session's cursor. */
export function newForMe(entries, me) {
  const cursor = Number(me.cursor ?? 0);
  return entries.filter((e) => e.n > cursor && e.sid !== me.id);
}

export function renderUpdates(fresh) {
  if (!fresh.length) return null;
  const shown = fresh.slice(-8);
  const lines = [`🕸 Mesh: ${fresh.length} update${fresh.length === 1 ? "" : "s"} from other sessions since your last turn:`];
  for (const e of shown) lines.push(entryLine(e));
  if (fresh.length > shown.length) lines.push(`(+${fresh.length - shown.length} older — node scripts/session-mesh.mjs log)`);
  return lines.join("\n");
}

/**
 * The next free migration number. Branch sessions picked the same number twice
 * in a day (three took 0276 on 2026-10-23; two took 0283 on 10-24, both applied).
 * It takes the highest of:
 *   - migration files in the main checkout, every worktree and origin/main;
 *   - numbers reserved through `reserve-migration`;
 *   - numbers that a "reserving / claiming migration 0NNN" journal line names by hand.
 * Then it adds one. It errs toward a gap, never a collision.
 * @param {{ fileNames?: string[], reserved?: Array<{ n: number }>, journalTexts?: string[] }} sources
 * @returns {number}
 */
export function nextMigrationNumber({ fileNames = [], reserved = [], journalTexts = [] }) {
  let max = 0;
  for (const f of fileNames) { const m = /^(\d{4})_/.exec(f); if (m) max = Math.max(max, Number(m[1])); }
  for (const r of reserved) max = Math.max(max, Number(r.n) || 0);
  for (const t of journalTexts) {
    if (!/reserv|claiming migration/i.test(String(t))) continue;
    for (const m of String(t).matchAll(/\b0\d{3}\b/g)) max = Math.max(max, Number(m[0]));
  }
  return max + 1;
}

/** Lines matching the most of `terms` across `docs` ([{source, text}]), best first. */
export function recallMatches(docs, terms, limit = 15) {
  const ts = terms.map((t) => t.toLowerCase()).filter(Boolean);
  if (!ts.length) return [];
  const hits = [];
  for (const d of docs) {
    String(d.text).split(/\r?\n/).forEach((line, i) => {
      const l = line.toLowerCase();
      const score = ts.filter((t) => l.includes(t)).length;
      if (score) hits.push({ source: `${d.source}:${i + 1}`, line: clip(line.trim(), 200), score });
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
