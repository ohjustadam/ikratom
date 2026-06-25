// Shared bill-status derivation from a bill's free-text `last_action`.
//
// Why this exists: LegiScan's numeric status code maps cleanly (see STATUS_MAP
// in sync-bills-via-legiscan.mjs), but most bills are only ever touched by the
// OpenStates keyword sync, which derives status from `latest_action_description`.
// The old derivation only caught `signed | became law | enacted`, so the exact
// phrasings states actually use — "Becomes law without Governor's signature"
// (OK SB 891), "Approved by Governor" (OK HB 1784), "Act No. 35" (SC S 221),
// "Signed by the Governor on …" (SD/RI/VA) — slipped through and bills sat at
// `passed_chamber`/`introduced` forever. That's why the "enacted" filter was
// empty for OK and why dead bills read as "still in process".
//
// Keep this conservative: a terminal classification overrides a non-terminal
// one, but an absent signal returns null (caller keeps the existing status).

// Veto OVERRIDE means the bill became law despite the veto — check before plain veto.
const VETO_OVERRIDE_RE =
  /(?:\bveto\s+overr\w*|\boverr\w*\s+(?:the\s+)?(?:governor'?s\s+)?veto\b|\bpassed\s+over\s+(?:the\s+)?(?:governor'?s\s+)?veto\b|\bnotwithstanding\s+the\s+(?:governor'?s\s+)?veto\b)/i;

// Strong enactment signals. "signed" is qualified (by governor/president/mayor or
// "into law") so a procedural "Signed by the Speaker/Clerk" is NOT misread as enacted.
const ENACTED_RE =
  /(?:\bsigned\s+(?:into\s+law|by\s+(?:the\s+)?(?:governor|president|mayor))|\bgovernor\s+signed|\bbec(?:ame|omes)\s+law|\bapproved\s+by\s+(?:the\s+)?governor|\benacted\b|\bchaptered\b|\bchapter\s+(?:no\.?\s*)?\d+|\bact\s+no\.?\s*\d|\bpublic\s+(?:law|act)\b|\bsession\s+law\b)/i;

const VETO_RE = /\bveto(?:ed|es)?\b/i;

const DEAD_RE =
  /\b(?:died|indefinitely\s+postponed|postponed\s+indefinitely|withdrawn|failed|stricken|tabled|defeated|killed|adjourned\s+sine\s+die|did\s+not\s+pass|enacting\s+clause\s+stricken|sine\s+die)\b/i;

// Returns "enacted" | "vetoed" | "dead" | null (null = no terminal signal).
export function terminalStatusFromAction(lastAction) {
  const s = String(lastAction ?? "");
  if (!s.trim()) return null;
  if (VETO_OVERRIDE_RE.test(s)) return "enacted";
  if (ENACTED_RE.test(s)) return "enacted";
  if (VETO_RE.test(s)) return "vetoed";
  if (DEAD_RE.test(s)) return "dead";
  return null;
}

// Full status ladder for the OpenStates sync (replaces the old narrow regex).
// Collapses to the schema's stages: introduced | committee | passed_chamber |
// enacted | vetoed | dead.
export function deriveStatusFromAction(lastAction) {
  const t = terminalStatusFromAction(lastAction);
  if (t) return t;
  const s = String(lastAction ?? "").toLowerCase();
  if (s.includes("passed") || s.includes("third reading") || s.includes("read third time")) return "passed_chamber";
  if (s.includes("committee") || s.includes("referred")) return "committee";
  return "introduced";
}

export const TERMINAL_STATUSES = new Set(["enacted", "vetoed", "dead", "failed"]);
