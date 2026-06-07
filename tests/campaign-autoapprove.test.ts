import { describe, it, expect } from "vitest";
import {
  APPROVE_COLUMNS as ENGINE_APPROVE,
  REJECT_COLUMNS as ENGINE_REJECT,
  SUPERSEDE_COLUMNS as ENGINE_SUPERSEDE,
} from "../scripts/lib/campaign-review-columns.mjs";
import {
  APPROVE_COLUMNS as TS_APPROVE,
  REJECT_COLUMNS as TS_REJECT,
  SUPERSEDE_COLUMNS as TS_SUPERSEDE,
} from "@/modules/admin/campaign-review-shared";
import { isCampaignWorthyAlert, ELIGIBILITY_PATTERNS } from "../scripts/lib/campaign-eligibility.mjs";
import { topicKey, normalizedTitleKey, strongTopicKey, billKey } from "../scripts/lib/topic-key.mjs";

/**
 * Build #3 — campaign auto-approve engine guards. The engine is a .mjs (can't
 * import the TS server action), so the column contract is enforced here: the
 * engine and the manual-review path MUST write identical columns, or an
 * automatic approve diverges from a manual one.
 */
describe("review-column contract: engine .mjs ⇄ TS server action", () => {
  it("approve columns are identical", () => {
    expect({ ...ENGINE_APPROVE }).toEqual({ ...TS_APPROVE });
  });
  it("reject columns are identical", () => {
    expect({ ...ENGINE_REJECT }).toEqual({ ...TS_REJECT });
  });
  it("supersede columns are identical", () => {
    expect({ ...ENGINE_SUPERSEDE }).toEqual({ ...TS_SUPERSEDE });
  });
  it("approve is exactly the active=true / auto_active flip", () => {
    expect({ ...ENGINE_APPROVE }).toEqual({ active: true, review_state: "auto_active" });
  });
});

/**
 * Nonpartisan hard rule (CLAUDE.md) encoded as CI: the patterns that decide
 * which events become campaigns must never reference an advocacy org or a
 * political party — suppression must be event-shape-based, never side-based.
 */
describe("nonpartisan guard on eligibility patterns", () => {
  const ORG_OR_PARTY = /\b(aka|gkc|bae|mac|democrat|republican|gop|liberal|conservative|leftist|rightwing|party|partisan)\b/i;
  for (const [name, re] of Object.entries(ELIGIBILITY_PATTERNS)) {
    it(`${name} contains no org names or party terms`, () => {
      expect(ORG_OR_PARTY.test((re as RegExp).source)).toBe(false);
    });
  }
});

describe("isCampaignWorthyAlert", () => {
  it("accepts real ban / scheduling pushes", () => {
    expect(isCampaignWorthyAlert("bill_event", "SB123 would ban kratom sales statewide")).toBe(true);
    expect(isCampaignWorthyAlert("fda_action", "FDA moves to schedule 7-OH")).toBe(true);
    expect(isCampaignWorthyAlert("bop_hearing", "Board of Pharmacy hearing on kratom rule")).toBe(true);
  });
  it("keeps LIVE procedural bill states actionable (a bill in motion is still a CTA)", () => {
    expect(isCampaignWorthyAlert("bill_event", "HB45 Kratom Ban — Engrossed in Senate")).toBe(true);
    expect(isCampaignWorthyAlert("bill_event", "SB7 kratom ban reported favorably by committee")).toBe(true);
    // the prime veto-push moment — must NOT be vetoed:
    expect(isCampaignWorthyAlert("bill_event", "HB1234 kratom ban delivered to the Governor")).toBe(true);
  });
  it("vetoes already-concluded events + commentary", () => {
    expect(isCampaignWorthyAlert("bill_event", "Kratom ban signed into law")).toBe(false);
    expect(isCampaignWorthyAlert("fda_action", "Kratom ban takes effect July 1")).toBe(false);
    expect(isCampaignWorthyAlert("bill_event", "Kratom act chaptered into session law")).toBe(false);
    expect(isCampaignWorthyAlert("bill_event", "AKA applauds new KCPA passage")).toBe(false);
  });
  it("vetoes recalls / lawsuits / enforcement / ag_enforcement / news", () => {
    expect(isCampaignWorthyAlert("fda_action", "FDA recalls contaminated kratom product")).toBe(false);
    expect(isCampaignWorthyAlert("fda_action", "Company sued over kratom marketing")).toBe(false);
    expect(isCampaignWorthyAlert("ag_enforcement", "AG settles with kratom vendor")).toBe(false);
    expect(isCampaignWorthyAlert("news_break", "Kratom debated in weekend op-ed")).toBe(false);
  });
});

