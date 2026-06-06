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
  /\b(recall|recalled|sue|sues|sued|lawsuit|arrest|arrested|indict|judge|court|ruling|ruled|settle|settlement|seiz|seized|seizure|cease|warn|warning|navy|military|recalls)\b/i;
const BAN_RE =
  /\b(ban|bans|banned|banning|schedule|scheduled|scheduling|classif|classified|prohibit|prohibits|restrict|restricts|outlaw)\b/i;

export function isCampaignWorthyAlert(kind, title) {
  if (ALWAYS.has(kind)) return true;
  if (kind === "fda_action" || kind === "dea_action") {
    const t = String(title ?? "");
    if (NOISE_RE.test(t)) return false; // recall / lawsuit / enforcement / news
    if (BAN_RE.test(t)) return true; // ban / scheduling push = the fight
    return false; // ambiguous agency news → alert
  }
  return false; // news_break, court_ruling, intel_tip, other → alert
}
