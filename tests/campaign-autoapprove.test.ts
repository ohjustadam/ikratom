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
import { isCampaignWorthyAlert, isBillConcluded, fpGateDecision, eligibilityVetoSafe, ELIGIBILITY_PATTERNS } from "../scripts/lib/campaign-eligibility.mjs";
import { topicKey, normalizedTitleKey, strongTopicKey, billKey, federalTopicKey } from "../scripts/lib/topic-key.mjs";

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
  it("vetoes syndicated national-trend roundups (the per-state fan-out source)", () => {
    expect(isCampaignWorthyAlert("bill_event", "Why 2 more states will soon ban kratom")).toBe(false);
    expect(isCampaignWorthyAlert("bill_event", "Doctors call kratom next crisis as more US states push bans")).toBe(false);
    expect(isCampaignWorthyAlert("fda_action", "Gas station heroin banned in another state amid nationwide crackdowns")).toBe(false);
    // a single named state's own action must NOT be vetoed
    expect(isCampaignWorthyAlert("bill_event", "Delaware bill to regulate kratom clears House")).toBe(true);
    expect(isCampaignWorthyAlert("bill_event", "SB123 would ban kratom sales statewide")).toBe(true);
    // national roundup is categorical junk → safe to auto-reject, not escalate
    expect(eligibilityVetoSafe("bill_event", "Why 2 more states will soon ban kratom")).toBe(true);
  });
});

/**
 * Structured concluded-bill veto (isBillConcluded). The owner-flagged bug
 * (2026-06-12): the engine approved campaigns for ALREADY-ENACTED bills because
 * bills.status lags reality (status='passed_chamber' while last_action='Enacted').
 * The fix gates on STRUCTURED data (status + active + official last_action), NOT
 * the news headline — so it must catch enacted bills even with a stale status
 * AND must NOT veto live procedural states (the veto-push window).
 */
describe("isBillConcluded", () => {
  it("is concluded by an explicit status", () => {
    expect(isBillConcluded({ status: "enacted" })).toBe(true);
    expect(isBillConcluded({ status: "dead" })).toBe(true);
  });
  it("is concluded by active=false", () => {
    expect(isBillConcluded({ status: "passed_chamber", active: false, last_action: "Chapter 3, Acts, Regular Session, 2024" })).toBe(true);
  });
  it("catches enacted bills whose status enum lags (the prod bug)", () => {
    // Real rows observed 2026-06-12, all status='passed_chamber':
    expect(isBillConcluded({ status: "passed_chamber", active: true, last_action: "Enacted" })).toBe(true);
    expect(isBillConcluded({ status: "passed_chamber", active: true, last_action: "Comp. became Pub. Ch. 502" })).toBe(true);
    expect(isBillConcluded({ status: "passed_chamber", active: true, last_action: "Effective date(s) 07/01/2026" })).toBe(true);
    expect(isBillConcluded({ status: "passed_chamber", active: true, last_action: "Acts of Assembly Chapter text (CHAP0773)" })).toBe(true);
    expect(isBillConcluded({ status: "passed_chamber", active: true, last_action: "Signed by Governor" })).toBe(true);
  });
  it("does NOT veto LIVE procedural states (the veto-push window stays actionable)", () => {
    for (const la of [
      "Engrossed; ready for transmission to Sen.",
      "Delivered to Governor",
      "Transmitted to Governor",
      "Reported favorably by committee",
      "Passed Senate",
      "Read first time",
      "Referred to Committee on Health",
    ]) {
      expect(isBillConcluded({ status: "passed_chamber", active: true, last_action: la })).toBe(false);
    }
  });
  it("handles null/empty safely", () => {
    expect(isBillConcluded(null)).toBe(false);
    expect(isBillConcluded({})).toBe(false);
    expect(isBillConcluded({ status: "introduced", active: true, last_action: null })).toBe(false);
  });
});

/**
 * FP gate grace (fpGateDecision). body_has_kratom_keyword on the linked news row
 * gates approval. The bug (2026-06-12): a null (article not yet keyword-classified)
 * blocked the campaign in "waiting" FOREVER when the source was a Google-News
 * redirect whose body never extracts → 31 genuine anti-kratom CTAs stuck. Fix:
 * a null past the grace window PASSES (proceed FP-unverified) rather than trapping
 * a real campaign — while a confirmed false (not-about-kratom) NEVER passes.
 */