describe("topicKey / normalizedTitleKey dedup keys", () => {
  it("collapses same state+keyword+event", () => {
    const a = topicKey("TN", "Kratom users concerned about TN's ban");
    const b = topicKey("TN", "Kratom ban in Tennessee threatens local shops");
    expect(a).toBe("TN|kratom|ban");
    expect(a).toBe(b);
  });
  it("does NOT collapse distinct events in the same state", () => {
    const ban = topicKey("FL", "Florida kratom ban introduced");
    const hearing = topicKey("FL", "Florida kratom hearing set");
    expect(ban).not.toBe(hearing);
  });
  it("falls back to normalized title when keyword/event unparseable (no over-collapse)", () => {
    const x = topicKey(null, "Unrelated federal headline about wellness funding");
    expect(x.startsWith("title:")).toBe(true);
  });
  it("normalizedTitleKey ignores case/punctuation but separates distinct titles", () => {
    expect(normalizedTitleKey("Kratom Ban!!!")).toBe(normalizedTitleKey("kratom   ban"));
    expect(normalizedTitleKey("Alpha")).not.toBe(normalizedTitleKey("Beta"));
  });
  it("strongTopicKey collapses ONLY on a specific event (engine dedup safety)", () => {
    expect(strongTopicKey("TX", "Texas kratom ban advances")).toBe("TX|kratom|ban");
    expect(strongTopicKey("TX", "Texas kratom hearing set")).toBe("TX|kratom|hearing");
    // generic words must NOT cluster distinct events → null (caller falls back to title)
    expect(strongTopicKey("TX", "Texas kratom community takes action")).toBeNull();
    expect(strongTopicKey("TX", "Texas kratom proposal floated")).toBeNull();
  });
  it("billKey collapses every procedural step of ONE bill (keyword-free titles)", () => {
    const a = billKey("TX", "TX HB 1097 — Reported engrossed");
    const b = billKey("TX", "TX HB 1097 — Reported favorably as substituted");
    expect(a).toBe("bill:TX|hb1097");
    expect(a).toBe(b);
    expect(billKey(null, "UT HB 301 — Enrolled Bill Returned to House")).toBe("bill:UT|hb301");
    // distinct bills stay distinct; non-bill titles return null
    expect(billKey("TX", "TX SB 1097 — first reading")).not.toBe(a);
    expect(billKey("MO", "Kansas City mayor introduces ban on gas-station heroin")).toBeNull();
  });
});

/**
 * Three-keyspace dedup relationship (see docs/DECISIONS.md → "Campaign dedup
 * uses THREE keyspaces, intentionally distinct"). Campaign de-dup is enforced in
 * three places that DO NOT share a key format and are NOT meant to be string-
 * equal:
 *   1. DB unique index   — campaign_topic_key() (migration 0107) → STATE|kw|event,
 *                          enforced by ux_campaigns_topic_key_live (0108), which
 *                          EXCLUDES rows ending in |unknown|unknown.
 *   2. auto-approve engine — keysFor() = billKey / normalizedTitleKey / strongTopicKey
 *                          (the NARROW STRONG_EVENT_RX). Never reads topic_key.
 *   3. daily janitor      — topicKey() with the BROAD EVENT_RX (not used by the engine).
 *
 * These tests pin the safety-relevant relationship, NOT a (false) string-equality.
 * They guard against someone "aligning" the keyspaces and silently changing
 * dedup behavior.
 */

