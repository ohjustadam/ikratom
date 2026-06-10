#!/usr/bin/env node
/**
 * generate-codebase-map.mjs — the "where is X / what calls Y" index (PR-F,
 * Claude-burn killer #2). DETERMINISTIC: this codebase's header comments are
 * already excellent, so the map harvests them instead of asking an LLM —
 * reproducible, instant, and never hallucinates.
 *
 * Per file: the first doc-comment line(s) + exported symbols. Plus an
 * "imported by" graph so a cold session sees which modules are load-bearing.
 *
 *   node scripts/generate-codebase-map.mjs --out private/session-prep/CODEBASE_MAP.md
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const argOf = (f) => { const i = args.indexOf(f); const v = args[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : null; };
const OUT = argOf("--out") ?? "private/session-prep/CODEBASE_MAP.md";
const ROOT = process.cwd();
const SCAN = ["src", "scripts", "supabase/migrations"];
const EXT = new Set([".ts", ".tsx", ".mjs", ".sql"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".archive", "__tests__"]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (EXT.has(p.slice(p.lastIndexOf(".")))) acc.push(p);
  }
  return acc;
}

/** First meaningful line(s) of the file's leading comment block. */
function headerOf(src) {
  const lines = src.split("\n").slice(0, 30);
  const out = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (/^(\/\*\*?|--|\/\/|\*\/?$|#!)/.test(l) || l === "*" || l === "") {
      const text = l.replace(/^(\/\*\*?|\*\/|\*|\/\/|--|#!.*)\s?/, "").trim();
      if (text && !/^@|^eslint|^use (client|server)/.test(text)) out.push(text);
      if (out.length >= 2) break;
      continue;
    }
    break; // first code line ends the header block
  }
  return out.join(" ").slice(0, 180);
}

function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z0-9_]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop()?.trim(); if (n) names.add(n); }
  }
  if (/export\s+default/.test(src)) names.add("default");
  return [...names].slice(0, 12);
}

function localImportsOf(src, fileDir) {
  const targets = [];
  for (const m of src.matchAll(/from\s+["'](\.{1,2}\/[^"']+|@\/[^"']+)["']/g)) {
    const spec = m[1];
    const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : resolve(fileDir, spec);
    targets.push(relative(ROOT, base).replace(/\\/g, "/"));
  }
  return targets;
}

const files = SCAN.flatMap((d) => walk(join(ROOT, d)));
const entries = [];
const importedBy = new Map();

for (const p of files) {
  const rel = relative(ROOT, p).replace(/\\/g, "/");
  let src;
  try { src = readFileSync(p, "utf8"); } catch { continue; }
  const entry = { rel, header: headerOf(src), exports: rel.endsWith(".sql") ? [] : exportsOf(src) };
  entries.push(entry);
  if (!rel.endsWith(".sql")) {
    for (const t of localImportsOf(src, dirname(p))) {
      importedBy.set(t, (importedBy.get(t) ?? 0) + 1);
    }
  }
}

// Resolve extensionless import targets to real entries for the hot list.
const hotness = new Map();
for (const e of entries) {
  const stem = e.rel.replace(/\.(ts|tsx|mjs)$/, "");
  const n = (importedBy.get(stem) ?? 0) + (importedBy.get(e.rel) ?? 0);
  if (n > 0) hotness.set(e.rel, n);
}
const hot = [...hotness.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);

const byDir = new Map();
for (const e of entries) {
  const dir = e.rel.slice(0, e.rel.lastIndexOf("/"));
  if (!byDir.has(dir)) byDir.set(dir, []);
  byDir.get(dir).push(e);
}

let md = `# Codebase map — generated ${new Date().toISOString().slice(0, 16)}Z\n\n`;
md += `${entries.length} files across ${byDir.size} directories. Deterministic harvest of header comments + exports — regenerate via scripts/generate-codebase-map.mjs.\n\n`;
md += `## Load-bearing modules (most imported)\n\n`;
for (const [rel, n] of hot) md += `- \`${rel}\` ← imported by ${n} file(s)\n`;
md += `\n## Files by directory\n`;
for (const [dir, list] of [...byDir.entries()].sort()) {
  md += `\n### ${dir}/\n\n`;
  for (const e of list.sort((a, b) => a.rel.localeCompare(b.rel))) {
    const name = e.rel.slice(e.rel.lastIndexOf("/") + 1);
    md += `- **${name}**${e.header ? ` — ${e.header}` : ""}${e.exports.length ? ` _(exports: ${e.exports.join(", ")})_` : ""}\n`;
  }
}

mkdirSync(dirname(resolve(ROOT, OUT)), { recursive: true });
writeFileSync(resolve(ROOT, OUT), md);
console.log(`✓ wrote ${OUT} (${entries.length} files, ${Math.round(md.length / 1024)}KB)`);
