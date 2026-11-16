/**
 * Guards that stop a bill page contradicting itself (Paul, 2026-10-28).
 *
 * MN HF 4223's briefing, written from the bill text, said it "does not
 * introduce any definitions, prohibitions, or requirements pertaining to
 * natural leaf kratom", while its "For advocates" box, written from a news
 * snippet, said "This bill would ban natural leaf kratom". When the text-based
 * briefing says the bill has no kratom provisions, the box is not shown.
 *
 * Deliberately narrow: "does not ban natural leaf kratom" is a normal sentence
 * about a real 7-OH bill and must NOT trip it; only "no provisions at all"
 * phrasing does.
 */
const NO_KRATOM_PROVISIONS = [
  /\b(?:does not|doesn't|do not)\s+(?:introduce|contain|include|mention|address|reference|regulate|concern)\b[^.]{0,160}\b(?:kratom|mitragyn)/i,
  /\b(?:no|any)\s+(?:provisions?|mention|definitions?|references?)\b[^.]{0,80}\b(?:kratom|mitragyn)/i,
  /\b(?:unrelated to|nothing to do with|makes no mention of)\s+kratom\b/i,
];

export function briefingDeniesKratom(briefing: string | null | undefined): boolean {
  if (!briefing) return false;
  return NO_KRATOM_PROVISIONS.some((re) => re.test(briefing));
}

/**
 * NY S 8925A (PJ, 2026-11-14): the briefing says the bill defines 7-OH products
 * "narrowly, excluding natural leaf kratom", while the "For advocates" box said
 * the cap "would effectively ban most natural leaf product". A callout that
 * claims a leaf ban is hidden when the text-based briefing says leaf is spared.
 * A callout saying the bill does NOT ban leaf is fine and never trips it.
 */
const LEAF_BAN_CLAIM = /\b(?:ban|bans|banning|prohibit\w*|outlaw\w*|criminaliz\w*|eliminat\w*)\b[^.]{0,60}\b(?:natural|traditional|plain|whole)[- ]?(?:leaf|kratom)\b/i;
const NEGATED_BAN = /\b(?:not|n't|never|without)\b[^.]{0,40}\b(?:ban|prohibit|outlaw|criminaliz|eliminat)/i;
const BRIEFING_SPARES_LEAF = [
  /\b(?:excluding|excludes?|exempts?|exempting|preserv\w*|leaving|leaves|spares?|sparing)\b[^.]{0,60}\b(?:natural|traditional)\s+(?:leaf|kratom)/i,
  /\b(?:natural|traditional)\s+(?:leaf\s+)?kratom\b[^.]{0,80}\b(?:unaddressed|unaffected|untouched|excluded|exempt|remains? legal|not covered)\b/i,
  /\b(?:does not|doesn't|would not|wouldn't)\s+(?:ban|prohibit|restrict|affect|cover)\b[^.]{0,40}\b(?:natural|traditional)\s+(?:leaf|kratom)/i,
];

export function calloutContradictsBriefing(
  callout: string | null | undefined,
  briefing: string | null | undefined,
): boolean {
  if (!callout || !briefing) return false;
  if (!LEAF_BAN_CLAIM.test(callout) || NEGATED_BAN.test(callout)) return false;
  return BRIEFING_SPARES_LEAF.some((re) => re.test(briefing));
}

/** Rows a news story created before anyone checked the bill (see verify-stub-bills.mjs). */
export const STUB_BILL_MARK = "auto-extracted from kratom-related coverage";

export function isUnverifiedStub(title: string | null | undefined): boolean {
  return !!title && title.includes(STUB_BILL_MARK);
}