describe("fpGateDecision (FP gate: block / wait / pass)", () => {
  const G = 72;
  it("classified about-kratom (true) → pass immediately", () => {
    expect(fpGateDecision(true, 0, G)).toBe("pass");
  });
  it("confirmed not-about-kratom (false) → block, regardless of age", () => {
    expect(fpGateDecision(false, 1, G)).toBe("block");
    expect(fpGateDecision(false, 99999, G)).toBe("block"); // grace never rescues a real FP
  });
  it("unclassified (null) within grace → wait", () => {
    expect(fpGateDecision(null, 0, G)).toBe("wait");
    expect(fpGateDecision(null, 71, G)).toBe("wait");
  });
  it("unclassified (null) past grace → pass (don't trap a genuine CTA forever)", () => {
    expect(fpGateDecision(null, 72, G)).toBe("pass");
    expect(fpGateDecision(null, 500, G)).toBe("pass");
  });
});

/**
 * Federal-story dedup (federalTopicKey). The national FDA/DEA 7-OH push is ONE
 * story reported with varying verbs/keywords, so strongTopicKey produced a
 * different FED|kw|event key per headline and they never collapsed → one campaign
 * per outlet, flooding the feed. The coarse federal key collapses the whole push
 * to ONE canonical campaign while keeping distinct federal event TYPES separate.
 */
describe("federalTopicKey (coarse federal-story dedup)", () => {
  it("collapses the federal 7-OH scheduling push across varying headlines", () => {
    const k = federalTopicKey(null, "FDA Moves to Restrict 7-OH Opioid Products");
    expect(k).toBe("fed|kratom|restrict");
    for (const t of [
      "FDA seeks to classify 7-OH as Schedule 1 drug",
      "The FDA recommends scheduling kratom’s 7-OH",
      "FDA urges crackdown on 7-OH",
      "FDA Weighs Crackdown on Kratom Products",
      "FDA pushes to ban potent kratom derivative 7-OH",
    ]) {
      expect(federalTopicKey("FED", t)).toBe(k); // all collapse to the same canonical
    }
  });
  it("keeps genuinely-distinct federal event TYPES separate", () => {
    expect(federalTopicKey(null, "DEA holds federal hearing on kratom")).toBe("fed|kratom|hearing");
    expect(federalTopicKey(null, "Congress moves to repeal federal kratom restriction")).toBe("fed|kratom|repeal");
  });
  it("only fires for federal/national campaigns with a real federal signal about kratom", () => {
    expect(federalTopicKey("CA", "FDA Moves to Restrict 7-OH")).toBeNull();      // a STATE campaign, not federal
    expect(federalTopicKey(null, "Spokane considers kratom ban")).toBeNull();    // no federal signal
    expect(federalTopicKey(null, "FDA approves new cancer drug")).toBeNull();    // not about kratom
    expect(federalTopicKey(null, "FDA Warns Dangers of Drug 7-OH")).toBeNull();  // no scheduling/ban event → title key applies
  });
  it("contains no org names or party terms (nonpartisan rule)", () => {
    const ORG_OR_PARTY = /\b(aka|gkc|bae|mac|democrat|republican|gop|liberal|conservative|leftist|rightwing|party|partisan)\b/i;
    // the produced key + the helper's behavior must be event-shape-based, never side-based
    expect(ORG_OR_PARTY.test(String(federalTopicKey(null, "FDA Moves to Restrict 7-OH")))).toBe(false);
  });
});

/**
 * Measured auto-reject (eligibilityVetoSafe). Categorical junk (recall/lawsuit/
 * enforcement news, ag_enforcement, concluded) is SAFE to auto-reject; ambiguous
 * agency news must escalate (a wrong reject buries a real CTA — asymmetric risk).
 */
