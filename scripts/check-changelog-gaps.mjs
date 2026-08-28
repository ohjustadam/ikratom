#!/usr/bin/env node
/**
 * check-changelog-gaps.mjs — notice when /whats-new has a hole.
 *
 * WHY. The daily draft job opens a PR and waits for a human. When nobody merges
 * it, nothing complains — the branch just sits. Seven days of changelog (May 19
 * to May 29, 2026) went missing that way and stayed missing for three months,
 * including a note carrying 13 real features. It was found by accident while
 * pruning branches, and the branches were one command away from being deleted
 * as clutter.
 *
 * A draft pipeline whose failure mode is silence will fail silently again. This
 * makes the hole visible: it compares days that actually SHIPPED user-facing
 * work against days that have a published note.
 *
 * Deliberately conservative — it only counts a day as missing when that day had
 * real feat:/fix: commits. Quiet days are not gaps, and weekends where nothing
 * shipped are not gaps.
 *
 *   node scripts/check-changelog-gaps.mjs                 # last 90 days
 *   node scripts/check-changelog-gaps.mjs --days 365
 *   node scripts/check-changelog-gaps.mjs --strict        # exit 1 if any gap
 *
 * Exit 0 normally (reporting only, so it never blocks a deploy); 1 with --strict.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const dIdx = argv.indexOf("--days");
const DAYS = dIdx >= 0 ? parseInt(argv[dIdx + 1], 10) : 90;
const STRICT = argv.includes("--strict");
const DIR = "src/content/patch-notes";
const ET = "America/New_York";

/** Days that already have a published note. */
function publishedDays() {
  if (!existsSync(DIR)) return new Set();
  const out = new Set();
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".md"))) {
    const m = readFileSync(join(DIR, f), "utf8").match(/^published:\s*"?(\d{4}-\d{2}-\d{2})"?/m);
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * Days that shipped user-facing work. Uses the SAME conventional-commit prefixes
 * the generator itemises, so "a day worth a note" means the same thing in both
 * places. Author date in Eastern, matching how the note is stamped.
 */
function shippingDays(days) {
  const raw = execFileSync(
    "git",
    ["log", `--since=${days} days ago`, "--pretty=format:%cI%x09%s"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const byDay = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [iso, ...rest] = line.split("\t");
    const subject = rest.join("\t");
    if (!/^(feat|fix)(\([^)]+\))?:/i.test(subject)) continue;
    const day = new Date(iso).toLocaleDateString("en-CA", { timeZone: ET });
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(subject);
  }
  return byDay;
}

const published = publishedDays();
const shipping = shippingDays(DAYS);

/**
 * A note covers the work BEFORE it, not the work stamped with its own date —
 * the generator runs on a lookback ("--since 24 hours ago", sometimes 36). So a
 * day is covered by a note published that day or shortly after.
 *
 * Without this window the check reports a "gap" for the day before every single
 * note and becomes unusable noise: 25 gaps, nearly all false. Three days is
 * generous enough to absorb a weekend batch while still catching a real hole —
 * the May outage was seven consecutive days, which no window hides.
 */
const COVER_WINDOW_DAYS = 3;
function covered(day) {
  const d = new Date(`${day}T12:00:00Z`);
  for (let i = 0; i <= COVER_WINDOW_DAYS; i++) {
    const probe = new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10);
    if (published.has(probe)) return true;
  }
  return false;
}

// The most recent days are excluded: their note legitimately may not exist yet.
const todayMs = Date.now();
const gaps = [...shipping.entries()]
  .filter(([day]) => {
    const ageDays = (todayMs - new Date(`${day}T12:00:00Z`).getTime()) / 86400000;
    return ageDays > COVER_WINDOW_DAYS && !covered(day);
  })
  .sort(([a], [b]) => a.localeCompare(b));

console.log(`Changelog coverage — last ${DAYS} days`);
console.log(`  notes published : ${published.size}`);
console.log(`  days that shipped user-facing work : ${shipping.size}`);

if (!gaps.length) {
  console.log("\nok No gaps: every day that shipped user-facing work has a note.");
  process.exit(0);
}

console.log(`\nx ${gaps.length} day(s) shipped work but have NO published note:\n`);
for (const [day, subjects] of gaps) {
  console.log(`  ${day}  (${subjects.length} user-facing commit${subjects.length === 1 ? "" : "s"})`);
  for (const s of subjects.slice(0, 3)) console.log(`      - ${s.slice(0, 88)}`);
  if (subjects.length > 3) console.log(`      … and ${subjects.length - 3} more`);
}
console.log(
  "\nA draft may exist on an unmerged auto-patch-note branch — check before regenerating:" +
    "\n  gh pr list --state all --search 'auto-patch-note in:head'" +
    "\n  git branch -r | grep auto-patch-note",
);

// Surface it in the GitHub Actions run summary so the daily job reports holes
// instead of only creating new drafts.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### ⚠ Changelog gaps (${gaps.length})\n\n` +
      gaps.map(([d, s]) => `- **${d}** — ${s.length} user-facing commit(s), no note`).join("\n") +
      "\n",
  );
}

process.exit(STRICT ? 1 : 0);
