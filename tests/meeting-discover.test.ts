/**
 * meeting-discover.test.ts — the safety pins for SearXNG-verified municipal
 * meeting discovery (private/SEARXNG_MEETING_SPEC.md).
 *
 * WHY THIS FILE IS ADVERSARIAL RATHER THAN HAPPY-PATH. scripts/auto-approve-
 * meetings.mjs promotes ANY municipal_meetings row whose ai_confidence clears
 * AUTOPUBLISH_FLOOR and whose source_url is non-empty straight to
 * moderation_status='approved' — onto the public /calendar and into a push
 * notification — with no human click. So a fabricated meeting carrying a high
 * confidence number ships itself to real advocates who plan a drive around it.
 *
 * The pipeline's defense is structural, not prompt-level: the model never
 * authors a URL, a date, an address, or a confidence number. The four tests
 * marked MANDATORY below exist because a guard nobody has watched fail is
 * decoration — each is written so that deleting the guard it covers turns it
 * red, and each says in-line which deletion it catches.
 *
 * House pattern (tests/ban-verify.test.ts, tests/officials-no-gemini.test.ts):
 * pure decision functions plus injected stubs, zero network, zero mocks of
 * fetch inside the pipeline. There is no live SearXNG and no Docker in CI.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  AUTOPUBLISH_FLOOR,
  MEETING_READ_SYSTEM,
  TZ_AMBIGUOUS,
  TZ_BY_STATE,
  checkPageIsAgenda,
  classifyItemContext,
  discoverMeetings,
  extractDateCandidates,
  harvestContacts,
  meetingTierOf,
  pickMeetingDate,
  quoteOffset,
  quoteOnPage,
  rankMeetingCandidates,
  registrableDomain,
  resolveDiscoveredLocality,
  scoreMeetingEvidence,
  toUtcIso,
  verifyCandidate,
  zoneHintFromText,
} from "../scripts/lib/meeting-discover.mjs";
import { searxngSearch } from "../scripts/lib/searxng.mjs";

// ---------------------------------------------------------------------------
// Typed views over the .mjs boundary
//
// meeting-discover.mjs is JavaScript: its JSDoc types the row as `object`, so
// TypeScript cannot see the field names. These aliases are the row contract
// §5's write payload depends on — writing them out here means a field rename
// in the engine shows up as a failing test rather than as an `undefined`
// silently inserted into municipal_meetings.
// ---------------------------------------------------------------------------

type Row = {
  state: string;
  place: string;
  locality: string;
  body_name: string | null;
  meetingAtIso: string;
  format: string;
  zoom_url: string | null;
  livestream_url: string | null;
  public_comment_signup_url: string | null;
  in_person_address: string | null;
  fetchedUrl: string;
  source_url: string;
  agenda_url: string;
  quote: string;
  tier: string;
  itemContext: string;
  dateSource: string;
  dateAmbiguous: boolean;
  tzUsed: string;
  tzAssumed: boolean;
  tzAmbiguousState: boolean;
  engineProvider: string;
  via: string;
  query: string;
  confidence: number;
  publishable: boolean;
  reason: string;
};

type VerifyResult = { status: string; reason?: string; row?: Row; readerOk?: boolean; isAgenda?: boolean };
type DiscoverResult = {
  status: string;
  rows: Row[];
  searched: number;
  searchFailed: number;
  fetched: number;
  readerFailed: number;
  agendaHits: number;
  rejected: number;
  reason: string | null;
};
type Ev = {
  quoteVerified: boolean;
  dateVerified: boolean;
  kratomInQuote: boolean;
  tier: string;
  isAgendaPage: boolean;
  isArchive: boolean;
  itemContext: string;
  hasStatedTime: boolean;
  dateAmbiguous: boolean;
  jurisdictionOk: boolean;
  gazetteerOk: boolean;
};
type Score = { confidence: number; publishable: boolean; reason: string };
type Opts = Record<string, unknown>;

const callVerify = async (o: Opts): Promise<VerifyResult> =>
  (await verifyCandidate(o as unknown as Parameters<typeof verifyCandidate>[0])) as unknown as VerifyResult;
const callDiscover = async (o: Opts): Promise<DiscoverResult> =>
  (await discoverMeetings(o as unknown as Parameters<typeof discoverMeetings>[0])) as unknown as DiscoverResult;
const scoreOf = (ev: Ev): Score => scoreMeetingEvidence(ev) as Score;

// ---------------------------------------------------------------------------
// Fixtures — one real-shaped Legistar council packet, in two variants that
// differ ONLY in where the kratom words sit. Same city, same date, same host,
// same tier: the A/B isolates the item-context binding from everything else.
// ---------------------------------------------------------------------------

/** Injected everywhere a clock is read, so the fixtures never rot. Real
 *  `new Date()` survives only in checkPageIsAgenda / rankMeetingCandidates,
 *  which is why no fixture URL carries a 4-digit year in its path. */
const NOW = new Date("2026-09-16T12:00:00.000Z");

const LEGISTAR_URL = "https://sarasota.legistar.com/View.ashx?M=A&ID=118774";
const GOV_URL = "https://www.sarasotafl.gov/agenda/city-commission-regular";
const SEARCH_TITLE = "City Commission Regular Meeting Agenda — City of Sarasota";

const AGENDA_HEADER = `CITY OF SARASOTA, FLORIDA
City Commission — Regular Meeting Agenda
Meeting Date/Time: Tuesday, October 6, 2026 6:00 PM
Location: Commission Chambers, City Hall, 1565 First Street, Sarasota, Florida 34236
Watch the meeting live: https://www.youtube.com/watch?v=9bZkp7q19f0
Join by Zoom: https://us02web.zoom.us/j/84512277901
To sign up to speak during public comment, visit https://www.sarasotafl.gov/speaker-signup before 4:00 p.m. on the day of the meeting.
`;

const AGENDA_OPENING = `
CALL TO ORDER
PLEDGE OF ALLEGIANCE
ROLL CALL

APPROVAL OF MINUTES
Item No. 1 - Approval of the minutes of the regular meeting held Wednesday, September 2, 2026.

CONSENT AGENDA
Item No. 2 - Award of contract for the Bayfront Drive resurfacing project to Gulf Coast Paving, Inc., in an amount not to exceed four hundred twelve thousand dollars.
Item No. 3 - Acceptance of the quarterly financial report of the City of Sarasota for the period ending June 30.
Item No. 4 - Authorization for the City Manager to execute an interlocal agreement with Sarasota County for shared traffic signal maintenance along Fruitville Road.
Item No. 5 - Adoption of a resolution accepting a Florida Department of Transportation grant for pedestrian safety improvements in the Rosemary District.
`;

/** The real thing: a scheduled, noticed, second-reading kratom ordinance. */
const KRATOM_ITEM = `
UNFINISHED BUSINESS
Item No. 9 - Ordinance No. 26-5412, second reading and public hearing: an ordinance of the City of Sarasota, Florida, prohibiting the sale of kratom and 7-hydroxymitragynine products to persons under twenty-one years of age, providing for penalties, and establishing an effective date.
`;

/** The attack: the same packet with NO kratom item, whose correspondence
 *  attachment carries a resident's letter asking for a ban. Every date, quote,
 *  host and jurisdiction check passes. The claim "kratom is on the agenda" is
 *  still false. */
const NON_KRATOM_ITEM = `
UNFINISHED BUSINESS
Item No. 9 - Ordinance No. 26-5412, second reading and public hearing: an ordinance of the City of Sarasota, Florida, amending the zoning code to permit accessory dwelling units on single-family lots, providing for penalties, and establishing an effective date.
`;

const CORRESPONDENCE = `
CORRESPONDENCE AND COMMUNICATIONS RECEIVED
Item No. 13 - Letter from a resident of the 3400 block of Bahia Vista Street: "I urge the Council to ban kratom and the other unregulated gas station drugs sold at the smoke shop on the corner." Received and filed.
`;

const AGENDA_TAIL = `
NEW BUSINESS
Item No. 10 - Discussion and possible action regarding the downtown Sarasota parking study prepared by the consultant team, including proposed changes to on-street metered rates and to the residential permit boundaries in the Laurel Park neighborhood.
Item No. 11 - Presentation by the Sarasota Police Department on quarterly crime statistics, including a summary of calls for service in the Newtown and Gillespie Park neighborhoods and an update on the community policing pilot program.
Item No. 12 - Board appointment: consideration of one vacancy on the Sarasota Public Art Committee for a term expiring in three years.

ADJOURNMENT
`;

