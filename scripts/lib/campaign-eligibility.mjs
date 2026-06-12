// scripts/lib/campaign-eligibility.mjs
// Shared "should this alert become a campaign?" decision — used by the audit,
// the alert→campaign script, and mirrored in the SQL trigger (migration 0178+).
//
// Owner rule (2026-06-06): campaigns only for TRUE actions —
//   • bills / local ordinances (bill_event)
//   • Board-of-Pharmacy hearings (bop_hearing)
//   • agency BAN / SCHEDULING pushes (the 7-OH fight) — fda_action/dea_action
//     whose title is about banning/scheduling, NOT a recall/lawsuit/news.
// Recalls, company lawsuits / enforcement, arrests, court rulings, and general
// news stay as ALERTS (informational), never auto-campaigns.

const ALWAYS = new Set(["bill_event", "bop_hearing"]);

// Within fda_action/dea_action the kind can't distinguish a ban push from a
// recall/lawsuit, so disambiguate on the title.
const NOISE_RE =
  /\b(recall|recalls|recalled|sue|sues|sued|lawsuit|arrest|arrested|indict|judge|court|ruling|ruled|settle|settlement|seiz|seizes|seizing|seized|seizure|cease|warn|warning|navy|military)\b/i;
const BAN_RE =
  /\b(ban|bans|banned|banning|schedule|scheduled|scheduling|classif|classified|prohibit|prohibits|restrict|restricts|outlaw)\b/i;

// NEGATIVE GATE (0183 trigger mirrors this exactly). A title describing an
// event that has ALREADY CONCLUDED, or that is pure commentary, is informational
// — never a live call-to-action — regardless of kind. Owner rule: "advisories
// shouldn't all become campaigns."
//
// IMPORTANT: this is scoped to GENUINELY-CONCLUDED words only. We deliberately
// do NOT veto live procedural states (enrolled / engrossed / reported favorably
// / returned to chamber / delivered to the governor) — those describe a bill
// still in motion, where a veto-push CTA is very much live ("delivered to the
// governor" is the PRIME moment to ask for a veto). Vetoing them would kill real
// ban-bill campaigns at birth. Clutter from clerical micro-steps is handled by
// topic-key dedup (they collapse into the bill's existing campaign), not here.
const CONCLUDED_RE =
  /signed into law|signed by (the )?governor|\benacted\b|\bchaptered\b|takes effect|effective date|\bnow law\b|becomes law|\bapplauds\b|\brebuttal\b/i;

export function isCampaignWorthyAlert(kind, title) {
  const t = String(title ?? "");
  // Negative veto: already-concluded events + commentary are never a live CTA.
  if (CONCLUDED_RE.test(t)) return false;
  // ag_enforcement is an AG lawsuit/settlement/cease-letter — informational,
  // never a constituent CTA. Explicit so the script's anchored-kinds gate and
  // this function can't disagree (the documented gate#2-vs-gate#3 drift).
  if (kind === "ag_enforcement") return false;
  if (ALWAYS.has(kind)) return true;
  if (kind === "fda_action" || kind === "dea_action") {
    if (NOISE_RE.test(t)) return false; // recall / lawsuit / enforcement / news
    if (BAN_RE.test(t)) return true; // ban / scheduling push = the fight
    return false; // ambiguous agency news → alert
  }
  return false; // news_break, court_ruling, intel_tip, other → alert
}

// ── Structured "is this bill already concluded?" gate ────────────────────────
// A bill that is already enacted / dead / chaptered / in force is MOOT — a
// "contact your officials to oppose it" campaign isn't a live call-to-action.
//
// This is driven by the bill's STRUCTURED record (status + official last_action),
// NEVER by the news headline. A title regex was deliberately rejected: it would
// false-positive on the veto-push window we keep actionable on purpose
// ("delivered to the governor", "passed the senate", "engrossed"). The bill's
// last_action reflects what the legislature ACTUALLY did, so an enacted bill is
// caught even when the status enum lags reality — observed in prod 2026-06-12:
// AL SB 273 / TN SB 1390 / VA HB 1307 all sit at status='passed_chamber' while
// last_action says 'Enacted' / 'became Pub. Ch. 502' / 'Acts of Assembly Chapter'.
//
// Critically NON-matching (these stay live CTAs): "Delivered to Governor",
// "Transmitted to Governor", "Engrossed", "Passed Senate", "Reported favorably".
const CONCLUDED_BILL_ACTION_RE =
  /\benacted\b|\bchaptered\b|\bpublic chapter\b|\bbecame (a )?(public )?law\b|\bbecame pub\b|\bacts of assembly\b|\beffective date\b|\bsigned by (the )?governor\b|\bchapter\s+\d|\bpub\.?\s*ch\.?\s*\d|\bacts?,?\s+(regular|special|extraordinary)\s+session\b/i;

export function isBillConcluded(bill) {
  if (!bill) return false;
  const status = String(bill.status ?? "").toLowerCase();
  if (status === "enacted" || status === "dead") return true;
  if (bill.active === false) return true;
  return CONCLUDED_BILL_ACTION_RE.test(String(bill.last_action ?? ""));
}

// Exported so tests/campaign-autoapprove.test.ts can assert the patterns
// behave AND — critically — that they contain no org names or party terms
// (the CLAUDE.md nonpartisan hard rule, encoded as CI).
export const ELIGIBILITY_PATTERNS = { NOISE_RE, BAN_RE, CONCLUDED_RE, CONCLUDED_BILL_ACTION_RE };