describe("eligibilityVetoSafe (categorical-junk auto-reject)", () => {
  it("SAFE: ag_enforcement / noise headlines / concluded events", () => {
    expect(eligibilityVetoSafe("ag_enforcement", "AG settles with kratom vendor")).toBe(true);
    expect(eligibilityVetoSafe("fda_action", "FDA recalls contaminated kratom product")).toBe(true);
    expect(eligibilityVetoSafe("dea_action", "Feds seize 7-OH from warehouse")).toBe(true);   // base verb (0198 gap fix)
    expect(eligibilityVetoSafe("dea_action", "Feds seized 7-OH from warehouse")).toBe(true);
    expect(eligibilityVetoSafe("fda_action", "Company sued over kratom marketing")).toBe(true);
    expect(eligibilityVetoSafe("bill_event", "Kratom ban signed into law")).toBe(true);
  });
  it("UNSAFE: an off-pattern agency headline that MIGHT be a real ban-push → escalate", () => {
    expect(eligibilityVetoSafe("fda_action", "FDA targets 7-OH")).toBe(false);
    expect(eligibilityVetoSafe("news_break", "Kratom debated in weekend op-ed")).toBe(false);
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
 * three places with DIFFERENT key formats:
 *   1. DB unique index   — campaign_topic_key() (migration 0107, made bill-aware
 *                          in 0186) → bill:ST|<chamber><num> for bill-numbered
 *                          titles else STATE|kw|event, enforced by
 *                          ux_campaigns_topic_key_live (0108), which EXCLUDES rows
 *                          ending in |unknown|unknown.
 *   2. auto-approve engine — keysFor() = billKey / normalizedTitleKey / strongTopicKey
 *                          (the NARROW STRONG_EVENT_RX). Never reads topic_key.
 *   3. daily janitor      — topicKey() with the BROAD EVENT_RX (not used by the engine).
 *
 * 0186 ALIGNED the bill axis (DB key now == engine billKey for bill titles); the
 * topic-token + event-vocabulary divergence remains intentional. These tests pin
 * the safety-relevant relationship and guard against silently re-diverging (or
 * over-aligning) the keyspaces.
 */

// DB topic-key, ported from supabase/migrations/0107 as amended by 0186
// (campaign_topic_key). Kept in lockstep with that SQL function — if the
// migration's bill/keyword/event logic changes, update this mirror and the
// asserts below. The bill branch reuses billKey (the SQL mirrors it verbatim);
// Postgres \m / \M word-boundaries are emulated with JS \b, and the corpus below
// is chosen to behave identically under both engines.
function dbTopicKey(state: string | null, title: string | null): string | null {
  if (title == null) return null;
  const bk = billKey(state, title); // 0186: bill-numbered titles key like the engine
  if (bk) return bk;
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
  it("every non-title engine key maps to DB-index-enforced space (never the blind spot)", () => {
    // The engine's confident keys (bill:… and STATE|kw|strongEvent) all correspond
    // to a DB key the unique index ENFORCES (never …|unknown|unknown) — so the
    // engine's collapse only ever fires inside a cluster the DB treats as one.
    // Only the engine's title: fallback may land in the DB's blind spot (by design).
    for (const [state, title] of CORPUS) {
      for (const k of engineKeys(state, title)) {
        if (!k.startsWith("title:")) {
          expect(dbEnforces(dbTopicKey(state, title))).toBe(true);
        }
      }
    }
  });

  it("0186: bill-step alerts now ALIGN with the DB key (no longer the blind spot)", () => {
    // Pre-0186 these keyword-free titles were TX|unknown|unknown (index-excluded)
    // and only the engine's billKey collapsed them. Post-0186 the DB key equals
    // the engine billKey and the index enforces it.
    const step1db = dbTopicKey("TX", "TX HB 1097 — Reported engrossed");
    const step2db = dbTopicKey("TX", "TX HB 1097 — Reported favorably as substituted");
    expect(step1db).toBe("bill:TX|hb1097");
    expect(step1db).toBe(step2db);
    expect(dbEnforces(step1db)).toBe(true);
    expect(engineKeys("TX", "TX HB 1097 — Reported engrossed")).toEqual(["bill:TX|hb1097"]);
  });

  it("engine still COVERS the DB blind spot for truly-unparseable titles", () => {
    // No keyword, no event, no bill number → DB key is …|unknown|unknown (the index
    // would let a duplicate row through); the engine still dedups exact repeats via
    // normalizedTitleKey.
    const blind = dbTopicKey("OK", "City council budget meeting notes");
    expect(dbEnforces(blind)).toBe(false);
    expect(engineKeys("OK", "City council budget meeting notes"))
      .toEqual(engineKeys("OK", "City Council  Budget Meeting NOTES")); // case/space-insensitive title key
    expect(engineKeys("OK", "City council budget meeting notes")[0]).toMatch(/^title:/);
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

  it("0186 aligned the BILL axis but the topic-token divergence stays (intentional)", () => {
    // CONVERGENCE: for bill-numbered titles the engine billKey and the DB key now agree.
    expect(billKey("TX", "TX HB 1097 — Reported engrossed"))
      .toBe(dbTopicKey("TX", "TX HB 1097 — Reported engrossed"));
    // REMAINING divergence (intentional): the engine keeps the literal matched
    // keyword; the DB normalizes 7-OH → mitragynine. Don't "fix" this by ===.
    expect(strongTopicKey("FL", "Florida 7OH ban")).toBe("FL|7oh|ban");
    expect(dbTopicKey("FL", "Florida 7OH ban")).toBe("FL|mitragynine|ban");
    expect(strongTopicKey("FL", "Florida 7OH ban")).not.toBe(dbTopicKey("FL", "Florida 7OH ban"));
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
