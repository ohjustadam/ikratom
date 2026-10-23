/**
 * Lines in a letter that say the writer uses kratom NOW.
 *
 * Asking lawmakers to change a law is protected speech; a written statement
 * that you currently use a substance your state has scheduled is something
 * else: a signed admission sent to a government inbox. Banned-state safe mode
 * (2026-10-23, from a Louisiana member's feedback) flags these lines in the
 * composer and offers past-tense wording. It never rewrites behind the
 * member's back: the composer shows the change and they can edit it.
 *
 * Client-safe (no server imports): the composer runs it on every keystroke.
 */

type Rule = { re: RegExp; fix: ((match: string, ...groups: string[]) => string) | null };

const PAST: Record<string, string> = {
  use: "used", take: "took", consume: "consumed", buy: "bought", purchase: "purchased",
  "depend on": "depended on", "rely on": "relied on",
  using: "used", taking: "took", "relying on": "relied on", "depending on": "depended on",
  used: "used", taken: "took",
  helps: "helped", keeps: "kept", allows: "allowed", lets: "let", gives: "gave",
  relies: "relied", rely: "relied", depends: "depended", depend: "depended",
};
const past = (verb: string) => PAST[verb.toLowerCase().replace(/\s+/g, " ")] ?? verb;
const LEAF = "(?:natural |leaf |plain |powdered )?";
const ADJ = "((?:daily |regular |long-?time |responsible )?)";

const RULES: Rule[] = [
  // "I'm a kratom consumer" / "I am a daily kratom user"
  {
    re: new RegExp(`\\bI(?:'m|’m| am) an? ${ADJ}kratom (user|consumer)\\b`, "gi"),
    fix: (_m, adj, noun) => `I was a ${adj}kratom ${noun}`,
  },
  // "As a kratom consumer, …"
  {
    re: new RegExp(`\\b(as) an? ${ADJ}kratom (user|consumer)\\b`, "gi"),
    fix: (_m, as, adj, noun) => `${as} a former ${adj}kratom ${noun}`,
  },
  // "I use kratom" / "I still take natural kratom" / "I rely on kratom"
  {
    re: new RegExp(`\\bI (?:currently |still |now )?(use|take|consume|buy|purchase|depend on|rely on) ${LEAF}kratom\\b`, "gi"),
    fix: (m, verb) => m.replace(/^I (?:currently |still |now )?/i, "I ").replace(verb, past(verb)),
  },
  // "I've been using kratom" / "I have used kratom for six years"
  {
    re: new RegExp(`\\bI(?:'ve|’ve| have) (?:been )?(using|taking|relying on|depending on|used|taken) ${LEAF}kratom\\b`, "gi"),
    fix: (m, verb) => m.replace(/^I(?:'ve|’ve| have) (?:been )?/i, "I ").replace(verb, past(verb)),
  },
  // "kratom helps me" / "Kratom lets me work"
  {
    re: /\bkratom (helps|keeps|allows|lets|gives) me\b/gi,
    fix: (m, verb) => m.replace(verb, past(verb)),
  },
  // "a resident who relies on kratom"
  {
    re: /\b(who|that) (relies|rely|depends|depend) on kratom\b/gi,
    fix: (m, _who, verb) => m.replace(verb, past(verb)),
  },
  // "my daily kratom use": no safe automatic wording, so flag only.
  { re: /\bmy (?:daily |regular )?kratom (?:use|routine|dose|regimen)\b/gi, fix: null },
];

/** The phrases that admit current use, in the order they appear. */
export function findUseAdmissions(text: string): string[] {
  const found: { at: number; phrase: string }[] = [];
  for (const { re } of RULES) {
    for (const m of String(text ?? "").matchAll(re)) found.push({ at: m.index ?? 0, phrase: m[0] });
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.phrase))];
}

/** The text with every phrase we know how to reword put in the past tense. */
export function rewordUseAdmissions(text: string): string {
  let out = String(text ?? "");
  for (const { re, fix } of RULES) {
    if (fix) out = out.replace(re, fix as (substring: string, ...args: string[]) => string);
  }
  return out;
}
