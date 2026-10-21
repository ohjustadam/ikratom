/**
 * moderation-gate.mjs — when an automated reviewer may reject a queued item.
 *
 * WHY (owner, 2026-10-21): "the auto resolve for campaigns doesn't always be
 * thorough before rejecting one that indeed was a new and fresh campaign. We
 * want to encourage people to use the service."
 *
 * The audit that day found the cause. The fact-checkers judged items from WEB
 * SEARCH SNIPPETS ONLY, and the prompt let them reject when "the described event
 * does NOT appear to exist". So a failed search read as proof: a real Mississippi
 * campaign (Clarion Ledger, 2026-10-14) was rejected because the search for a
 * headline starting "See MS Legislature..." returned the TV series *See*. Lee
 * County's ban was rejected because the search returned Lee jeans. Real NEWS was
 * rejected too, because "already enacted" was treated as moot for an intel post,
 * where a signed ban IS the story.
 *
 * The rules here, shared by every reviewer:
 *   1. The item's OWN source article is the primary evidence. Search snippets
 *      are secondary, and ones that don't mention kratom are discarded.
 *   2. "Couldn't confirm it" is never a reason to reject. Only POSITIVE
 *      evidence is: final with nothing left to influence (campaigns only),
 *      a different state, partisan framing, or (intel) not about kratom.
 *   3. A reject needs HIGH confidence AND real evidence (the source article,
 *      or two relevant snippets). Anything less is left for a person.
 * Asymmetric risk: a wrong reject buries a real call to action and hides it
 * from the people we want to reach; a wrong "keep" costs one human glance.
 */

const RELEVANT = /kratom|7-?oh\b|7-hydroxy|hydroxymitragyn|mitragyn|pseudoindoxyl/i;

/** A search result is evidence only if it is about kratom at all. */
export function isRelevantSnippet(s) {
  return RELEVANT.test(`${s?.title ?? ""} ${s?.content ?? ""}`);
}

export function relevantSnippets(snippets) {
  return (snippets ?? []).filter(isRelevantSnippet);
}

/** The part of a fetched article worth showing a model: from the first kratom mention. */
export function articleExcerpt(text, max = 3000) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const at = t.search(RELEVANT);
  if (at < 0) return "";
  return t.slice(Math.max(0, at - 300), Math.max(0, at - 300) + max);
}

const COMMON = `You review ONE queued item for iKratom, a strictly NONPARTISAN kratom-advocacy platform. Items are built automatically from news, so they can be stale or mis-tagged, but most are real.
EVIDENCE: the SOURCE ARTICLE (when given) is the story the item was built from and is your primary evidence. WEB SNIPPETS are secondary and often unrelated; a search that returns unrelated results proves NOTHING about the event.
NEVER reject because you could not confirm the event, because the snippets were irrelevant or thin, or because the source was missing. In those cases answer keep: a person will look.`;

export const CAMPAIGN_PROMPT = `${COMMON}
This item is a CAMPAIGN: it asks constituents to email their legislators.
REJECT only with POSITIVE evidence that (a) the matter is final and nothing is left to influence: the bill died, or a ban was signed/enacted AND the evidence shows no next step (no further vote, session, rulemaking, comment period, permanent rule or repeal effort); (b) the source shows the action is in a DIFFERENT state than the tagged location; or (c) the campaign is framed around attacking or praising a named politician or party.
APPROVE when the evidence shows a real, current kratom policy action in the tagged location that constituents can still influence: a pending bill (one that passed only ONE chamber is still live), an upcoming session or vote, a proposed or emergency rule, or an official publicly pushing for legislation.
Otherwise keep.
Reply with ONLY compact JSON: {"verdict":"approve"|"reject"|"keep","confidence":"high"|"medium"|"low","reason":"<=180 chars, cite the evidence"}.`;

export const INTEL_PROMPT = `${COMMON}
This item is INTEL: a public NEWS post. A signed ban, an enacted law, an arrest, a death investigation or a failed bill is still news advocates need, so "already enacted / nothing to act on" is NEVER a reason to reject intel.
REJECT only with POSITIVE evidence that (a) the story is not about kratom or 7-OH at all (law, enforcement, health, research or market); (b) the source shows a DIFFERENT state than the tagged location; or (c) it is partisan framing (attacking or praising a named politician or party) with no news value.
APPROVE when the evidence shows a real kratom-related development in the tagged location.
Otherwise keep.
Reply with ONLY compact JSON: {"verdict":"approve"|"reject"|"keep","confidence":"high"|"medium"|"low","reason":"<=180 chars, cite the evidence"}.`;

export const promptFor = (kind) => (kind === "intel" ? INTEL_PROMPT : CAMPAIGN_PROMPT);

/** Evidence strong enough to act on: the source article, or two relevant snippets. */
export function hasActionableEvidence({ sourceText, snippets }) {
  return Boolean(articleExcerpt(sourceText)) || relevantSnippets(snippets).length >= 2;
}

/** May an automated reviewer apply this verdict without a person? */
export function canAutoReject(verdict, evidence) {
  return verdict?.verdict === "reject" && verdict?.confidence === "high" && hasActionableEvidence(evidence);
}
export function canAutoApprove(verdict, evidence) {
  return verdict?.verdict === "approve" && verdict?.confidence === "high" && hasActionableEvidence(evidence);
}
