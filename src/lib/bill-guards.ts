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

/** Rows a news story created before anyone checked the bill (see verify-stub-bills.mjs). */
export const STUB_BILL_MARK = "auto-extracted from kratom-related coverage";

export function isUnverifiedStub(title: string | null | undefined): boolean {
  return !!title && title.includes(STUB_BILL_MARK);
}
