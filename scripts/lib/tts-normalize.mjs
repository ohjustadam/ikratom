// scripts/lib/tts-normalize.mjs
//
// Normalize policy text so neural TTS (Kokoro) reads it like a human, not a
// robot. The big offenders in kratom-policy copy: Roman-numeral drug schedules
// ("Schedule I" read as the letter "eye"), person initialisms ("RFK Jr."),
// agency acronyms, and honorific abbreviations ("Gov.", "Sen.").
//
// Shared so EVERY TTS surface (the daily brief render + any future Listen
// button) speaks consistently. Order matters — most specific first.

const ROMAN = { i: "one", ii: "two", iii: "three", iv: "four", v: "five" };
const DIGIT = ["one", "two", "three", "four", "five"];

export function normalizeForTTS(input) {
  let s = String(input ?? "");

  // em/en dashes -> spoken pause
  s = s.replace(/[—–]/g, " - ");

  // Drug schedules: "Schedule I/II/III/IV/V" (Roman) -> words. Without this TTS
  // says "Schedule eye". (IV/III before II/I so the longest matches first.)
  s = s.replace(/\bSchedule\s+(IV|III|II|I|V)\b/g, (_, r) => `Schedule ${ROMAN[r.toLowerCase()]}`);
  s = s.replace(/\bSchedule\s+([1-5])\b/g, (_, n) => `Schedule ${DIGIT[Number(n) - 1]}`);

  // People + honorifics
  s = s.replace(/\bRFK\b/g, "Robert F. Kennedy");
  s = s.replace(/\bGov\.\s*/g, "Governor ");
  s = s.replace(/\bSen\.\s*/g, "Senator ");
  s = s.replace(/\bReps?\.\s*/g, "Representative ");
  s = s.replace(/\bGen\.\s*/g, "General ");
  s = s.replace(/\bLt\.\s*/g, "Lieutenant ");
  s = s.replace(/\bDr\.\s*/g, "Doctor ");
  s = s.replace(/\bRev\.\s*/g, "Reverend ");
  s = s.replace(/\bAtty\.\s*/g, "Attorney ");
  s = s.replace(/\bDept\.\s*/g, "Department ");
  s = s.replace(/\bJr\b\.?/g, "Junior");
  s = s.replace(/\bSr\b\.?/g, "Senior");

  // Place abbreviations
  s = s.replace(/\bSt\.\s+([A-Z])/g, "Saint $1");   // St. Louis, St. Paul
  s = s.replace(/\bMt\.\s+([A-Z])/g, "Mount $1");    // Mt. Prospect
  s = s.replace(/\bU\.S\.A\.?/g, "U S A");
  s = s.replace(/\bU\.S\.\B/g, "United States ");    // "U.S." before a word
  s = s.replace(/\bU\.S\.\b/g, "United States");

  // Agencies / acronyms — expand where a human would say words; spell out true
  // initialisms (letter-by-letter) where they wouldn't.
  s = s.replace(/\bDOJ\b/g, "Department of Justice");
  s = s.replace(/\bCSA\b/g, "Controlled Substances Act");
  s = s.replace(/\bKCPA\b/g, "Kratom Consumer Protection Act");
  s = s.replace(/\bNIDA\b/g, "National Institute on Drug Abuse");
  s = s.replace(/\bAG\b/g, "Attorney General");
  s = s.replace(/\bBoP\b/g, "Board of Pharmacy");
  s = s.replace(/\bDEA\b/g, "D E A");
  s = s.replace(/\bFDA\b/g, "F D A");
  s = s.replace(/\bFTC\b/g, "F T C");
  s = s.replace(/\bHHS\b/g, "H H S");
  s = s.replace(/\bCDC\b/g, "C D C");
  s = s.replace(/\bNIH\b/g, "N I H");
  s = s.replace(/\bEPA\b/g, "E P A");

  // Chemistry
  s = s.replace(/\b7-hydroxymitragynine\b/gi, "seven-hydroxy mitragynine");
  s = s.replace(/\b7-OH\b/gi, "seven-hydroxy");

  // Symbols / misc
  s = s.replace(/&/g, " and ");
  s = s.replace(/\bvs\.?\b/gi, "versus");
  s = s.replace(/\betc\.?\b/gi, "etcetera");
  s = s.replace(/\bapprox\.\s*/gi, "approximately ");
  s = s.replace(/\bNo\.\s*(\d)/g, "Number $1");      // "No. 5" -> "Number 5"

  // Collapse runs of terminal punctuation (".." / "?." / "…") into one so TTS
  // doesn't stumble on a doubled stop.
  s = s.replace(/…/g, ".");                      // ellipsis char -> period
  s = s.replace(/([.?!])[.?!\s]*\1+/g, "$1");
  s = s.replace(/([?!])\./g, "$1");

  return s.replace(/\s+/g, " ").trim();
}
