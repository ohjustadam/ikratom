/**
 * Plain asks to ban natural kratom, caught with no AI (owner ask 2026-11-03:
 * iKratom must never carry a ban letter, even when the AI can't help).
 *
 * The AI screen in modules/campaigns/screen-content.ts is the real judge, but
 * every free provider has been down at once before, and the AI reads the letter
 * itself, so a letter can try to talk it into "ok". This is the floor under it:
 * a letter that plainly asks an official to ban, schedule or criminalize kratom
 * is stopped either way.
 *
 * Deliberately narrow. A wrong block stops a real advocate, a miss still meets
 * the AI, so anything subtle is left to the AI. Not matched:
 *   - opposing a ban ("please don't ban kratom", "I cannot support a ban on kratom");
 *   - limits on 7-OH, extracts or adulterated products, and age limits
 *     ("ban kratom extracts", "ban kratom sales to minors");
 *   - quoting the other side ("opponents say kratom should be banned");
 *   - questions and conditionals ("why would you ban kratom?", "ban kratom and you lose my vote").
 */
const LEAF = String.raw`(?:(?:natural|leaf|raw|plant|whole[- ]leaf|all)\s+)?(?:kratom|mitragyna\s+speciosa)`;
// "schedule" alone also means "put on the agenda" ("please schedule kratom
// hearings"), so scheduling counts only with "Schedule I" (SCHEDULE_I).
const BAN = String.raw`(?:ban|outlaw|criminali[sz]e|prohibit)`;
// Only the writer asking: "please", "I urge you to", "you should". News
// headlines and reports ("lawmakers pass ban on kratom", "council votes to ban
// kratom") are third person, so they never match (2,901 campaign titles, 2026-11-03).
const LEAD = String.raw`(?:please(?:\s+(?:vote|act|move|work)\s+to|\s+help(?:\s+us)?)?|(?:i|we)\s+(?:urge|ask|beg|implore|want)\s+you\s+to|(?:i(?:'m|\s+am)|we(?:'re|\s+are))\s+asking\s+you\s+to|you\s+(?:must|should|need\s+to)|it(?:'s|\s+is)\s+time\s+to)`;
const SCHEDULE_I = String.raw`(?:(?:add|place|put|list|classify|schedule)\s+${LEAF}\s+(?:on|in|to|as|under)\s+(?:a\s+)?schedule\s+(?:i|1|one)|make\s+${LEAF}\s+(?:illegal|a\s+(?:controlled|schedule\s+(?:i|1|one))))\b`;
const A_BAN = String.raw`(?:(?:a|an|the|this|any)\s+)?(?:(?:total|complete|full|statewide|nationwide|proposed)\s+)?(?:ban(?:ning)?\s+(?:on\s+|of\s+)?${LEAF}|${LEAF}\s+ban|prohibition\s+(?:of|on)\s+${LEAF}|criminali[sz]ing\s+${LEAF})\b`;

const ASKS: { re: RegExp; sentenceStart?: boolean }[] = [
  // "please ban kratom", "I urge you to outlaw kratom", "you should add kratom to Schedule I"
  { re: new RegExp(String.raw`\b${LEAD}\s+(?:finally\s+|immediately\s+|completely\s+)?(?:${BAN}\s+${LEAF}\b|${SCHEDULE_I})`, "gi") },
  // "Ban kratom now." or "Add kratom to Schedule I." as a sentence of its own
  { re: new RegExp(String.raw`\b(?:${BAN}\s+${LEAF}\b(?!\s*,?\s*(?:and|or)\b)|${SCHEDULE_I})`, "gi"), sentenceStart: true },
  // "I support a ban on kratom", "please vote for the kratom ban"
  {
    re: new RegExp(
      String.raw`\b(?:(?:i|we)\s+(?:(?:strongly|fully|also|wholeheartedly)\s+)?(?:support|favou?r|back|endorse|(?:am|are)\s+in\s+favou?r\s+of)|${LEAD}\s+(?:support|back|pass|vote\s+(?:yes\s+on|for)))\s+${A_BAN}`,
      "gi",
    ),
  },
  // "kratom should be banned"
  {
    re: new RegExp(
      String.raw`\b${LEAF}\s+(?:should|must|needs\s+to|ought\s+to|has\s+to)\s+be\s+(?:banned|outlawed|criminali[sz]ed|prohibited|made\s+illegal|(?:classified|scheduled|listed|placed)\s+(?:as|on|in|under)\s+(?:a\s+)?schedule\s+(?:i|1|one))\b`,
      "gi",
    ),
  },
];

/** Earlier in the same sentence: negation, someone else's view, or a condition. */
const NOT_AN_ASK =
  /(?:\b(?:not|never|no|nobody|none|cannot|oppose[sd]?|opposing|against|reject|stop|prevent|block|defeat|instead\s+of|rather\s+than|says?|said|claims?|claimed|argues?|argued|thinks?|believes?|wants?|insists?|if|whether|why)\b|n't\b)/i;

/** Right after the match: a non-leaf form, an age limit, or a place limit. */
const QUALIFIED = new RegExp(
  String.raw`^\s*(?:[- ]?(?:derived|based)\b` +
    String.raw`|(?:extracts?|concentrates?|isolates?|alkaloids?|shots?|vapes?|gummies|edibles)\b` +
    String.raw`|(?:products?|tablets?|capsules?|drinks?|beverages?|items?)\b[^.!?\n]{0,80}?\b(?:that|which|with|containing|contains?|laced|spiked|adulterated|enhanced|fortified|over|above|exceeding|synthetic|concentrated|7-?oh|minors|under)\b` +
    String.raw`|(?:sales?\s+|use\s+|purchases?\s+)?(?:to|for|by|among)\s+(?:minors|children|kids|teens|youth|anyone\s+under|people\s+under|persons\s+under|those\s+under|under)\b` +
    String.raw`|(?:from|in|at|near)\s+(?:schools?|gas\s+stations?|convenience\s+stores?|smoke\s+shops?))`,
  "i",
);

function sentenceAround(text: string, start: number, end: number): { before: string; after: string; question: boolean } {
  const from = Math.max(text.lastIndexOf(".", start - 1), text.lastIndexOf("!", start - 1), text.lastIndexOf("?", start - 1), text.lastIndexOf("\n", start - 1)) + 1;
  const stop = text.slice(end).search(/[.!?\n]/);
  const to = stop === -1 ? text.length : end + stop;
  return { before: text.slice(from, start), after: text.slice(end, to), question: text[to] === "?" };
}

/** True when the text plainly asks for natural kratom to be banned, scheduled or criminalized. */
export function explicitBanAsk(raw: string): boolean {
  const text = raw.replace(/[‘’ʼ]/g, "'").replace(/[ \t\r\f\v]+/g, " ");
  for (const { re, sentenceStart } of ASKS) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const { before, after, question } = sentenceAround(text, start, start + m[0].length);
      if (question || NOT_AN_ASK.test(before) || QUALIFIED.test(after)) continue;
      if (sentenceStart && !/^[\s"'(*\-–—:]*$/.test(before)) continue;
      return true;
    }
  }
  return false;
}
