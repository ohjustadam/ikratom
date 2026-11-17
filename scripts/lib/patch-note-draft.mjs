/**
 * Draft What's New ledger items (migration 0323) from commit subjects.
 *
 * Only for commits changelog-safety already passed as "public". The area and
 * type are SUGGESTIONS read off the conventional-commit prefix and scope; the
 * owner corrects them at /admin/whats-new before publishing, the same way he
 * curates the markdown.
 *
 * The six areas match AREA_KEYS in src/lib/patch-note-items.ts and the CHECK on
 * patch_note_items.area. There is no area for internal work by design.
 */

import { cleanSubject } from "./changelog-safety.mjs";

export const DRAFT_AREAS = ["bills", "letters", "community", "news", "account", "speed"];

/** Commit scope → area. Unlisted scopes fall back to DEFAULT_AREA. */
export const SCOPE_AREAS = {
  bills: "bills", bill: "bills", votes: "bills", vote: "bills", elections: "bills", election: "bills",
  local: "bills", states: "bills", state: "bills", "state-hq": "bills", calendar: "bills", brief: "bills",
  briefings: "bills", hearings: "bills", meetings: "bills", alerts: "bills", banned: "bills",
  campaigns: "letters", campaign: "letters", letters: "letters", letter: "letters", send: "letters",
  waves: "letters", media: "letters", compose: "letters", email: "letters", legislators: "letters",
  officials: "letters", missions: "letters",
  groups: "community", group: "community", forum: "community", lounge: "community", chat: "community",
  community: "community", dm: "community", connect: "community", social: "community", badges: "community",
  news: "news", feeds: "news", library: "news", stories: "news",
  feedback: "account", account: "account", profile: "account", signup: "account", settings: "account",
  notifications: "account", push: "account", onboarding: "account",
  perf: "speed", speed: "speed", pages: "speed",
};
export const DEFAULT_AREA = "bills";

const PREFIX_TYPES = { feat: "new", fix: "fix", perf: "faster" };

const ET = "America/New_York";

/** A commit date (ISO) as the Eastern civic date, YYYY-MM-DD. */
export function easternYmd(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-CA", { timeZone: ET });
}

/**
 * One drafted item for a public commit, or null if it is not a feat, fix or
 * perf. `subject` is the raw subject (with "[skip netlify] (#123)"), so the PR
 * number can be read off it.
 */
export function draftItem(subject, committedIso) {
  const pr = Number(subject.match(/\(#(\d+)\)\s*$/)?.[1]) || null;
  const m = cleanSubject(subject).match(/^(feat|fix|perf)(?:\(([^)]*)\))?!?:\s*(.+)$/is);
  if (!m) return null;
  const type = PREFIX_TYPES[m[1].toLowerCase()];
  const scope = (m[2] ?? "").toLowerCase().split(/[,/\s]+/)[0];
  const area = type === "faster" ? "speed" : (SCOPE_AREAS[scope] ?? DEFAULT_AREA);
  const text = m[3].trim();
  const title = (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, 200);
  const merged_on = easternYmd(committedIso);
  if (!merged_on || !title) return null;
  return { merged_on, pr, area, type, title, detail: null, member_report: false };
}
