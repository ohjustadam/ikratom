// Does a state briefing's Snapshot contradict the confirmed legal status?
// The AI drafts from bills and news, and on 2026-10-29 a Connecticut draft
// said "no active statutory restrictions" about a state that bans kratom; the
// AI critic passed it. This check is plain text matching, so a draft that
// fails it is never saved. Returns the reason, or null when the draft is fine.

const BAN_WORDS = /\b(bans?|banned|prohibit\w*|illegal|outlaw\w*|schedule i)\b/i;
const SAYS_LEGAL = /\bkratom (remains|is) (still |fully |currently )?legal\b|\bremains legal in\b|\bno (active |current )?(statutory |state )?(restrictions|ban)\b|\blegal state for\b/i;
const SAYS_BANNED = /\bkratom is (now )?(banned|illegal)\b|\b(total|outright|statewide) ban (on|of) (natural[- ]leaf )?kratom (is|remains) in (effect|force)\b|\bhas a (total |outright )?statewide ban on natural[- ]leaf\b/i;

export function snapshotOf(body) {
  const m = /##\s*Snapshot\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(body ?? "");
  return (m ? m[1] : (body ?? "").slice(0, 800)).trim();
}

export function statusMismatch(body, leaf) {
  const snap = snapshotOf(body);
  if (!leaf || !snap) return null;
  if (leaf === "banned") {
    if (!BAN_WORDS.test(snap)) return "the Snapshot never says the state bans kratom";
    if (SAYS_LEGAL.test(snap)) return "the Snapshot calls a banned state legal or unrestricted";
    return null;
  }
  if (SAYS_BANNED.test(snap)) return `the Snapshot says kratom is banned, but its status is ${leaf}`;
  return null;
}
