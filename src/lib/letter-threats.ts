/**
 * Unambiguous threats in a member's letter, caught with no AI so they are
 * blocked even when every free AI provider is down (owner rules 2026-10-22;
 * the AI screen in modules/campaigns/screen-content.ts handles the rest).
 * Deliberately narrow: firm or angry political language is NOT a threat.
 */
const THREAT_RE = [
  /\b(i(?:'m| am)? going to|i(?:'ll| will)|we(?:'ll| will)|gonna)\s+(?:kill|shoot|hurt|murder|bomb|beat|stab|hunt)\b/i,
  /\b(?:kill|shoot|murder|hang|lynch|stab)\s+(?:you|him|her|them|yourself|your family)\b/i,
  /\b(?:i|we)(?:'ll| will| are going to| am going to|'re going to)\s+(?:find|come for|get|hunt)\s+(?:you|him|her|them)\b/i,
  /\byou\s+(?:deserve|should|ought)\s+to\s+die\b/i,
  /\b(?:watch your back|i know where you live|we know where you live)\b/i,
];

export function letterThreat(text: string): boolean {
  return THREAT_RE.some((re) => re.test(text));
}