const CLEAN_AGENDA = AGENDA_HEADER + AGENDA_OPENING + KRATOM_ITEM + AGENDA_TAIL;
const ATTACK_AGENDA = AGENDA_HEADER + AGENDA_OPENING + NON_KRATOM_ITEM + CORRESPONDENCE + AGENDA_TAIL;

/** Verbatim spans, taken out of the fixtures by slice so a fixture edit can
 *  never leave a quote that only looks verbatim. */
const CLEAN_QUOTE =
  "Ordinance No. 26-5412, second reading and public hearing: an ordinance of the City of Sarasota, Florida, prohibiting the sale of kratom and 7-hydroxymitragynine products to persons under twenty-one years of age";
const ATTACK_QUOTE =
  "I urge the Council to ban kratom and the other unregulated gas station drugs sold at the smoke shop on the corner.";
const PARAPHRASE = "The Commission will consider a proposed ordinance regulating the retail sale of kratom products.";

/** The reader's answer sheet — only the eight fields MEETING_READ_SYSTEM
 *  declares. Tests that smuggle extra keys in do it explicitly. */
const goodRead = (over: Record<string, unknown> = {}) => ({
  page_jurisdiction: "Sarasota, Florida",
  body_name: "City Commission",
  is_meeting_agenda: true,
  is_past_meeting: false,
  kratom_item_present: true,
  kratom_item_quote: CLEAN_QUOTE,
  date_choice: 0,
  meeting_format: "in_person",
  ...over,
});

const pageStub = (text: string | null) => async () => text;
const readerStub = (parsed: unknown, provider = "stub-openrouter") => async () => ({ provider, parsed, elapsedMs: 4 });

/** The standard call: one candidate URL, one fetched page, one reader answer. */
const verifyWith = (text: string, parsed: unknown, over: Opts = {}) =>
  callVerify({
    url: LEGISTAR_URL,
    scopeState: "FL",
    stateName: "Florida",
    title: SEARCH_TITLE,
    query: "kratom agenda site:legistar.com",
    now: NOW,
    fetchPage: pageStub(text),
    ai: readerStub(parsed),
    ...over,
  });

// ---------------------------------------------------------------------------
// 1. MANDATORY — THE ATTACK TEST
// ---------------------------------------------------------------------------

describe("MANDATORY 1 — the correspondence attack (item-context binding)", () => {
  it("the fixture is a genuine packet: real future date, real city, verbatim quote", () => {
    // Everything the row asserts EXCEPT "kratom is an agenda item" is true, so
    // no other gate can be credited with catching this.
    expect(ATTACK_AGENDA).toContain(ATTACK_QUOTE);
    expect(quoteOnPage(ATTACK_QUOTE, ATTACK_AGENDA)).toBe(true);
    const cands = extractDateCandidates(ATTACK_AGENDA, { now: NOW, state: "FL" });
    expect(cands).toHaveLength(1);
    expect(cands[0].labeled).toBe(true);
    expect(cands[0].hasTime).toBe(true);
    expect(checkPageIsAgenda({ url: LEGISTAR_URL, text: ATTACK_AGENDA, title: SEARCH_TITLE })).toEqual({
      isAgenda: true,
      isArchive: false,
    });
  });

  it('classifies "I urge the Council to ban kratom" in CORRESPONDENCE as incidental', () => {
    expect(classifyItemContext(ATTACK_AGENDA, ATTACK_QUOTE)).toBe("incidental");
    // And the same sentence sitting in a scheduled item is NOT incidental — so
    // the verdict comes from the neighbourhood, not from the sentence.
    expect(classifyItemContext(CLEAN_AGENDA, CLEAN_QUOTE)).toBe("agenda_item");
  });

  it("scores the attack below the auto-publish floor", () => {
    const ev: Ev = {
      quoteVerified: true,
      dateVerified: true,
      kratomInQuote: true,
      tier: "vendor",
      isAgendaPage: true,
      isArchive: false,
      itemContext: classifyItemContext(ATTACK_AGENDA, ATTACK_QUOTE),
      hasStatedTime: true,
      dateAmbiguous: false,
      jurisdictionOk: true,
      gazetteerOk: true,
    };
    const s = scoreOf(ev);
    expect(s.publishable).toBe(false);
    expect(s.confidence).toBeLessThan(AUTOPUBLISH_FLOOR);
    expect(s.confidence).toBe(0.75);
    expect(s.reason).toContain("item-context=incidental");

    // THE RED-IF-DELETED PROOF. The identical evidence with item context
    // flipped is a 0.90 auto-publish. Delete the NEGATING_MARKERS check in
    // classifyItemContext and the assertions above become this instead —
    // the correspondence letter ships itself to /calendar and to push.
    expect(scoreOf({ ...ev, itemContext: "agenda_item" })).toMatchObject({ confidence: 0.9, publishable: true });
  });

  it("end to end: the attack page yields a HELD row, never a published one", async () => {
    const r = await verifyWith(ATTACK_AGENDA, goodRead({ kratom_item_quote: ATTACK_QUOTE }));
    expect(r.status).toBe("row");
    const row = r.row as Row;
    expect(row.itemContext).toBe("incidental");
    expect(row.publishable).toBe(false);
    expect(row.confidence).toBeLessThan(AUTOPUBLISH_FLOOR);
    // It is still a real meeting in a real city — held for a human, not discarded.
    expect(row.locality).toBe("Sarasota, FL");
    expect(row.meetingAtIso).toBe("2026-10-06T22:00:00.000Z");
  });

  it("fails closed when affirming and negating markers share a window", () => {
    // Both marker sets routinely co-occur in one Legistar window. Negation has
    // to win or the marker soup decides by ordering accident.
    const mixed = "Item No. 5 — Ordinance regulating kratom retail sales. Correspondence received and filed.";
    expect(classifyItemContext(mixed, "Ordinance regulating kratom retail sales")).toBe("incidental");
  });

  it("returns unknown — never agenda_item — for a quote that is not on the page", () => {
    expect(classifyItemContext(CLEAN_AGENDA, PARAPHRASE)).toBe("unknown");
    expect(classifyItemContext(CLEAN_AGENDA, "kratom")).toBe("unknown"); // <12 chars is not evidence
  });
});

// ---------------------------------------------------------------------------
// 2. MANDATORY — QUOTE CONTAINMENT
// ---------------------------------------------------------------------------

