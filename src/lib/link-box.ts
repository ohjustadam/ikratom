/**
 * Pure helpers for the smart link box (2026-11-25): one box where a member
 * pastes or shares a link and the site works out whether we already have it.
 *
 * No database and no network here, so every rule that decides "duplicate or
 * new" and "may this start a campaign draft" is unit-tested
 * (tests/link-box.test.ts). The server side lives in src/modules/link-box/.
 */
import { STATE_NAMES } from "@/lib/state-names";
import { TERMINAL_STATUSES, terminalStatusFromAction } from "../../scripts/lib/bill-status.mjs";

// ── Page metadata ────────────────────────────────────────────────────────────

export type PageMeta = {
  title: string | null;
  description: string | null;
  /** <link rel="canonical"> or og:url, made absolute. Often the original publisher for a syndicated copy. */
  canonical: string | null;
  siteName: string | null;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

const clean = (s: string | undefined | null, max: number) => {
  const v = s ? decodeEntities(s).replace(/\s+/g, " ").trim() : "";
  return v ? v.slice(0, max) : null;
};

function absoluteHttp(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(decodeEntities(href.trim()), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Title, description and canonical URL from an article's HTML head. */
export function pageMeta(html: string, pageUrl: string): PageMeta {
  const head = String(html ?? "").slice(0, 300_000);
  const meta: Record<string, string> = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && content != null && !(key in meta)) meta[key] = content;
  }
  let canonicalHref: string | undefined;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\brel\s*=\s*["']?canonical\b/i.test(tag)) {
      canonicalHref = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (canonicalHref) break;
    }
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  return {
    title: clean(meta["og:title"] ?? meta["twitter:title"] ?? titleTag, 300),
    description: clean(meta["og:description"] ?? meta["description"] ?? meta["twitter:description"], 1000),
    canonical: absoluteHttp(canonicalHref ?? meta["og:url"], pageUrl),
    siteName: clean(meta["og:site_name"], 120),
  };
}

// ── Title similarity ─────────────────────────────────────────────────────────

const STOP = new Set(
  ("the a an and or of to in on for with at by from as is are was were be been it its this that these those " +
    "after over under into about new says said will would could may can has have had not no but than then " +
    "what who why how when where his her their our your you we they he she them").split(" "),
);

/**
 * A headline with its outlet suffix removed ("… - The Oklahoman", "… | KFOR").
 * Unlike normalizeNewsTitle, a suffix needs spaces around its dash, so a
 * hyphenated word ("7-OH ban") survives.
 */
export function headlineKey(title: string | null | undefined): string {
  let t = String(title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i++) {
    const next = t.replace(/\s+[-—–|]\s+[^-—–|]{1,60}$/, "");
    if (next === t || next.length < 15) break;
    t = next;
  }
  return t;
}

/** The words that carry a headline, outlet suffix stripped. */
export function titleTokens(title: string | null | undefined): string[] {
  const t = headlineKey(title).replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ");
  return [...new Set(t.split(" ").filter((w) => w.length >= 3 && !STOP.has(w)))];
}

/** Jaccard overlap of two headlines' significant words, 0..1. */
export function titleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const A = new Set(titleTokens(a));
  const B = new Set(titleTokens(b));
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

/**
 * Same story under another link? A syndicated copy keeps the headline but
 * changes the URL, so a close headline match counts. Short headlines need an
 * exact match: four shared words is not evidence.
 */
export function sameStoryTitle(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = headlineKey(a);
  const kb = headlineKey(b);
  if (ka.length >= 25 && ka === kb) return true;
  const fewest = Math.min(titleTokens(a).length, titleTokens(b).length);
  return fewest >= 5 && titleSimilarity(a, b) >= 0.75;
}

/** Up to four distinctive words for a full-text search on news_items. */
export function titleSearchTerms(title: string | null | undefined): string[] {
  return titleTokens(title).sort((x, y) => y.length - x.length).slice(0, 4);
}

// ── Bills and places named in a link ────────────────────────────────────────

const SPELLED: [RegExp, string][] = [
  [/\bhouse\s+bill\s+(?:no\.?\s*)?(\d{1,5}[a-z]?)\b/gi, "HB"],
  [/\bsenate\s+bill\s+(?:no\.?\s*)?(\d{1,5}[a-z]?)\b/gi, "SB"],
  [/\bassembly\s+bill\s+(?:no\.?\s*)?(\d{1,5}[a-z]?)\b/gi, "AB"],
  [/\bhouse\s+file\s+(\d{1,5}[a-z]?)\b/gi, "HF"],
  [/\bsenate\s+file\s+(\d{1,5}[a-z]?)\b/gi, "SF"],
  [/\blegislative\s+bill\s+(\d{1,5}[a-z]?)\b/gi, "LB"],
];
const SHORT = /\b(H\.?\s?J\.?\s?R|S\.?\s?J\.?\s?R|H\.?\s?C\.?\s?R|S\.?\s?C\.?\s?R|H\.?\s?B|S\.?\s?B|A\.?\s?B|H\.?\s?F|S\.?\s?F|L\.?\s?B|H\.?\s?R)\.?\s?0*(\d{1,5}[A-Z]?)(?![A-Za-z0-9])/g;

/** Bill numbers a headline, summary or URL names, as "HB 1784". Single-letter prefixes are skipped: "A 2025 study" is not a bill. */
export function billRefs(text: string | null | undefined): string[] {
  const s = String(text ?? "");
  const out = new Set<string>();
  for (const [re, prefix] of SPELLED) for (const m of s.matchAll(re)) out.add(`${prefix} ${m[1].replace(/^0+(?=\d)/, "").toUpperCase()}`);
  for (const m of s.toUpperCase().matchAll(SHORT)) out.add(`${m[1].replace(/[.\s]/g, "")} ${m[2]}`);
  return [...out].slice(0, 6);
}

/** The spellings a bill number may be stored under. */
export function billNumberSpellings(ref: string): string[] {
  const [p, n] = ref.split(" ");
  return [...new Set([ref, `${p}${n}`, `${p.split("").join(".")}. ${n}`])];
}

const NAME_TO_CODE = Object.entries(STATE_NAMES)
  .filter(([code]) => code !== "DC")
  .sort((a, b) => b[1].length - a[1].length);

/** State codes named in a text ("West Virginia" is not also "Virginia"). */
export function statesInText(text: string | null | undefined): string[] {
  // Newspapers named after a place are not about that state.
  let s = ` ${String(text ?? "")} `.replace(/\bwashington\s+(?:post|times|examiner|free\s+beacon)\b|\bwashington,?\s+d\.?\s?c\b/gi, " ");
  const out: string[] = [];
  for (const [code, name] of NAME_TO_CODE) {
    const re = new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`, "i");
    if (re.test(s)) {
      out.push(code);
      s = s.replace(new RegExp(re.source, "gi"), " ");
    }
  }
  return out;
}

/** The state a legislature or LegiScan link belongs to, when its address says. */
export function stateFromUrl(url: string | null | undefined): string | null {
  let u: URL;
  try { u = new URL(String(url ?? "")); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const pick = (c: string | undefined) => (c && STATE_NAMES[c.toUpperCase()] && c.toUpperCase() !== "DC" ? c.toUpperCase() : null);
  if (host.endsWith("legiscan.com")) return pick(/^\/([a-z]{2})\//i.exec(u.pathname)?.[1]);
  return pick(/\.state\.([a-z]{2})\.us$/.exec(host)?.[1]) ?? pick(/^(?:www\.)?([a-z]{2})legislature\.gov$/.exec(host)?.[1]);
}

/** True when the link is a page on iKratom itself. */
export function isOwnSite(url: string): boolean {
  try { return /(^|\.)ikratom\.org$/i.test(new URL(url).hostname); } catch { return false; }
}

const KRATOM_RE = /kratom|mitragyn|7[\s-]?hydroxy|\b7[\s-]?oh\b|pseudoindoxyl|speciosa/i;
export function looksKratomRelated(text: string | null | undefined): boolean {
  return KRATOM_RE.test(String(text ?? ""));
}

// ── Staleness gate: may a link start a campaign draft? ───────────────────────

export type BillForGate = {
  active?: boolean | null;
  status?: string | null;
  last_action?: string | null;
  last_action_at?: string | null;
  session_sine_die?: boolean | null;
  scope?: string | null;
  local_meta?: { meeting_at?: string | null } | null;
  kratom_relevance?: string | null;
  targets_natural_leaf?: boolean | null;
  targets_synthetic_only?: boolean | null;
};

/** A state bill with no recorded action for this long is treated as stalled. */
export const STATE_BILL_QUIET_DAYS = 120;
/** A local item is open only with a meeting ahead (within this many days) or very recent movement. */
export const LOCAL_MEETING_AHEAD_DAYS = 90;
export const LOCAL_RECENT_DAYS = 30;

const DAY = 86_400_000;
const isLocal = (scope?: string | null) => scope === "municipal" || scope === "county" || scope === "local";

/**
 * Is there still something to do about this bill or ordinance? WHY: the
 * news-to-campaign pipeline once made 20 junk campaigns out of 22 for bills
 * that were already dead or signed (owner audit 2026-07-03), so a member's
 * link never opens a draft for a matter that is settled or gone quiet.
 */
export function actionWindow(b: BillForGate, now: Date = new Date()): { open: boolean; reason: string } {
  if (b.active === false) return { open: false, reason: "no longer tracked" };
  const status = (b.status ?? "").toLowerCase();
  if (TERMINAL_STATUSES.has(status)) return { open: false, reason: `already ${status}` };
  const fromAction = terminalStatusFromAction(b.last_action);
  if (fromAction) return { open: false, reason: `last action says ${fromAction}` };
  if (b.session_sine_die === true) return { open: false, reason: "the session has ended" };

  const last = b.last_action_at ? Date.parse(b.last_action_at) : NaN;
  const ageDays = Number.isFinite(last) ? Math.floor((now.getTime() - last) / DAY) : null;
  if (isLocal(b.scope)) {
    const meeting = b.local_meta?.meeting_at ? Date.parse(b.local_meta.meeting_at) : NaN;
    if (Number.isFinite(meeting) && meeting >= now.getTime() && meeting - now.getTime() <= LOCAL_MEETING_AHEAD_DAYS * DAY) {
      return { open: true, reason: "a meeting is coming up" };
    }
    if (ageDays != null && ageDays <= LOCAL_RECENT_DAYS) return { open: true, reason: "it moved recently" };
    return { open: false, reason: "no meeting ahead" };
  }
  if (ageDays == null) return { open: false, reason: "no recorded action" };
  if (ageDays > STATE_BILL_QUIET_DAYS) return { open: false, reason: `no movement in ${ageDays} days` };
  return { open: true, reason: "it is still moving" };
}

/**
 * May the link box start a campaign DRAFT for this bill? Only a live STATE
 * bill that would restrict kratom: the draft is the "please vote no" letter
 * (src/modules/campaigns/auto-create.ts buildCampaign), which is wrong for a
 * bill we support, a federal bill or a city ordinance. Those go to a
 * moderator with the tip instead.
 */
export function draftWorthy(b: BillForGate, now: Date = new Date()): { ok: boolean; reason: string } {
  const w = actionWindow(b, now);
  if (!w.open) return { ok: false, reason: w.reason };
  if ((b.scope ?? "state") !== "state") return { ok: false, reason: "not a state bill" };
  if (b.kratom_relevance !== "anti") return { ok: false, reason: "not a bill that restricts kratom" };
  if (b.targets_synthetic_only === true && b.targets_natural_leaf === false) {
    return { ok: false, reason: "only targets synthetic products" };
  }
  return { ok: true, reason: w.reason };
}

// ── Duplicate or new? ────────────────────────────────────────────────────────

export type StoryHit = {
  id: string; title: string; source_name: string | null; duplicate_of: string | null;
  bill_id: string | null; state: string | null;
  /** false = hidden as off-topic or junk. */
  active?: boolean | null;
};
export type AlertHit = { id: string; title: string; moderation_status: string; bill_id: string | null; locality: string | null };
export type BillHit = BillForGate & { id: string; state: string; bill_number: string; title: string | null };

export type Found = {
  /** news_items whose url or resolved_url is one of the link's spellings. */
  urlStories: StoryHit[];
  /** policy_alerts (any status) whose source_url is one of them. */
  urlAlerts: AlertHit[];
  /** bills whose own page is this link. */
  urlBills: BillHit[];
  /** Recent news_items with the same headline under another link. */
  titleStories: StoryHit[];
};

export type Verdict =
  | { kind: "story"; story: StoryHit; via: "link" | "headline" }
  | { kind: "alert"; alert: AlertHit }
  | { kind: "bill"; bill: BillHit }
  /** We had it and chose not to post it (hidden story, rejected tip): don't queue it again. */
  | { kind: "seen" }
  | { kind: "new" };

const canonicalFirst = (rows: StoryHit[]) => rows.find((r) => !r.duplicate_of) ?? rows[0];

/**
 * The order matters: an exact link beats a headline, a published story beats
 * a tip, and a tip beats the bill's own page. Only when nothing matches is the
 * link new, and only a new link may create anything.
 */
export function decideLink(f: Found): Verdict {
  const liveStories = f.urlStories.filter((s) => s.active !== false);
  if (liveStories.length) return { kind: "story", story: canonicalFirst(liveStories), via: "link" };
  const openAlerts = f.urlAlerts.filter((a) => a.moderation_status === "approved" || a.moderation_status === "pending");
  if (openAlerts.length) {
    return { kind: "alert", alert: openAlerts.find((a) => a.moderation_status === "approved") ?? openAlerts[0] };
  }
  if (f.urlStories.length || f.urlAlerts.length) return { kind: "seen" };
  if (f.urlBills.length) return { kind: "bill", bill: f.urlBills[0] };
  const liveTitles = f.titleStories.filter((s) => s.active !== false);
  if (liveTitles.length) return { kind: "story", story: canonicalFirst(liveTitles), via: "headline" };
  return { kind: "new" };
}

/** A tracked ordinance whose town or county a headline names, e.g. "Oxford, MS" in "Oxford aldermen vote on kratom". */
export function matchPlace<T extends { locality: string | null; state: string }>(text: string, rows: T[]): T[] {
  const s = String(text ?? "");
  return rows.filter((r) => {
    // "Oxford, MS" only: a junk locality ("Officials, DA") names no real place in its state.
    const [rawPlace, st] = (r.locality ?? "").split(",");
    const place = (rawPlace ?? "").trim();
    if (place.length < 4 || (st ?? "").trim().toUpperCase() !== r.state) return false;
    return new RegExp(`\\b${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i").test(s);
  });
}

/**
 * Which tracked bill a new link is about: exactly one candidate, or none.
 * Two states' bills with the same number is a guess, and a guess must not
 * start a campaign.
 */
export function pickBill<T extends { id: string }>(candidates: T[]): T | null {
  const unique = [...new Map(candidates.map((c) => [c.id, c])).values()];
  return unique.length === 1 ? unique[0] : null;
}

// ── The AI's reading of a new link ───────────────────────────────────────────

export const INTEL_KINDS = ["bill_event", "bop_hearing", "fda_action", "dea_action", "ag_enforcement", "news_break"] as const;
export type IntelKind = (typeof INTEL_KINDS)[number];
const SEVERITIES = ["watch", "alert", "critical"] as const;

export type LinkReading = {
  kratom: boolean;
  kind: IntelKind;
  severity: (typeof SEVERITIES)[number];
  /** 2-letter state, "FED", or null when the AI could not tell. */
  locality: string | null;
  actionNeeded: boolean;
  summary: string;
};

/** Never trust a model's JSON: unknown values fall back, text is capped. */
export function normalizeReading(raw: unknown, fallback: { kratom: boolean; summary: string }): LinkReading {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = INTEL_KINDS.includes(r.kind as IntelKind) ? (r.kind as IntelKind) : "news_break";
  const severity = SEVERITIES.includes(r.severity as LinkReading["severity"]) ? (r.severity as LinkReading["severity"]) : "watch";
  const loc = String(r.locality ?? "").trim().toUpperCase();
  const locality = loc === "FED" || (STATE_NAMES[loc] && loc !== "DC") ? loc : null;
  const summary = typeof r.summary === "string" && r.summary.trim().length >= 20 ? r.summary.trim().slice(0, 600) : fallback.summary;
  return {
    kratom: typeof r.kratom === "boolean" ? r.kratom : fallback.kratom,
    kind,
    severity,
    locality,
    actionNeeded: r.action_needed === true,
    summary,
  };
}
