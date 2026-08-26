#!/usr/bin/env node
/**
 * Generate a "what's new" patch-note draft from recent merged PRs +
 * commits. Saves a file at src/content/patch-notes/YYYY-MM-DD-slug.md.
 *
 * Admin reviews the draft, edits headlines + groups bullets by user
 * impact, then commits.
 *
 * These drafts are NOT safe to ship as-is — this comment used to say they
 * were, and that is precisely how raw generator output reached /whats-new:
 * ten published notes carried an editor instruction meant for the curator.
 * See the classifier note below; two past leaks (PR #691) came from
 * publishing verbatim. Treat every draft as a starting point.
 *
 * Run:
 *   node scripts/generate-patch-note.mjs --since "7 days ago"
 *   node scripts/generate-patch-note.mjs --since 2026-05-10
 *   node scripts/generate-patch-note.mjs                    # default: last 24h
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { classifyCommit } from "./lib/changelog-safety.mjs";

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

// Classify each commit (scripts/lib/changelog-safety.mjs). Sensitive subjects
// (security/vuln, intel/opposition, infra/secrets, engine internals) and any
// security-scoped commit are HELD OUT of the published draft — only safe,
// user-facing commits are itemized. This draft is a CURATION STARTING POINT,
// never shipped raw: two past leaks (PR #691) came from publishing it verbatim.
const feats = [];
const fixes = [];
const docs = [];
const held = [];        // sensitive — written to a gitignored sidecar + console, never published
let behindCount = 0;    // safe chore/refactor/ci/non-conventional → collapse to a generic line
let securityCount = 0;  // security-scoped → collapse to the same generic line, never itemized

for (const c of commits) {
  const klass = classifyCommit(c.subject);
  if (klass === "security") { securityCount++; held.push({ ...c, reason: "security (collapsed)" }); continue; }
  if (klass === "held") { held.push({ ...c, reason: "sensitive term" }); continue; }
  // Public — itemize only user-facing prefixes; everything else collapses.
  const m = c.subject.match(/^(feat|fix|docs)(?:\([^)]+\))?:\s*(.*)/i);
  if (m) {
    const entry = { hash: c.hash, text: m[2] };
    const kind = m[1].toLowerCase();
    if (kind === "feat") feats.push(entry);
    else if (kind === "fix") fixes.push(entry);
    else docs.push(entry);
  } else {
    behindCount++; // chore / refactor / ci / non-conventional — not itemized publicly
  }
}

// Anchor the date to Eastern, and use ONE source for all three of slug,
// published and title.
//
// This used to mix two clocks: the slug and `published` came from
// toISOString() (UTC) while the title came from toLocaleDateString() (the
// machine's local zone). Run in a US evening those disagree, and the note
// contradicts itself — a real draft generated at 21:09 CDT was titled
// "Platform update — August 25, 2026" with slug "2026-08-26-update" and
// published "2026-08-26".
//
// Eastern (not UTC, not the machine's zone) because every user-facing date on
// this platform is civic and anchors to America/New_York — Vercel and GitHub
// Actions both run UTC, so a bare UTC date rolls a day ahead every US evening
// no matter who generates the note.
const ET = "America/New_York";
const today = new Date();
const ymd = today.toLocaleDateString("en-CA", { timeZone: ET }); // en-CA gives YYYY-MM-DD
const slug = `${ymd}-update`;
const path = join(dir, `${slug}.md`);
const title = `Platform update — ${today.toLocaleDateString("en-US", { timeZone: ET, month: "long", day: "numeric", year: "numeric" })}`;

const link = (h) => `([${h.slice(0, 7)}](https://github.com/ohjustadam/ikratom/commit/${h}))`;
const sections = [];
if (feats.length > 0) sections.push(`## ✨ New features\n\n${feats.map((c) => `- ${c.text} ${link(c.hash)}`).join("\n")}`);
if (fixes.length > 0) sections.push(`## 🐛 Fixes\n\n${fixes.map((c) => `- ${c.text} ${link(c.hash)}`).join("\n")}`);
if (docs.length > 0) sections.push(`## 📚 Docs\n\n${docs.map((c) => `- ${c.text} ${link(c.hash)}`).join("\n")}`);
// Catch-all: security + maintenance are ACKNOWLEDGED generically, never itemized.
if (securityCount > 0 || behindCount > 0) {
  sections.push(`## 🛠 Under the hood\n\nReliability and security improvements plus behind-the-scenes maintenance landed this period. Nothing you need to do — the toolbelt just gets sturdier.`);
}

const featureCount = feats.length;
const fixCount = fixes.length;
const summary = `${featureCount} new feature${featureCount === 1 ? "" : "s"}${fixCount ? `, ${fixCount} fix${fixCount === 1 ? "" : "es"}` : ""}, plus reliability and behind-the-scenes work.`;

const frontMatter = `---
title: "${title}"
slug: "${slug}"
published: "${ymd}"
summary: "${summary}"
---

`;

// NO editor instructions in the body. This used to emit
//   "_Auto-generated draft — curate the headlines by user impact before relying on it._"
// which is a note to the CURATOR, not the reader — and because these drafts are
// routinely merged as-is, that sentence shipped to /whats-new on ten separate
// notes and sat there for months. Same reasoning retired the
// "_All changes since N hours ago._" line, which described the generator's own
// time window rather than the release.
//
// The "this is a draft, please curate it" message still exists — it goes to the
// operator, on the console, below. Guidance belongs where the operator is, never
// in the artifact the public reads.
const body = `${summary}\n\n${sections.join("\n\n")}\n`;

writeFileSync(path, frontMatter + body, "utf8");

// Held (sensitive) commits NEVER enter the published .md — the repo + the
// /whats-new page are PUBLIC. They go to a gitignored sidecar + the console so a
// human can review and re-add anything genuinely safe BY HAND.
let heldNote = "";
if (held.length > 0) {
  const sidecar = join(dir, `${slug}.held.txt`);
  const heldBody = [
    `${held.length} commit(s) were HELD OUT of the public draft ${slug}.md as potentially sensitive.`,
    `Review each; re-add to the .md by hand ONLY if it is genuinely safe + user-facing.`,
    `(This sidecar is gitignored — it is never published.)`,
    ``,
    ...held.map((c) => `- [${c.reason}] ${c.subject}  (${c.hash.slice(0, 7)})`),
    ``,
  ].join("\n");
  writeFileSync(sidecar, heldBody, "utf8");
  heldNote = `\n⚠ ${held.length} sensitive commit(s) HELD OUT of the draft → ${sidecar}\n` +
    held.map((c) => `   - [${c.reason}] ${c.subject.slice(0, 90)}`).join("\n");
}

console.log(`\n✓ Draft written: ${path}`);
console.log(`  ${feats.length} feat · ${fixes.length} fix · ${docs.length} docs published · ${held.length} held · ${behindCount} behind-the-scenes (collapsed)`);
if (heldNote) console.log(heldNote);
console.log(`\nThis draft is a STARTING POINT — never publish raw commit subjects. Security, intel, and infra lines are held automatically; review the rest for user impact before committing.`);