describe("MANDATORY 2 — a paraphrase invalidates the extraction", () => {
  it("the paraphrase is plausible and is NOT on the page", () => {
    expect(PARAPHRASE).toMatch(/kratom/);
    expect(CLEAN_AGENDA).not.toContain(PARAPHRASE);
    expect(quoteOffset(PARAPHRASE, CLEAN_AGENDA)).toBe(-1);
    expect(quoteOnPage(PARAPHRASE, CLEAN_AGENDA)).toBe(false);
  });

  it("rejects the candidate rather than writing a row", async () => {
    const r = await verifyWith(CLEAN_AGENDA, goodRead({ kratom_item_quote: PARAPHRASE }));
    expect(r.status).toBe("reject");
    expect(r.reason).toBe("quote-not-on-page");
    expect(r.row).toBeUndefined();
    // Counted as a reader that ANSWERED — this is a bad answer, not an outage.
    expect(r.readerOk).toBe(true);
  });

  it("RED-IF-DELETED: the same call with the verbatim span is accepted", async () => {
    const r = await verifyWith(CLEAN_AGENDA, goodRead());
    expect(r.status).toBe("row");
    expect((r.row as Row).quote).toBe(CLEAN_QUOTE);
  });

  it("tolerates whitespace and punctuation noise in a faithful copy", () => {
    const noisy = `  ${CLEAN_QUOTE.replace(/ /g, "\n  ").replace(/,/g, " ,")}  `;
    expect(quoteOnPage(noisy, CLEAN_AGENDA)).toBe(true);
  });

  it("rejects a quote with no kratom term even when it IS verbatim", async () => {
    const onPage = "Approval of the minutes of the regular meeting held Wednesday, September 2, 2026";
    expect(CLEAN_AGENDA).toContain(onPage);
    const r = await verifyWith(CLEAN_AGENDA, goodRead({ kratom_item_quote: onPage }));
    expect(r.status).toBe("reject");
    expect(r.reason).toBe("quote-has-no-kratom-term");
  });

  it("rejects a too-short quote — a word is not evidence", () => {
    expect(quoteOffset("kratom", CLEAN_AGENDA)).toBe(-1);
    expect(quoteOffset("", CLEAN_AGENDA)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// 3. MANDATORY — THE MODEL CANNOT AUTHOR A DATE (OR A URL, ADDRESS, NUMBER)
// ---------------------------------------------------------------------------

describe("MANDATORY 3 — code supplies the date, the URL, the address, the number", () => {
  /** A hostile reader response: an out-of-range index, plus every field the
   *  retired Gemini path used to trust, all of them fabricated. */
  const HOSTILE = goodRead({
    date_choice: 7,
    meeting_iso: "2031-01-01T19:00:00Z",
    source_url: "https://evil.example.com/fake",
    agenda_url: "https://evil.example.com/fake",
    in_person_address: "1 Evil Street, Nowhere, TX 77001",
    zoom_url: "https://us02web.zoom.us/j/00000000000",
    confidence: 0.99,
    state: "TX",
    locality: "Nowhere, TX",
  });

  it("takes the date from the code-extracted candidate list, not the model", async () => {
    const r = await verifyWith(CLEAN_AGENDA, HOSTILE);
    expect(r.status).toBe("row");
    const row = r.row as Row;
    const cands = extractDateCandidates(CLEAN_AGENDA, { now: NOW, state: "FL" });
    expect(row.meetingAtIso).toBe(toUtcIso(cands[0], "FL"));
    expect(row.meetingAtIso).toBe("2026-10-06T22:00:00.000Z");
    // An unusable index falls back to code's own pick and says so.
    expect(row.dateSource).toBe("code_fallback");
  });

  it("no fabricated value reaches the row — checked across the whole object", async () => {
    const r = await verifyWith(CLEAN_AGENDA, HOSTILE);
    const blob = JSON.stringify(r.row);
    for (const forged of [
      "2031",
      "evil.example.com",
      "1 Evil Street",
      "j/00000000000",
      "0.99",
      "Nowhere",
    ]) {
      expect(blob).not.toContain(forged);
    }
  });

  it("carries OUR fetched URL into every URL column", async () => {
    const r = await verifyWith(CLEAN_AGENDA, HOSTILE);
    const row = r.row as Row;
    expect(row.fetchedUrl).toBe(LEGISTAR_URL);
    expect(row.source_url).toBe(LEGISTAR_URL);
    expect(row.agenda_url).toBe(LEGISTAR_URL);
  });

  it("the state is the page's, not the model's claimed TX", async () => {
    const r = await verifyWith(CLEAN_AGENDA, HOSTILE);
    expect((r.row as Row).state).toBe("FL");
    expect((r.row as Row).locality).toBe("Sarasota, FL");
  });

  it("the confidence is a scorer value, never the model's 0.99", async () => {
    const r = await verifyWith(CLEAN_AGENDA, HOSTILE);
    expect([0, 0.6, 0.75, 0.9]).toContain((r.row as Row).confidence);
  });

  it("contacts come from the page — the model's address and Zoom link are ignored", async () => {
    const r = await verifyWith(CLEAN_AGENDA, HOSTILE);
    const row = r.row as Row;
    expect(row.zoom_url).toBe("https://us02web.zoom.us/j/84512277901");
    expect(row.in_person_address).toContain("1565 First Street");
    expect(CLEAN_AGENDA).toContain(row.in_person_address as string);
  });

  it("hands the reader indices, not a place to write a date", async () => {
    let prompt = "";
    await verifyWith(CLEAN_AGENDA, goodRead(), {
      ai: async (req: { userPrompt?: string }) => {
        prompt = String(req?.userPrompt ?? "");
        return { provider: "stub", parsed: goodRead(), elapsedMs: 1 };
      },
    });
    expect(prompt).toContain("DATE CANDIDATES (choose by index)");
    expect(prompt).toMatch(/\[0\] .*October 6, 2026/);
  });
});

// ---------------------------------------------------------------------------
// 4. MANDATORY — SCHEMA PIN (modelled on tests/officials-no-gemini.test.ts)
// ---------------------------------------------------------------------------

/** The eight fields the reader is allowed to answer. No URL, no date string,
 *  no address, no confidence number — code supplies all four. */
const ALLOWED_READER_FIELDS = [
  "page_jurisdiction",
  "body_name",
  "is_meeting_agenda",
  "is_past_meeting",
  "kratom_item_present",
  "kratom_item_quote",
  "date_choice",
  "meeting_format",
];

const ENGINE_FILE = "scripts/lib/meeting-discover.mjs";
const CALLER_FILE = "scripts/discover-municipal-meetings.mjs";

describe("MANDATORY 4a — MEETING_READ_SYSTEM declares no forgeable field", () => {
  const block = MEETING_READ_SYSTEM.slice(MEETING_READ_SYSTEM.indexOf("{"), MEETING_READ_SYSTEM.indexOf("\n}") + 2);
  const fields = [...block.matchAll(/^\s*"([a-z_]+)"\s*:/gm)].map((m) => m[1]);

  it("exposes exactly the eight multiple-choice fields", () => {
    expect(fields.length).toBeGreaterThan(0); // non-vacuity: the scan must find the schema
    expect(fields).toEqual(ALLOWED_READER_FIELDS);
  });

  it("has no url / date-string / address / confidence slot", () => {
    for (const f of fields) {
      expect(f).not.toMatch(/url|address|confidence|score|probability/);
      // date_choice is an INDEX into code's list; any other date-shaped field
      // would be the model writing a date.
      if (/date|time|iso|when/.test(f)) expect(f).toBe("date_choice");
    }
  });

  it("says so in the rules too, so a well-behaved model does not improvise", () => {
    expect(MEETING_READ_SYSTEM).toContain("NEVER write a date yourself");
    expect(MEETING_READ_SYSTEM).toContain("There is no field for a URL, a date string, an address, or a confidence number");
  });
});

describe("MANDATORY 4b — the engine never reads a civic fact off a parsed object", () => {
  const src = readFileSync(ENGINE_FILE, "utf8");
  const start = src.indexOf("export async function verifyCandidate");
  const end = src.indexOf("export async function logMeetingDiscover");
  const body = src.slice(start, end);

  it("the source scan actually found verifyCandidate", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("reads ONLY the declared reader fields off the parsed response", () => {
    const bind = body.match(/const\s+(\w+)\s*=\s*result\s*\??\.\s*parsed\b/);
    expect(bind).not.toBeNull();
    const id = (bind as RegExpMatchArray)[1];
    const reads = [...body.matchAll(new RegExp(`\\b${id}\\s*\\??\\.\\s*([A-Za-z_][A-Za-z0-9_]*)`, "g"))].map((m) => m[1]);
    expect(reads.length).toBeGreaterThanOrEqual(6); // non-vacuity: a rename must not silently empty this
    for (const field of reads) expect(ALLOWED_READER_FIELDS).toContain(field);
    // A computed access would walk straight past the scan above.
    expect(new RegExp(`\\b${id}\\s*\\[`).test(body)).toBe(false);
  });

  it("binds the row's URLs to the URL this process fetched", () => {
    expect(body).toMatch(/fetchedUrl:\s*url\b/);
    expect(body).toMatch(/source_url:\s*url\b/);
    expect(body).toMatch(/agenda_url:\s*url\b/);
  });

  it("takes the confidence from the scorer and nowhere else", () => {
    expect(body).toMatch(/confidence:\s*score\.confidence\b/);
    const numbers = [...src.matchAll(/\bconfidence:\s*([0-9.]+)/g)].map((m) => m[1]);
    // The only literal confidences in the file are the scorer's own ladder
    // (0/0.60/0.75/0.90) and the fuse's 0.80 hold.
    for (const n of numbers) expect(["0", "0.60", "0.75", "0.90", "0.80"]).toContain(n);
  });
});

describe("MANDATORY 4c — the caller writes no model-authored civic fact", () => {
  // The engine can only protect the row it builds; the caller is what puts a
  // row in the table. Every assertion here failed against the pre-rewrite
  // caller, which inserted m.source_url / m.meeting_iso / m.confidence straight
  // out of Gemini JSON — so this block is a pin on the rewrite, not a
  // restatement of it. Gemini may still hand us URLs as LEADS (they go through
  // verifyCandidate like any other); what it may not do is author a stored fact.
  const src = readFileSync(CALLER_FILE, "utf8");

  it("routes candidates through the verified pipeline", () => {
    expect(src).toMatch(/from\s+["']\.\/lib\/meeting-discover\.mjs["']/);
    expect(src).toMatch(/\b(discoverMeetings|verifyCandidate)\b/);
  });

  it("never reads a model-authored date, excerpt or contact URL as a property", () => {
    // Property-shaped only: the lead-generation prompt may still NAME these
    // fields as text, but nothing may read one off a parsed object.
    expect(src).not.toMatch(/[.?]\s*(?:meeting_iso|agenda_excerpt|public_comment_url)\b/);
  });

  it("never re-labels a row as the retired gemini_grounded path", () => {
    expect(src).not.toMatch(/discovered_via:\s*["']gemini_grounded["']/);
  });

  it("writes ai_confidence from the scorer's row", () => {
    const rhs = [...src.matchAll(/ai_confidence:\s*([^,\n]+)/g)].map((m) => m[1]);
    expect(rhs.length).toBeGreaterThan(0); // non-vacuity: the write path must exist
    // `payload.ai_confidence` is the enrich pass re-using the value it just
    // built from row.confidence — the same number, one hop later. Anything
    // else (a literal, a model field, a clamp of one) fails here.
    for (const v of rhs) expect(v).toMatch(/\b(?:row\.confidence|payload\.ai_confidence)\b/);
  });

  it("writes meeting_at from code's computed instant", () => {
    const rhs = [...src.matchAll(/meeting_at:\s*([^,\n]+)/g)].map((m) => m[1]);
    expect(rhs.length).toBeGreaterThan(0);
    for (const v of rhs) expect(v).not.toMatch(/\bm\s*\??\.|parsed|meeting_iso/);
  });
});

// ---------------------------------------------------------------------------
// 5. The scorer — coherence, and publication actually being reachable
// ---------------------------------------------------------------------------

describe("scoreMeetingEvidence — exhaustive flag cross-product", () => {
  const TIERS = ["official", "vendor", "news", "aggregator", "unknown"];
  const CONTEXTS = ["agenda_item", "incidental", "unknown"];
  const bools = [true, false];
  const all: Array<{ ev: Ev; s: Score }> = [];
  for (const quoteVerified of bools)
    for (const dateVerified of bools)
      for (const kratomInQuote of bools)
        for (const tier of TIERS)
          for (const isAgendaPage of bools)
            for (const isArchive of bools)
              for (const itemContext of CONTEXTS)
                for (const hasStatedTime of bools)
                  for (const dateAmbiguous of bools)
                    for (const jurisdictionOk of bools)
                      for (const gazetteerOk of bools) {
                        const ev: Ev = {
                          quoteVerified, dateVerified, kratomInQuote, tier, isAgendaPage,
                          isArchive, itemContext, hasStatedTime, dateAmbiguous, jurisdictionOk, gazetteerOk,
                        };
                        all.push({ ev, s: scoreOf(ev) });
                      }

  it("covers the whole space (7,680 combinations)", () => {
    expect(all).toHaveLength(7680);
  });

  it("publishable === (confidence >= AUTOPUBLISH_FLOOR), with no exceptions", () => {
    const broken = all.filter(({ s }) => s.publishable !== s.confidence >= AUTOPUBLISH_FLOOR);
    expect(broken).toHaveLength(0);
  });

  it("publishable implies every structural precondition", () => {
    for (const { ev, s } of all) {
      if (!s.publishable) continue;
      expect(ev.itemContext).toBe("agenda_item");
      expect(["official", "vendor"]).toContain(ev.tier);
      expect(ev.quoteVerified && ev.dateVerified && ev.kratomInQuote).toBe(true);
      expect(ev.isAgendaPage && !ev.isArchive).toBe(true);
      expect(ev.hasStatedTime && !ev.dateAmbiguous).toBe(true);
      expect(ev.jurisdictionOk && ev.gazetteerOk).toBe(true);
    }
  });

  it("emits only the four ladder values", () => {
    expect([...new Set(all.map(({ s }) => s.confidence))].sort()).toEqual([0, 0.6, 0.75, 0.9]);
  });

  it("REACHABILITY: publication is possible — a design that never publishes is broken too", () => {
    // Guarding against the opposite failure. An engine that can never reach
    // AUTOPUBLISH_FLOOR reports a clean empty run forever, which is the same
    // silent-nothing this PR exists to end.
    const publishable = all.filter(({ s }) => s.publishable);
    expect(publishable.length).toBeGreaterThan(0);
    expect(publishable.every(({ s }) => s.confidence === 0.9)).toBe(true);
  });

  it("a SINGLE fully-verified official or vendor source is enough", () => {
    const strong = (tier: string): Ev => ({
      quoteVerified: true, dateVerified: true, kratomInQuote: true, tier,
      isAgendaPage: true, isArchive: false, itemContext: "agenda_item",
      hasStatedTime: true, dateAmbiguous: false, jurisdictionOk: true, gazetteerOk: true,
    });
    expect(scoreOf(strong("official"))).toMatchObject({ confidence: 0.9, publishable: true });
    expect(scoreOf(strong("vendor"))).toMatchObject({ confidence: 0.9, publishable: true });
    expect(scoreOf(strong("news"))).toMatchObject({ confidence: 0.6, publishable: false });
    expect(scoreOf(strong("aggregator"))).toMatchObject({ confidence: 0.6, publishable: false });
  });

  it("names every weakness in the held reason, so an admin sees what to check", () => {
    const held = scoreOf({
      quoteVerified: true, dateVerified: true, kratomInQuote: true, tier: "official",
      isAgendaPage: true, isArchive: false, itemContext: "unknown",
      hasStatedTime: false, dateAmbiguous: true, jurisdictionOk: false, gazetteerOk: false,
    });
    expect(held.confidence).toBe(0.75);
    for (const why of ["item-context=unknown", "no time of day stated", "multiple in-window dates", "jurisdiction unconfirmed", "gazetteer unconfirmed"]) {
      expect(held.reason).toContain(why);
    }
  });

  it("hard-fails to 0 when the three containment facts are not proven", () => {
    const base = { tier: "official", isAgendaPage: true, isArchive: false, itemContext: "agenda_item", hasStatedTime: true, dateAmbiguous: false, jurisdictionOk: true, gazetteerOk: true };
    expect(scoreOf({ ...base, quoteVerified: false, dateVerified: true, kratomInQuote: true })).toMatchObject({ confidence: 0, reason: "quote-not-on-page" });
    expect(scoreOf({ ...base, quoteVerified: true, dateVerified: false, kratomInQuote: true })).toMatchObject({ confidence: 0, reason: "date-not-on-page" });
    expect(scoreOf({ ...base, quoteVerified: true, dateVerified: true, kratomInQuote: false })).toMatchObject({ confidence: 0, reason: "quote-has-no-kratom-term" });
  });
});

// ---------------------------------------------------------------------------
// 6. verifyCandidate — the gates in firing order
// ---------------------------------------------------------------------------

describe("verifyCandidate — one verified vendor page publishes at 0.90", () => {
  it("builds the full row from the fetched page", async () => {
    const r = await verifyWith(CLEAN_AGENDA, goodRead());
    expect(r.status).toBe("row");
    const row = r.row as Row;
    expect(row).toMatchObject({
      state: "FL",
      place: "Sarasota",
      locality: "Sarasota, FL",
      body_name: "City Commission",
      format: "in_person",
      tier: "vendor",
      itemContext: "agenda_item",
      dateSource: "reader_choice[0]",
      dateAmbiguous: false,
      confidence: 0.9,
      publishable: true,
      via: "searxng_verified",
      engineProvider: "stub-openrouter",
    });
    expect(row.meetingAtIso).toBe("2026-10-06T22:00:00.000Z");
    expect(row.tzUsed).toBe("America/New_York");
    expect(row.tzAssumed).toBe(true); // the page states no zone token
    expect(row.tzAmbiguousState).toBe(true); // FL is split; ai_notes has to say so
  });

  it("does the same from an official .gov host", async () => {
    const r = await verifyWith(CLEAN_AGENDA, goodRead(), { url: GOV_URL });
    const row = r.row as Row;
    expect(row.tier).toBe("official");
    expect(row.publishable).toBe(true);
    expect(row.source_url).toBe(GOV_URL);
  });

  it("counts a fetch failure instead of inferring 'nothing found'", async () => {
    const r = await verifyWith(CLEAN_AGENDA, goodRead(), { fetchPage: pageStub(null) });
    expect(r.status).toBe("fetch_failed");
  });

  it("counts a reader throw and a prose answer as reader failures, not rejects", async () => {
    const thrown = await verifyWith(CLEAN_AGENDA, goodRead(), {
      ai: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:11434"); },
    });
    expect(thrown.status).toBe("reader_failed");
    const prose = await verifyWith(CLEAN_AGENDA, null);
    expect(prose.status).toBe("reader_failed");
    expect(prose.reason).toBe("no JSON in reader response");
  });

  it("spends no reader call on a page with no kratom term", async () => {
    let called = 0;
    const r = await verifyWith("A regular meeting agenda with a Tuesday, October 6, 2026 6:00 PM item about sidewalks.", goodRead(), {
      ai: async () => { called++; return { provider: "stub", parsed: goodRead(), elapsedMs: 1 }; },
    });
    expect(r.status).toBe("reject");
    expect(r.reason).toBe("no-kratom-keyword");
    expect(called).toBe(0);
  });

  it("spends no reader call on a page with no in-window date", async () => {
    let called = 0;
    const stale = CLEAN_AGENDA.replace(/October 6, 2026/g, "October 6, 2019").replace(/September 2, 2026/g, "September 2, 2019");
    const r = await verifyWith(stale, goodRead(), {
      ai: async () => { called++; return { provider: "stub", parsed: goodRead(), elapsedMs: 1 }; },
    });
    expect(r.status).toBe("reject");
    expect(r.reason).toBe("no-in-window-date");
    expect(called).toBe(0);
  });

  it("rejects an archive URL before any spend", async () => {
    const r = await verifyWith(CLEAN_AGENDA, goodRead(), { url: "https://sarasota.legistar.com/minutes/regular-commission" });
    expect(r.status).toBe("reject");
    expect(r.reason).toBe("archive");
  });

  it("honours the model's own negative answers", async () => {
    expect((await verifyWith(CLEAN_AGENDA, goodRead({ is_meeting_agenda: false }))).reason).toBe("not-a-meeting-agenda");
    expect((await verifyWith(CLEAN_AGENDA, goodRead({ is_past_meeting: true }))).reason).toBe("past-meeting");
    expect((await verifyWith(CLEAN_AGENDA, goodRead({ kratom_item_present: false }))).reason).toBe("no-kratom-item");
  });

  it("rejects a page whose gazetteer state contradicts the bucket", async () => {
    const oregon = CLEAN_AGENDA.replace(/Florida/g, "Oregon").replace(/Sarasota/g, "Salem");
    const r = await verifyWith(oregon, goodRead({ page_jurisdiction: "Salem, Oregon", kratom_item_quote: CLEAN_QUOTE.replace("Sarasota, Florida", "Salem, Oregon") }), {
      url: "https://salem.legistar.com/View.ashx?M=A&ID=118774",
    });
    expect(r.status).toBe("reject");
    expect(r.reason).toBe("wrong-state(OR)");
  });

  it("holds a row whose place the page never independently corroborates", async () => {
    const r = await verifyWith(CLEAN_AGENDA, goodRead({ page_jurisdiction: "Venice, Florida" }), {
      title: "Meeting agenda",
    });
    expect(r.status).toBe("reject");
    expect(r.reason).toBe("place-not-corroborated");
  });

  it("marks an unstated meeting time as unpublishable rather than inventing 6 PM", async () => {
    const noTime = CLEAN_AGENDA.replace("Tuesday, October 6, 2026 6:00 PM", "Tuesday, October 6, 2026");
    const r = await verifyWith(noTime, goodRead());
    expect(r.status).toBe("row");
    const row = r.row as Row;
    expect(row.publishable).toBe(false);
    expect(row.confidence).toBe(0.75);
    expect(row.reason).toContain("no time of day stated");
    expect(row.meetingAtIso).toBe("2026-10-06T04:00:00.000Z"); // 00:00 ET, not a guessed evening
  });
});

// ---------------------------------------------------------------------------
// 7. resolveDiscoveredLocality — discovery is the inverse of verification
// ---------------------------------------------------------------------------

describe("resolveDiscoveredLocality — the claim must be corroborated by something else", () => {
  const geoFL = { locality: "FL", corroborated: true, confidence: "high", reason: "full-state-name:FL" };

  it("accepts a claim the host corroborates", () => {
    const r = resolveDiscoveredLocality({
      claimed: "Sarasota, Florida", url: GOV_URL, scopeState: "FL", geo: geoFL, text: CLEAN_AGENDA, title: "",
    });
    expect(r).toMatchObject({ ok: true, locality: "Sarasota, FL", state: "FL", reason: "host" });
  });

  it("accepts a claim the page repeats, on a host that names no place", () => {
    const r = resolveDiscoveredLocality({
      claimed: "Sarasota, Florida", url: LEGISTAR_URL, scopeState: "FL", geo: geoFL, text: CLEAN_AGENDA, title: "",
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("repeated-in-text");
  });

  it("refuses a self-corroborating claim with no independent support", () => {
    const r = resolveDiscoveredLocality({
      claimed: "Venice, Florida", url: LEGISTAR_URL, scopeState: "FL", geo: geoFL, text: CLEAN_AGENDA, title: "",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("place-not-corroborated");
  });

  it("refuses a claim that contradicts a confident gazetteer pin", () => {
    const r = resolveDiscoveredLocality({
      claimed: "Salem, Massachusetts", url: "https://salem.legistar.com/x", scopeState: "MA",
      geo: { locality: "OR", corroborated: false, confidence: "high", reason: "full-state-name:OR" },
      text: "Salem Salem Oregon city council", title: "",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("state-contradicts-gazetteer(OR)");
  });

  it("refuses a claim that names no state at all", () => {
    const r = resolveDiscoveredLocality({
      claimed: "Sarasota", url: LEGISTAR_URL, scopeState: "", geo: null, text: CLEAN_AGENDA, title: "",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-state");
  });

  it("keeps the county/city type word — they are different governments", () => {
    const r = resolveDiscoveredLocality({
      claimed: "Sarasota County, Florida", url: "https://www.scgov.net/agenda", scopeState: "FL", geo: geoFL,
      text: CLEAN_AGENDA, title: SEARCH_TITLE,
    });
    expect(r.place).toBe("Sarasota County");
    expect(r.locality).toBe("Sarasota County, FL");
  });
});

// ---------------------------------------------------------------------------
// 8. Dates — window, extraction, ordering
// ---------------------------------------------------------------------------

describe("extractDateCandidates — only dates the page states, only in window", () => {
  const at = (text: string) => extractDateCandidates(text, { now: NOW, state: "FL" });

  it("reads the four printed forms", () => {
    expect(at("The council meets Tuesday, October 6, 2026 6:00 PM in chambers.")).toHaveLength(1);
    expect(at("Next meeting 10/6/2026 6:00 PM.")).toHaveLength(1);
    expect(at("Scheduled 2026-10-06T18:00 in chambers.")).toHaveLength(1);
    expect(at("Meeting Date/Time: October 6, 2026 6:00 PM")[0].labeled).toBe(true);
  });

  it("reads the abbreviations and ordinals municipal agendas actually print", () => {
    expect(at("Oct. 6, 2026 at 6 p.m.")).toHaveLength(1);
    expect(at("October 6th, 2026, 6:00 p.m.")).toHaveLength(1);
  });

  it("keeps [now − 24h, now + 60d] and drops everything outside it", () => {
    expect(at("November 14, 2026 6:00 PM")).toHaveLength(1); // +59d
    expect(at("November 20, 2026 6:00 PM")).toHaveLength(0); // +65d
    expect(at("September 16, 2026 2:00 AM")).toHaveLength(1); // −6h
    expect(at("September 14, 2026 2:00 AM")).toHaveLength(0); // −54h
    expect(at("October 6, 2019 6:00 PM")).toHaveLength(0);
    expect(at("October 6, 2027 6:00 PM")).toHaveLength(0);
  });

  it("refuses a date that does not exist", () => {
    expect(at("February 30, 2026 6:00 PM")).toHaveLength(0);
    expect(at("13/40/2026")).toHaveLength(0);
  });

  it("carries hasTime rather than defaulting to an invented evening", () => {
    const [c] = at("Meeting Date: October 6, 2026");
    expect(c.hasTime).toBe(false);
    expect(c.hh).toBe(0);
    expect(at("October 6, 2026 6:00 PM")[0].hh).toBe(18);
    expect(at("October 6, 2026 12:00 AM")[0].hh).toBe(0);
    expect(at("October 6, 2026 12:00 PM")[0].hh).toBe(12);
  });

  it("dedupes the same instant restated down the page, and inherits its label", () => {
    const c = at("October 6, 2026 6:00 PM ... and again October 6, 2026 6:00 PM ... Meeting Date/Time: October 6, 2026 6:00 PM");
    expect(c).toHaveLength(1);
    expect(c[0].labeled).toBe(true);
  });

  it("sorts labelled first, then document order, and caps the list", () => {
    const text = "October 20, 2026 6:00 PM ... Meeting Date/Time: October 6, 2026 6:00 PM";
    const [first, second] = at(text);
    expect(first.raw).toContain("October 6");
    expect(second.raw).toContain("October 20");
    const many = Array.from({ length: 12 }, (_, i) => `October ${i + 1}, 2026 ${i + 1}:00 PM`).join(" ... ");
    expect(extractDateCandidates(many, { now: NOW, state: "FL" }).length).toBeLessThanOrEqual(6);
  });

  it("the clean packet states exactly one in-window date — an agenda, not a calendar index", () => {
    const c = at(CLEAN_AGENDA);
    expect(c).toHaveLength(1);
    expect(pickMeetingDate(c)).toMatchObject({ ambiguous: false, inWindowCount: 1 });
  });

  it("flags a calendar-index page as ambiguous, which blocks auto-publish", () => {
    const index = "October 6, 2026 6:00 PM City Council. October 13, 2026 6:00 PM Planning Board. October 20, 2026 6:00 PM Board of Health. Each agenda includes a kratom ordinance.";
    const c = at(index);
    expect(c.length).toBeGreaterThan(1);
    expect(pickMeetingDate(c).ambiguous).toBe(true);
  });

  it("returns an empty choice for a page with no date at all", () => {
    expect(pickMeetingDate([])).toEqual({ chosen: null, ambiguous: false, inWindowCount: 0 });
    expect(at("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. toUtcIso — DST-correct and independent of the runner's clock
// ---------------------------------------------------------------------------

describe("toUtcIso — the dedupe index depends on this being deterministic", () => {
  it("is DST-correct on both sides of the boundary", () => {
    expect(toUtcIso({ y: 2026, m: 10, d: 6, hh: 18 }, "FL")).toBe("2026-10-06T22:00:00.000Z"); // EDT
    expect(toUtcIso({ y: 2026, m: 1, d: 6, hh: 18 }, "FL")).toBe("2026-01-06T23:00:00.000Z"); // EST
    expect(toUtcIso({ y: 2026, m: 3, d: 7, hh: 18 }, "NY")).toBe("2026-03-07T23:00:00.000Z"); // day before spring-forward
    expect(toUtcIso({ y: 2026, m: 3, d: 9, hh: 18 }, "NY")).toBe("2026-03-09T22:00:00.000Z"); // day after
  });

  it("honours a state that does not observe DST", () => {
    expect(toUtcIso({ y: 2026, m: 7, d: 15, hh: 18 }, "AZ")).toBe("2026-07-16T01:00:00.000Z");
    expect(toUtcIso({ y: 2026, m: 1, d: 15, hh: 18 }, "AZ")).toBe("2026-01-16T01:00:00.000Z");
  });

  it("lets an explicit zone token on the page beat the state default", () => {
    expect(toUtcIso({ y: 2026, m: 10, d: 6, hh: 18 }, "FL", "America/Chicago")).toBe("2026-10-06T23:00:00.000Z");
    expect(zoneHintFromText("The meeting begins at 6:00 PM Central Time.")).toBe("America/Chicago");
    expect(zoneHintFromText("6:00 PM CDT")).toBe("America/Chicago");
    expect(zoneHintFromText("6:00 PM in the council chambers")).toBeNull();
  });

  it("falls back to Eastern for an unknown state rather than throwing", () => {
    expect(toUtcIso({ y: 2026, m: 10, d: 6, hh: 18 }, "ZZ")).toBe("2026-10-06T22:00:00.000Z");
    expect(Object.keys(TZ_BY_STATE)).toHaveLength(51);
    expect(TZ_AMBIGUOUS.has("FL")).toBe(true);
  });

  it("returns the same instant whatever TZ the runner has — box vs GHA", () => {
    // scan-granicus-tenants.mjs builds new Date(y,m,d,h,mm) and therefore
    // writes a different meeting_at on the owner box than on a UTC runner,
    // which silently defeats ux_municipal_meetings_dedupe.
    const prev = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata", "Australia/Sydney"]) {
        process.env.TZ = tz;
        expect(toUtcIso({ y: 2026, m: 10, d: 6, hh: 18 }, "FL")).toBe("2026-10-06T22:00:00.000Z");
        expect(extractDateCandidates(CLEAN_AGENDA, { now: NOW, state: "FL" })).toHaveLength(1);
      }
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Host identity, tiering, ranking, page shape, contacts
// ---------------------------------------------------------------------------

describe("registrableDomain — two subdomains of one government are one source", () => {
  it("collapses clerk. and council. to the same registrable domain", () => {
    expect(registrableDomain("https://clerk.cityofx.gov/agenda")).toBe("cityofx.gov");
    expect(registrableDomain("https://council.cityofx.gov/agenda")).toBe("cityofx.gov");
  });

  it("keeps <city>.<st>.us together — the one multi-part suffix that matters", () => {
    expect(registrableDomain("https://www.ci.austin.tx.us/agenda")).toBe("austin.tx.us");
    expect(registrableDomain("https://sarasota.legistar.com/View.ashx")).toBe("legistar.com");
    expect(registrableDomain("not a url")).toBeNull();
  });
});

describe("meetingTierOf — only a HOSTNAME can mint authority", () => {
  it("recognises official and vendor hosts", () => {
    expect(meetingTierOf("https://www.sarasotafl.gov/agenda")).toBe("official");
    expect(meetingTierOf("https://www.ci.austin.tx.us/agenda")).toBe("official");
    expect(meetingTierOf("https://sarasota.legistar.com/View.ashx")).toBe("vendor");
    expect(meetingTierOf("https://cityofx.granicus.com/AgendaViewer.php")).toBe("vendor");
  });

  it("NARROWS .us: a commercially open TLD is not a government", () => {
    // ban-verify's blanket `.us` rule is the cheapest path to undeserved
    // authority, and here authority auto-publishes.
    expect(meetingTierOf("https://kratomnews.us/agenda")).toBe("aggregator");
    expect(meetingTierOf("https://buyanything.us/agenda")).toBe("unknown");
  });

  it("no PATH mints a tier", () => {
    expect(meetingTierOf("https://evil.com/sarasotafl.gov/agenda")).toBe("unknown");
    expect(meetingTierOf("https://evil.com/ci.austin.tx.us/agenda")).toBe("unknown");
    expect(meetingTierOf("https://evil.com/legistar.com/View.ashx")).toBe("unknown");
  });

  it("fails closed on an unparseable URL and demotes known aggregators", () => {
    expect(meetingTierOf("")).toBe("aggregator");
    expect(meetingTierOf(null)).toBe("aggregator");
    expect(meetingTierOf("https://kratomlords.com/fl/sarasota")).toBe("aggregator");
    expect(meetingTierOf("https://www.tampabaytimes.com/story")).toBe("news");
  });
});

describe("rankMeetingCandidates — a candidate with no positive signal is not worth a fetch", () => {
  const hit = (url: string, title = "", content = "") => ({ url, title, content, engine: "duckduckgo" });

  it("orders official/vendor agenda hits above the rest, and drops the aggregator", () => {
    const out = rankMeetingCandidates([
      hit("https://kratomlords.com/fl/sarasota", "Sarasota kratom ban list", "kratom bans by city"),
      hit("https://sarasota.legistar.com/Calendar/agenda-9", "City Commission agenda", "kratom ordinance public hearing"),
      hit("https://www.sarasotafl.gov/agenda/commission", "Commission agenda", "kratom ordinance first reading"),
    ]);
    expect(out).toEqual([
      "https://www.sarasotafl.gov/agenda/commission",
      "https://sarasota.legistar.com/Calendar/agenda-9",
    ]);
  });

  it("pushes an archive path and a stale year to the bottom", () => {
    const out = rankMeetingCandidates([
      hit("https://www.sarasotafl.gov/minutes/2019/commission", "Commission minutes archive", "kratom"),
      hit("https://www.sarasotafl.gov/agenda/commission", "Commission agenda", "kratom ordinance"),
    ]);
    expect(out[0]).toBe("https://www.sarasotafl.gov/agenda/commission");
    expect(out.at(-1)).toContain("/minutes/2019/");
    // Host authority alone carries the archive over the ranking floor, which is
    // why it is rejected a second time by PATH once it has been fetched.
    expect(checkPageIsAgenda({ url: out.at(-1) as string, text: CLEAN_AGENDA, title: "Commission minutes archive" }).isArchive).toBe(true);
  });

  it("drops a candidate with no positive signal — fetching is the expensive step", () => {
    expect(rankMeetingCandidates([hit("https://kratomlords.com/fl", "kratom bans", "list by city")])).toEqual([]);
    expect(rankMeetingCandidates([hit("https://randomblog.com/post", "Some blog", "musings")])).toEqual([]);
  });

  it("dedupes identical URLs and caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`https://c${i}.legistar.com/agenda`, "agenda", "kratom ordinance"));
    expect(rankMeetingCandidates([...many, ...many], { maxCandidates: 8 })).toHaveLength(8);
    expect(rankMeetingCandidates([hit("nonsense")])).toEqual([]);
    expect(rankMeetingCandidates(null)).toEqual([]);
  });
});

describe("checkPageIsAgenda + harvestContacts — page shape and the fields advocates act on", () => {
  it("separates a live agenda from an archive by PATH and title, never by body text", () => {
    // "approval of the minutes of the previous meeting" is a standing first
    // item on a LIVE agenda, so body text must not mark a page as an archive.
    expect(checkPageIsAgenda({ url: LEGISTAR_URL, text: CLEAN_AGENDA, title: SEARCH_TITLE }).isArchive).toBe(false);
    expect(checkPageIsAgenda({ url: "https://x.gov/past-meetings/commission", text: CLEAN_AGENDA, title: SEARCH_TITLE }).isArchive).toBe(true);
    expect(checkPageIsAgenda({ url: "https://x.gov/c", text: CLEAN_AGENDA, title: "City Commission Minutes" }).isArchive).toBe(true);
    expect(checkPageIsAgenda({ url: "https://x.gov/c", text: "Nothing civic here at all.", title: "Contact us" }).isAgenda).toBe(false);
  });

  it("lifts the Zoom, livestream, signup and address verbatim off the page", () => {
    const c = harvestContacts(CLEAN_AGENDA);
    expect(c.zoom_url).toBe("https://us02web.zoom.us/j/84512277901");
    expect(c.livestream_url).toBe("https://www.youtube.com/watch?v=9bZkp7q19f0");
    expect(c.in_person_address).toContain("1565 First Street");
    for (const v of Object.values(c)) if (v) expect(CLEAN_AGENDA).toContain(v);
  });

  it("the public-comment signup is the SIGNUP form, not the video player printed above it", () => {
    // Scanning backwards from "public comment" returned the livestream link,
    // which sends an advocate who wants to speak to a video player instead.
    expect(harvestContacts(CLEAN_AGENDA).public_comment_signup_url).toBe("https://www.sarasotafl.gov/speaker-signup");
  });

  it("returns nulls rather than guesses when the page says nothing", () => {
    expect(harvestContacts("A short notice with no links and no address.")).toEqual({
      zoom_url: null, livestream_url: null, public_comment_signup_url: null, in_person_address: null,
    });
    expect(harvestContacts(null)).toMatchObject({ zoom_url: null });
  });
});

// ---------------------------------------------------------------------------
// 11. discoverMeetings — budgets, the fuse, blocked vs empty
// ---------------------------------------------------------------------------

const searchHit = (url: string, i = 0) => ({
  title: `City Council agenda ${i}`,
  url,
  content: "kratom ordinance public hearing agenda",
  engine: "duckduckgo",
});
const okSearch = (results: Array<Record<string, unknown>>) => async () => ({ ok: true, status: 200, reason: "ok", results });
const publishableRow = (url: string): Row => ({
  state: "FL", place: "Sarasota", locality: "Sarasota, FL", body_name: "City Commission",
  meetingAtIso: "2026-10-06T22:00:00.000Z", format: "in_person",
  zoom_url: null, livestream_url: null, public_comment_signup_url: null, in_person_address: null,
  fetchedUrl: url, source_url: url, agenda_url: url, quote: CLEAN_QUOTE,
  tier: "vendor", itemContext: "agenda_item", dateSource: "reader_choice[0]", dateAmbiguous: false,
  tzUsed: "America/New_York", tzAssumed: true, tzAmbiguousState: true,
  engineProvider: "stub", via: "searxng_verified", query: "q",
  confidence: 0.9, publishable: true, reason: "agenda item on an official/vendor agenda page",
});
const rowVerify = async ({ url }: { url: string }) => ({ status: "row", row: publishableRow(url), readerOk: true, isAgenda: true });

/**
 * Both env vars below are read at CALL time by the engine, and tests/setup.ts
 * loads .env.local — which sets SEARXNG_URL on a dev box and leaves it unset in
 * CI. Every test that cares states the value it wants and puts the ambient one
 * back, so the suite asserts the same thing in both places.
 */
const withEnv = async (vars: Record<string, string | null>, fn: () => Promise<void>) => {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const restore = (k: string, v: string | undefined | null) => {
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = v;
  };
  for (const [k, v] of Object.entries(vars)) restore(k, v);
  try { await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) restore(k, v);
  }
};
const withSearxng = (url: string | null, fn: () => Promise<void>) => withEnv({ SEARXNG_URL: url }, fn);

describe("discoverMeetings — the run-scoped auto-publish fuse", () => {
  it("publishes at most the fuse, and HOLDS the rest with the reason on the row", async () => {
    // A run that suddenly wants to publish twenty meetings by itself is a bug
    // or an attack, not a good night.
    await withEnv({ SEARXNG_URL: "http://localhost:8080", MEETING_AUTOPUBLISH_MAX_PER_RUN: "2" }, async () => {
      const urls = Array.from({ length: 5 }, (_, i) => `https://city${i}.legistar.com/Calendar/agenda-${i}`);
      const counters: Record<string, unknown> = {};
      const out = await callDiscover({
        scopeState: "FL", stateName: "Florida", dryRun: true, counters, now: NOW,
        search: okSearch(urls.map((u, i) => searchHit(u, i))),
        verify: rowVerify,
      });
      expect(out.status).toBe("ok");
      expect(out.rows).toHaveLength(5);
      expect(out.rows.filter((r) => r.publishable)).toHaveLength(2);
      expect(counters.autoPublished).toBe(2);
      for (const held of out.rows.filter((r) => !r.publishable)) {
        expect(held.confidence).toBe(0.8);
        expect(held.confidence).toBeLessThan(AUTOPUBLISH_FLOOR);
        expect(held.reason).toContain("run auto-publish budget (2) exhausted");
      }
    });
  });

  it("is run-scoped: a second state shares the same spent budget", async () => {
    await withEnv({ SEARXNG_URL: "http://localhost:8080", MEETING_AUTOPUBLISH_MAX_PER_RUN: "1" }, async () => {
      const counters: Record<string, unknown> = {};
      const one = await callDiscover({
        scopeState: "FL", stateName: "Florida", dryRun: true, counters, now: NOW,
        search: okSearch([searchHit("https://a.legistar.com/Calendar/agenda-a")]),
        verify: rowVerify,
      });
      const two = await callDiscover({
        scopeState: "TX", stateName: "Texas", dryRun: true, counters, now: NOW,
        search: okSearch([searchHit("https://b.legistar.com/Calendar/agenda-b")]),
        verify: rowVerify,
      });
      expect(one.rows[0].publishable).toBe(true);
      expect(two.rows[0].publishable).toBe(false);
      expect(counters.autoPublished).toBe(1);
    });
  });
});

describe("discoverMeetings — blocked means WE COULD NOT LOOK, empty means nothing was there", () => {
  it("blocks without spending a query when SearXNG is unconfigured", async () => {
    await withSearxng(null, async () => {
      let searches = 0;
      const out = await callDiscover({
        scopeState: "FL", stateName: "Florida", dryRun: true, now: NOW,
        search: async () => { searches++; return { ok: true, status: 200, reason: "ok", results: [] }; },
        verify: rowVerify,
      });
      expect(out).toMatchObject({ status: "blocked", reason: "searxng-unconfigured" });
      expect(searches).toBe(0);
    });
  });

  it("blocks every state on a failed run-level probe, without spending a query", async () => {
    await withSearxng("http://localhost:8080", async () => {
      let searches = 0;
      const out = await callDiscover({
        scopeState: "FL", stateName: "Florida", dryRun: true, now: NOW,
        probeResult: { ok: false, reason: "no_engines", resultCount: 1 },
        search: async () => { searches++; return { ok: true, status: 200, reason: "ok", results: [] }; },
        verify: rowVerify,
      });
      expect(out).toMatchObject({ status: "blocked", reason: "searxng-no_engines" });
      expect(searches).toBe(0);
    });
  });

  it("blocks when every query for the state failed", async () => {
    await withSearxng("http://localhost:8080", async () => {
      const out = await callDiscover({
        scopeState: "FL", stateName: "Florida", dryRun: true, now: NOW,
        search: async () => ({ ok: false, status: 0, reason: "timeout", results: [] }),
        verify: rowVerify,
      });
      expect(out).toMatchObject({ status: "blocked", reason: "searxng-timeout" });
      expect(out.searchFailed).toBeGreaterThan(0);
    });
  });

  it("reports EMPTY — not blocked — when the search worked and found nothing", async () => {
    await withSearxng("http://localhost:8080", async () => {
      const out = await callDiscover({
        scopeState: "FL", stateName: "Florida", dryRun: true, now: NOW,
        search: okSearch([]), verify: rowVerify,
      });
      expect(out.status).toBe("empty");
      expect(out.reason).toBeNull();
      expect(out.searched).toBeGreaterThan(0);
      expect(out.searchFailed).toBe(0);
    });
  });

  it("an extraction outage is BLOCKED, and the next state pays nothing to re-prove it", async () => {
    await withSearxng("http://localhost:8080", async () => {
      const counters: Record<string, unknown> = {};
      let searches = 0;
      const search = async () => { searches++; return { ok: true, status: 200, reason: "ok", results: [searchHit("https://a.legistar.com/Calendar/agenda-a")] }; };
      const first = await callDiscover({
        scopeState: "FL", stateName: "Florida", dryRun: true, counters, now: NOW, search,
        verify: async () => ({ status: "reader_failed", reason: "connect ECONNREFUSED", readerOk: false, isAgenda: true }),
      });
      expect(first).toMatchObject({ status: "blocked", reason: "extract-provider-down" });
      expect(first.readerFailed).toBeGreaterThan(0);
      const spent = searches;
      const second = await callDiscover({
        scopeState: "TX", stateName: "Texas", dryRun: true, counters, now: NOW, search, verify: rowVerify,
      });
      expect(second).toMatchObject({ status: "blocked", reason: "extract-provider-down" });
      expect(searches).toBe(spent);
    });
  });
});

describe("discoverMeetings — fetch budget discipline", () => {
  it("fetches one city's agenda once even when two subdomains surface it", async () => {
    await withSearxng("http://localhost:8080", async () => {
      const fetched: string[] = [];
      const counters: Record<string, unknown> = {};
      await callDiscover({
        scopeState: "FL", stateName: "Florida", dryRun: true, counters, now: NOW,
        search: okSearch([
          searchHit("https://clerk.cityofx.gov/agenda/regular-meeting"),
          searchHit("https://council.cityofx.gov/agenda/regular-meeting"),
        ]),
        verify: async ({ url }: { url: string }) => { fetched.push(url); return { status: "reject", reason: "no-kratom-keyword", readerOk: true, isAgenda: false }; },
      });
      expect(fetched).toHaveLength(1);
    });
  });

  it("verifies nothing once the wall-clock deadline has passed", async () => {
    await withSearxng("http://localhost:8080", async () => {
      let verified = 0;
      const out = await callDiscover({
        scopeState: "FL", stateName: "Florida", dryRun: true, now: NOW, deadline: Date.now() - 1000,
        search: okSearch([searchHit("https://a.legistar.com/Calendar/agenda-a")]),
        verify: async () => { verified++; return { status: "reject", reason: "x", readerOk: true, isAgenda: false }; },
      });
      expect(verified).toBe(0);
      expect(out.status).toBe("empty");
    });
  });

  it("respects maxFetches", async () => {
    await withSearxng("http://localhost:8080", async () => {
      let verified = 0;
      await callDiscover({
        scopeState: "FL", stateName: "Florida", dryRun: true, now: NOW, maxFetches: 3,
        search: okSearch(Array.from({ length: 12 }, (_, i) => searchHit(`https://c${i}.legistar.com/Calendar/agenda-${i}`, i))),
        verify: async () => { verified++; return { status: "reject", reason: "x", readerOk: true, isAgenda: false }; },
      });
      expect(verified).toBe(3);
    });
  });
});

// ---------------------------------------------------------------------------
// 12. searxngSearch — the [] contract four shipped callers depend on
// ---------------------------------------------------------------------------

describe("searxngSearch — every failure still degrades to []", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const json = (body: unknown, status = 200) =>
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("returns the rows on success", async () => {
    await withSearxng("http://localhost:8080", async () => {
      json({ results: [{ title: "t", url: "https://x.gov/a", content: "c", engine: "duckduckgo" }] });
      const r = await searxngSearch("kratom agenda");
      expect(r).toHaveLength(1);
      expect(r[0].url).toBe("https://x.gov/a");
    });
  });

  it("returns [] for unconfigured, http error, bad json and network failure", async () => {
    await withSearxng(null, async () => {
      expect(await searxngSearch("kratom agenda")).toEqual([]);
    });
    await withSearxng("http://localhost:8080", async () => {
      json({ results: [] }, 403);
      expect(await searxngSearch("kratom agenda")).toEqual([]);
      vi.stubGlobal("fetch", async () => new Response("<html>not json</html>", { status: 200 }));
      expect(await searxngSearch("kratom agenda")).toEqual([]);
      vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
      expect(await searxngSearch("kratom agenda")).toEqual([]);
      json({ results: [{ title: "t", url: "https://x.gov/a" }] });
      expect(await searxngSearch("")).toEqual([]);
    });
  });
});

/**
 * 2026-09-17 — the first live run. It wrote 4 rows and all 4 were wrong, every
 * one from a news site or Facebook, three carrying the crawl date taken from the
 * page masthead or sidebar timestamps. These pin the fix: only an official or
 * agenda-platform page may make a meeting claim, decided before any fetch, and
 * news hits no longer occupy the run's fetch budget.
 */
import * as MD from "../scripts/lib/meeting-discover.mjs";

describe("first-live-run regression — non-authoritative pages never become meetings", () => {
  const LIVE_JUNK = [
    "https://www.cascadiadaily.com/2026/aug/26/kratom-and-7-oh-ban-passes-in-mount-vernon/",
    "https://www.outerbanksvoice.com/2026/06/29/dare-county-to-hold-public-hearing-as-it-seeks-to-regulate-kratom/",
    "https://orangecountytribune.com/2026/02/06/kratom-nitrous-bans-on-agenda/",
    "https://www.facebook.com/wearepcyb/posts/thanks-for-the-coverage-fox-carolina/1459786096184831/",
  ];

  it("rejects each live junk URL before spending a fetch", async () => {
    for (const url of LIVE_JUNK) {
      let fetches = 0;
      const r = await MD.verifyCandidate({
        url, scopeState: "NC", stateName: "North Carolina", now: new Date("2026-09-17T15:05:00Z"),
        fetchPage: (async () => { fetches++; return "Thursday, September 17, 2026 kratom public hearing"; }) as never,
        ai: (async () => { throw new Error("reader must not be reached"); }) as never,
      } as never);
      expect(r.status, url).toBe("reject");
      expect(String((r as { reason?: string }).reason), url).toMatch(/^non-authoritative-tier/);
      expect(fetches, url).toBe(0);
    }
  });

  it("still fetches official and agenda-platform pages", async () => {
    for (const url of ["https://cityofx.gov/agenda/2026-10-06", "https://ci.sarasota.fl.us/agenda", "https://cityofx.legistar.com/MeetingDetail.aspx?ID=1"]) {
      let fetches = 0;
      const r = await MD.verifyCandidate({
        url, scopeState: "FL", stateName: "Florida",
        fetchPage: (async () => { fetches++; return null; }) as never,
      } as never);
      expect(fetches, url).toBe(1);
      expect(r.status, url).toBe("fetch_failed");
    }
  });

  it("keeps news hits out of the fetch budget, and counts what it skipped", async () => {
    const prev = process.env.SEARXNG_URL;
    process.env.SEARXNG_URL = "http://localhost:8080";
    try {
      const hit = (url: string) => ({ url, title: "kratom agenda city council ordinance", content: "kratom agenda", engine: "stub" });
      const results = [
        ...["a", "b", "c", "d", "e"].map((s) => hit(`https://www.${s}localnews.com/story-${s}`)),
        hit("https://cityofx.legistar.com/MeetingDetail.aspx?ID=7"),
      ];
      const verified: string[] = [];
      const counters: Record<string, unknown> = {};
      await MD.discoverMeetings({
        scopeState: "FL", stateName: "Florida", maxFetches: 3, dryRun: true, counters,
        probeResult: { ok: true }, localityLane: false,
        search: (async () => ({ ok: true, status: 200, reason: "ok", results })) as never,
        verify: (async ({ url }: { url: string }) => { verified.push(url); return { status: "reject", reason: "stub", readerOk: true, isAgenda: false }; }) as never,
      } as never);
      expect(verified).toEqual(["https://cityofx.legistar.com/MeetingDetail.aspx?ID=7"]);
      expect(counters.skippedNonAuthoritative).toBe(5);
    } finally {
      if (prev === undefined) delete process.env.SEARXNG_URL; else process.env.SEARXNG_URL = prev;
    }
  });

  it("does not let page chrome ride into the address (live Garden Grove row)", () => {
    const junk = MD.harvestContacts("Meeting location: City Hall, located at 11300 Stanford Ave. Share this: Share Share on X (Opens in new window)");
    expect(junk.in_person_address).toBe("11300 Stanford Ave");
    const full = MD.harvestContacts("Council Chambers located at 1565 First Street, Sarasota, FL 34236. Doors open at 5:30.");
    expect(full.in_person_address).toBe("1565 First Street, Sarasota, FL 34236");
  });
});