// DB topic-key, ported VERBATIM from supabase/migrations/0107 (campaign_topic_key,
// lines 31-80). Kept in lockstep with that SQL function — if the migration's
// keyword/event lists change, update this mirror and the asserts below. Postgres
// \m / \M word-boundaries are emulated with JS \b; the corpus below is chosen to
// behave identically under both engines.
function dbTopicKey(state: string | null, title: string | null): string | null {
  if (title == null) return null;
  const t = String(title).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  let kw = "unknown";
  if (/\b7-?hydroxymitragynine\b/.test(t)) kw = "mitragynine";
  else if (/\bmitragyn[a-z]*\b/.test(t)) kw = "mitragyna";
  else if (/\b7-?o?h\b/.test(t)) kw = "mitragynine";
  else if (/\bkratomite\b/.test(t)) kw = "kratom";
  else if (/\bkratoms?\b/.test(t)) kw = "kratom";
  else if (/\bgas[- ]?station\b/.test(t)) kw = "gas-station";
  else if (/\btianeptine\b/.test(t)) kw = "tianeptine";
  let ev = "unknown";
  if (/\bban/.test(t)) ev = "ban";
  else if (/\brestrict/.test(t)) ev = "restrict";
  else if (/\bregulat/.test(t)) ev = "regulat";
  else if (/\bhearing/.test(t)) ev = "hearing";
  else if (/\bschedul/.test(t)) ev = "schedule";
  else if (/\benact/.test(t)) ev = "enact";
  else if (/\bveto/.test(t)) ev = "veto";
  else if (/\brepeal/.test(t)) ev = "repeal";
  else if (/\bordinance/.test(t)) ev = "ordinance";
  else if (/\bcrackdown/.test(t)) ev = "crackdown";
  else if (/\blaw\b/.test(t)) ev = "law";
  else if (/\bruling/.test(t)) ev = "ruling";
  else if (/\bpass(es|ed)?/.test(t)) ev = "pass";
  else if (/\bsign(s|ed)?/.test(t)) ev = "sign";
  else if (/\bapprov/.test(t)) ev = "approve";
  else if (/\breject/.test(t)) ev = "reject";
  else if (/\bwithdraw/.test(t)) ev = "withdraw";
  else if (/\bstall/.test(t)) ev = "stall";
  else if (/\bhalt/.test(t)) ev = "halt";
  return `${state ?? "?"}|${kw}|${ev}`;
}

// The DB index (migration 0108) ignores rows whose key ends in |unknown|unknown.
// This emulates its "does the unique index enforce this row?" predicate.
const dbEnforces = (key: string | null): boolean => key != null && !/\|unknown\|unknown$/.test(key);

// Mirror of the engine's keysFor() (auto-approve-campaigns.mjs lines 399-408):
// the keys the engine actually dedups on. NOT the broad topicKey().
function engineKeys(state: string | null, title: string | null): string[] {
  const bk = billKey(state, title);
  if (bk) return [bk];
  const keys: string[] = [normalizedTitleKey(title)];
  const sk = strongTopicKey(state, title);
  if (sk) keys.push(sk);
  return [...new Set(keys)];
}

// Representative backlog title shapes: clean topic events, a strong-only event,
// a keyword-token divergence, DB blind-spot titles, bill-step titles, and a
// broad-only (generic-event) title.
const CORPUS: ReadonlyArray<[string | null, string]> = [
  ["TN", "Kratom users concerned about TN's ban"],
  ["TN", "Kratom ban in Tennessee threatens local shops"],
  ["FL", "Florida kratom hearing set"],
  ["TX", "Texas kratom prohibition advances"],      // strong-only event (DB has no 'prohibit')
  ["FL", "Florida 7OH ban"],                        // keyword token differs engine↔DB
  ["OK", "City council budget meeting notes"],      // DB blind spot: unknown|unknown
  [null, "Unrelated federal headline about wellness funding"], // blind spot, null state
  ["TX", "TX HB 1097 — Reported engrossed"],        // keyword-free bill step
  ["TX", "TX HB 1097 — Reported favorably as substituted"],
  ["TX", "Texas kratom community takes action"],    // generic event: broad-only
];

