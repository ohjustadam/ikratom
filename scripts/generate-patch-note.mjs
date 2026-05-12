#!/usr/bin/env node
/**
 * Generate a "what's new" patch-note draft from recent merged PRs +
 * commits. Saves a file at src/content/patch-notes/YYYY-MM-DD-slug.md.
 *
 * Admin reviews the draft, edits headlines + groups bullets by user
 * impact, then commits. Auto-generated drafts are safe to ship as-is
 * but light editing makes them shine.
 *
 * Run:
 *   node scripts/generate-patch-note.mjs --since "7 days ago"
 *   node scripts/generate-patch-note.mjs --since 2026-05-10
 *   node scripts/generate-patch-note.mjs                    # default: last 24h
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : "24 hours ago";

const dir = "src/content/patch-notes";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

// Pull merged commits + their messages (most repos squash-merge, so each commit = a PR)
let log;
try {
  log = execSync(
    `git log --since="${since}" --pretty=format:"%H%x09%s%x09%b%x1e" --reverse`,
    { encoding: "utf8" },
  );
} catch (e) {
  console.error("git log failed:", e.message);
  process.exit(1);
}

const commits = log
  .split("\x1e")
  .map((block) => block.trim())
  .filter(Boolean)
  .map((block) => {
    const [hash, subject, ...rest] = block.split("\t");
    return { hash, subject, body: rest.join("\t") };
  });

if (commits.length === 0) {
  console.log(`No commits since "${since}". Nothing to draft.`);
  process.exit(0);
}

// Group by conventional-commit prefix
const groups = {
  feat: [],
  fix: [],
  chore: [],
  docs: [],
  ci: [],
  refactor: [],
  other: [],
};
for (const c of commits) {
  const m = c.subject.match(/^(feat|fix|chore|docs|ci|refactor|test|perf)(\([^)]+\))?:\s*(.*)/);
  if (m) {
    const kind = m[1];
    const text = m[3];
    (groups[kind] ?? groups.other).push({ hash: c.hash, text });
  } else {
    groups.other.push({ hash: c.hash, text: c.subject });
  }
}

const today = new Date();
const slug = `${today.toISOString().slice(0, 10)}-update`;
const path = join(dir, `${slug}.md`);
const title = `Platform update — ${today.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`;

const sections = [];
if (groups.feat.length > 0) {
  sections.push(`## ✨ New features\n\n${groups.feat.map((c) => `- ${c.text} ([${c.hash.slice(0, 7)}](https://github.com/ohjustadam/ikratom/commit/${c.hash}))`).join("\n")}`);
}
if (groups.fix.length > 0) {
  sections.push(`## 🐛 Fixes\n\n${groups.fix.map((c) => `- ${c.text} ([${c.hash.slice(0, 7)}](https://github.com/ohjustadam/ikratom/commit/${c.hash}))`).join("\n")}`);
}
if (groups.chore.length + groups.refactor.length + groups.ci.length > 0) {
  const all = [...groups.chore, ...groups.refactor, ...groups.ci];
  sections.push(`## 🛠 Behind the scenes\n\n${all.map((c) => `- ${c.text} ([${c.hash.slice(0, 7)}](https://github.com/ohjustadam/ikratom/commit/${c.hash}))`).join("\n")}`);
}
if (groups.docs.length > 0) {
  sections.push(`## 📚 Docs\n\n${groups.docs.map((c) => `- ${c.text} ([${c.hash.slice(0, 7)}](https://github.com/ohjustadam/ikratom/commit/${c.hash}))`).join("\n")}`);
}
if (groups.other.length > 0) {
  sections.push(`## Other\n\n${groups.other.map((c) => `- ${c.text} ([${c.hash.slice(0, 7)}](https://github.com/ohjustadam/ikratom/commit/${c.hash}))`).join("\n")}`);
}

const featureCount = groups.feat.length;
const fixCount = groups.fix.length;
const summary = `Shipped ${commits.length} commits — ${featureCount} new feature${featureCount === 1 ? "" : "s"}, ${fixCount} fix${fixCount === 1 ? "" : "es"}, and improvements behind the scenes.`;

const frontMatter = `---
title: "${title}"
slug: "${slug}"
published: "${today.toISOString().slice(0, 10)}"
summary: "${summary}"
total_commits: ${commits.length}
---

`;

const body = `${summary}\n\n_All changes since ${since}._\n\n${sections.join("\n\n")}\n`;

writeFileSync(path, frontMatter + body, "utf8");
console.log(`\n✓ Draft written: ${path}`);
console.log(`  ${commits.length} commits · ${featureCount} feat · ${fixCount} fix`);
console.log(`\nReview, polish the headlines, and commit. The /whats-new page picks it up automatically.`);