describe("three-keyspace dedup relationship", () => {
  it("engine's fuzzy key (strongTopicKey) never lands in the DB index blind spot", () => {
    // Every title that yields a strong topic key also yields a DB key the unique
    // index ENFORCES (never …|unknown|unknown) — so the engine's only fuzzy
    // collapse can only fire inside a cluster the DB itself treats as one.
    for (const [state, title] of CORPUS) {
      if (strongTopicKey(state, title) != null) {
        expect(dbEnforces(dbTopicKey(state, title))).toBe(true);
      }
    }
  });

  it("engine COVERS the DB blind spot via exact-title / bill-number keys", () => {
    // A title the DB index ignores (unknown|unknown) — the DB would have let a
    // duplicate row through; the engine still dedups it by exact normalized title.
    const blind = dbTopicKey("OK", "City council budget meeting notes");
    expect(dbEnforces(blind)).toBe(false);
    expect(engineKeys("OK", "City council budget meeting notes"))
      .toEqual(engineKeys("OK", "City Council  Budget Meeting NOTES")); // case/space-insensitive title key
    expect(engineKeys("OK", "City council budget meeting notes")[0]).toMatch(/^title:/);

    // Keyword-free bill-step alerts also fall in the DB blind spot; the engine's
    // billKey collapses the steps the DB punted on.
    expect(dbEnforces(dbTopicKey("TX", "TX HB 1097 — Reported engrossed"))).toBe(false);
    const step1 = engineKeys("TX", "TX HB 1097 — Reported engrossed");
    const step2 = engineKeys("TX", "TX HB 1097 — Reported favorably as substituted");
    expect(step1).toEqual(["bill:TX|hb1097"]);
    expect(step1).toEqual(step2);
  });

  it("engine and DB AGREE on the strong-event grouping (no wrong split)", () => {
    // Two distinct TN-ban headlines: the engine clusters them (shared strong key)
    // AND the DB clusters them (identical DB key) — the engine never splits a
    // cluster the DB joined.
    const t1: [string, string] = ["TN", "Kratom users concerned about TN's ban"];
    const t2: [string, string] = ["TN", "Kratom ban in Tennessee threatens local shops"];
    expect(engineKeys(...t1)).toEqual(expect.arrayContaining(["TN|kratom|ban"]));
    expect(engineKeys(...t2)).toEqual(expect.arrayContaining(["TN|kratom|ban"]));
    expect(dbTopicKey(...t1)).toBe("TN|kratom|ban");
    expect(dbTopicKey(...t1)).toBe(dbTopicKey(...t2));
  });

  it("the keyspaces are different namespaces — NOT string-equal even when both parse", () => {
    // Same title, both keys parse, but the tokens differ (engine keeps the literal
    // matched keyword; the DB normalizes 7-OH → mitragynine). They must NOT be
    // compared by ===.
    expect(strongTopicKey("FL", "Florida 7OH ban")).toBe("FL|7oh|ban");
    expect(dbTopicKey("FL", "Florida 7OH ban")).toBe("FL|mitragynine|ban");
    expect(strongTopicKey("FL", "Florida 7OH ban")).not.toBe(dbTopicKey("FL", "Florida 7OH ban"));
    // engine's title:/bill: keys have no analogue in the DB STATE|kw|event format
    expect(dbTopicKey(null, "Unrelated federal headline about wellness funding")).not.toMatch(/^(title|bill):/);
    expect(billKey("TX", "TX HB 1097 — Reported engrossed")).toMatch(/^bill:/);
  });

  it("the broad janitor topicKey() is a THIRD, broader keyspace the engine does NOT use", () => {
    // One generic-event title → three different answers, proving the engine is
    // neither the DB key nor the broad janitor key:
    const title = "Texas kratom community takes action";
    expect(topicKey("TX", title)).toBe("TX|kratom|action");      // janitor: broad EVENT_RX collapses on 'action'
    expect(strongTopicKey("TX", title)).toBeNull();              // engine: not a strong event → falls back to title
    expect(dbTopicKey("TX", title)).toBe("TX|kratom|unknown");   // DB: 'action' isn't a DB event
  });
});
