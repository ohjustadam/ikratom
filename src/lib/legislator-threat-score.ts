/**
 * Composite threat + vulnerability scoring for kratom-policy targeting.
 *
 * Inputs are the same signals the briefing already pulls together
 * (stance, sponsorships, committees, donor industries, personal trades).
 * Outputs:
 *   - threat_score (0-100): how dangerous this legislator is to kratom
 *     access. Higher = active opponent with structural power +
 *     financial conflicts.
 *   - vulnerability_score (0-100): how persuadable / flippable. Higher
 *     = unknown stance + no donor conflicts + on a kratom-relevant
 *     committee (most leverage).
 *   - tier: discrete bucket for triage. Mutually exclusive, ordered
 *     by advocate priority.
 *
 * Deterministic. No AI. Same inputs → same scores. Auditable.
 *
 * Used by:
 *   - /intel/threat-matrix (the ranked target list)
 *   - /legislators/[id]/briefing header chip
 *   - /states/[code]/briefing triage refinements (future)
 */
import type { Stance } from "./legislator-action-plan";

export type ThreatInputs = {
  stance: Stance;
  // Sponsorships
  has_anti_sponsorship: boolean;
  has_pro_sponsorship: boolean;
  primary_sponsorship_count: number;
  cosponsorship_count: number;
  // Committee posture
  is_chair_of_kratom_relevant: boolean;
  is_member_of_kratom_relevant: boolean;
  // Bills they decide right now
  bills_in_their_committees: number;
  // Federal donor flags (null = state-level, treat as 0)
  pharma_usd: number | null;
  alcohol_usd: number | null;
  tobacco_usd: number | null;
  addiction_treatment_usd: number | null;
  cannabis_usd: number | null;
  gaming_usd: number | null;
  hospital_health_usd: number | null;
  // STOCK Act personal trades (null = state-level)
  kratom_adjacent_trade_count: number | null;
};

export type ThreatTier =
  | "active_opponent"        // hostile + anti-sponsorship + structural power = NEUTRALIZE
  | "hostile_decision_maker" // hostile + committee/bills power but no sponsorship yet = BLOCK
  | "champion"               // pro/champion + active = REINFORCE
  | "sympathetic_ally"       // sympathetic with cosponsorship or stance = UPGRADE
  | "flippable_target"       // unknown/neutral + on relevant committee + low conflicts = CONVERT
  | "education_target"       // neutral, no committee, no conflicts = INFORM
  | "low_priority";          // unknown + zero signal

export type ThreatAssessment = {
  threat_score: number;          // 0-100
  vulnerability_score: number;   // 0-100 (flippability)
  tier: ThreatTier;
  tier_label: string;
  tier_emoji: string;
  tier_color: string;            // tailwind class fragment
  rationale: string;             // one-line human-readable why
};

// Sum the donor flags into one "industry conflict" magnitude.
// Hospital_health is the largest natural bucket so it gets less weight
// per-dollar than the more-targeted alarms (pharma, addiction-treatment).
function donorConflictMagnitude(inp: ThreatInputs): number {
  const buckets: Array<[number | null, number]> = [
    [inp.pharma_usd, 1.5],
    [inp.alcohol_usd, 1.2],
    [inp.tobacco_usd, 1.2],
    [inp.addiction_treatment_usd, 1.8], // direct competitor to kratom self-management
    [inp.cannabis_usd, 0.6],            // adjacent but less directly conflicting
    [inp.gaming_usd, 0.5],
    [inp.hospital_health_usd, 0.4],     // largest natural bucket; weight down
  ];
  let weighted = 0;
  for (const [usd, weight] of buckets) {
    if (usd != null && usd > 0) {
      // Logarithmic — first $10K is the signal, after that diminishing
      weighted += Math.log10(usd / 1000 + 1) * weight * 10;
    }
  }
  return weighted;
}

/**
 * Compute a composite threat assessment for a legislator.
 *
 * Threat = (anti-stance × 25) + (anti-sponsorship × 20) + (committee
 *           power × 15) + (currently deciding bills × 10) + (donor
 *           conflict × log-scaled) + (personal trades × 15 each, capped)
 *
 * Vulnerability = (unknown/neutral stance × 30) + (no donor conflict
 *                  × 20) + (kratom-relevant committee × 25) + (no
 *                  anti-sponsorship × 15) + (low primary sponsorship
 *                  count × 10)
 *
 * Tier picks one bucket based on combined signals; advocates know
 * exactly what to do at each tier without reading a long memo.
 *
 * Signal-derived stance: when explicit stance is "unknown" but the
 * legislator has primary sponsorship of an ANTI bill (or primary of
 * a PRO bill), we infer effective hostility (or championship) so the
 * tier classification reflects actions, not just drafted stances.
 * Marked in the rationale as "(signal-derived)".
 */

/**
 * Derive an effective stance from explicit stance + structural signals.
 * The AI stance drafter only covers ~14% of legislators today; sponsorship
 * data is structural and self-revealing — if a legislator primary-sponsors
 * an active anti-kratom bill, they ARE hostile regardless of whether AI
 * has gotten around to drafting them.
 */
export function effectiveStance(inp: ThreatInputs): { stance: Stance; derived: boolean } {
  if (inp.stance !== "unknown") return { stance: inp.stance, derived: false };
  // Primary sponsor of an active anti bill = effective hostile
  if (inp.primary_sponsorship_count > 0 && inp.has_anti_sponsorship) {
    return { stance: "hostile", derived: true };
  }
  // Primary sponsor of an active pro bill = effective champion
  if (inp.has_pro_sponsorship && inp.primary_sponsorship_count > 0) {
    return { stance: "champion", derived: true };
  }
  // Cosponsor of an anti bill = effectively neutral (light hostile lean)
  if (inp.has_anti_sponsorship) return { stance: "neutral", derived: true };
  // Cosponsor of a pro bill = effectively sympathetic
  if (inp.has_pro_sponsorship) return { stance: "sympathetic", derived: true };
  return { stance: "unknown", derived: false };
}

export function assessThreat(inp: ThreatInputs): ThreatAssessment {
  const { stance: derivedStance, derived: stanceDerived } = effectiveStance(inp);
  // Operate on the derived stance for tier branching + the threat
  // calculation. Explicit stance still wins when set.
  const stance = derivedStance;
  // ── Threat
  let threat = 0;
  if (stance === "hostile") threat += 25;
  else if (stance === "neutral") threat += 5;
  if (inp.has_anti_sponsorship) threat += 20;
  if (inp.primary_sponsorship_count > 0 && inp.has_anti_sponsorship) {
    threat += Math.min(inp.primary_sponsorship_count * 5, 15);
  }
  if (inp.is_chair_of_kratom_relevant) threat += 15;
  else if (inp.is_member_of_kratom_relevant) threat += 7;
  if (inp.bills_in_their_committees > 0) {
    threat += Math.min(inp.bills_in_their_committees * 3, 10);
  }
  threat += Math.min(donorConflictMagnitude(inp), 20);
  if (inp.kratom_adjacent_trade_count != null && inp.kratom_adjacent_trade_count > 0) {
    threat += Math.min(inp.kratom_adjacent_trade_count * 1.5, 15);
  }
  // Champions/sympathetic legislators get a strong negative — they
  // can't be a threat ranked on the same scale as opponents.
  if (stance === "champion") threat = Math.max(0, threat - 50);
  if (stance === "sympathetic") threat = Math.max(0, threat - 30);
  if (inp.has_pro_sponsorship) threat = Math.max(0, threat - 20);
  threat = Math.max(0, Math.min(100, Math.round(threat)));

  // ── Vulnerability (flippability — for non-hostile)
  let vuln = 0;
  if (stance === "unknown") vuln += 25;
  else if (stance === "neutral") vuln += 30;
  else if (stance === "sympathetic") vuln += 15;
  // Vulnerable when on a committee where they can act on what we teach them
  if (inp.is_member_of_kratom_relevant) vuln += 20;
  if (inp.is_chair_of_kratom_relevant) vuln += 15; // chair = max leverage
  if (inp.bills_in_their_committees > 0) {
    vuln += Math.min(inp.bills_in_their_committees * 4, 15);
  }
  // No donor conflicts → no industry holding them back
  const conflict = donorConflictMagnitude(inp);
  if (conflict < 5) vuln += 20;
  else if (conflict < 15) vuln += 10;
  // Active opponents (anti-sponsorship) aren't flippable
  if (inp.has_anti_sponsorship) vuln = Math.max(0, vuln - 35);
  if (stance === "hostile") vuln = Math.max(0, vuln - 25);
  vuln = Math.max(0, Math.min(100, Math.round(vuln)));

  // ── Tier (priority bucket)
  let tier: ThreatTier;
  let label: string;
  let emoji: string;
  let color: string;
  let rationale: string;

  const hasCommitteePower = inp.is_chair_of_kratom_relevant || inp.is_member_of_kratom_relevant;
  const decidingNow = inp.bills_in_their_committees > 0;

  const stanceTag = stanceDerived ? " (signal-derived)" : "";

  if (stance === "hostile" && inp.has_anti_sponsorship) {
    tier = "active_opponent";
    label = "Active opponent";
    emoji = "🚨";
    color = "border-red-500 bg-red-950/30 text-red-200";
    rationale = `Hostile${stanceTag} + primary sponsor of ${inp.primary_sponsorship_count} restrictive bill${inp.primary_sponsorship_count === 1 ? "" : "s"}. Organize counter-pressure; flipping unlikely.`;
  } else if (stance === "hostile" && (hasCommitteePower || decidingNow)) {
    tier = "hostile_decision_maker";
    label = "Hostile decision-maker";
    emoji = "⚠";
    color = "border-red-700/50 bg-red-950/15 text-red-200";
    rationale = `Hostile${stanceTag} + ${inp.is_chair_of_kratom_relevant ? "chairs a kratom-deciding committee" : "sits on kratom-deciding committee"}. Block their bills; pressure on procedural process.`;
  } else if (stance === "champion") {
    tier = "champion";
    label = "Champion";
    emoji = "⭐";
    color = "border-emerald-500/50 bg-emerald-950/20 text-emerald-200";
    rationale = inp.has_pro_sponsorship
      ? `Champion${stanceTag} — primary sponsor of pro-kratom legislation. Reinforce + fuel their case with stories.`
      : `Champion${stanceTag} — public posture. Don't ask for a position; equip them.`;
  } else if (stance === "sympathetic") {
    tier = "sympathetic_ally";
    label = "Sympathetic ally";
    emoji = "🤝";
    color = "border-emerald-700/40 bg-emerald-950/10 text-emerald-300";
    rationale = inp.cosponsorship_count > 0
      ? `Cosponsor of pro-kratom legislation. Push for primary-sponsor upgrade on next bill.`
      : `Sympathetic public posture. Push for public commitment + cosponsorship.`;
  } else if (
    (stance === "unknown" || stance === "neutral")
    && (hasCommitteePower || decidingNow)
    && conflict < 15
  ) {
    tier = "flippable_target";
    label = "Flippable target";
    emoji = "🎯";
    color = "border-amber-500/60 bg-amber-950/20 text-amber-200";
    rationale = `${stance === "neutral" ? "Neutral" : "Unknown"} stance + on kratom-deciding committee + low donor conflicts. Education window is open; conversion is realistic.`;
  } else if (stance === "neutral" || (stance === "unknown" && conflict < 5)) {
    tier = "education_target";
    label = "Education target";
    emoji = "📚";
    color = "border-sky-700/40 bg-sky-950/10 text-sky-300";
    rationale = `${stance === "neutral" ? "Neutral" : "Unknown stance"} legislator without committee leverage or significant donor conflicts. Build relationship for future leverage.`;
  } else {
    tier = "low_priority";
    label = "Low priority";
    emoji = "·";
    color = "border-zinc-800 bg-zinc-950/40 text-zinc-400";
    rationale = `No kratom signal + no structural power on kratom issues. Touch lightly via newsletters; don't burn outreach budget.`;
  }

  return {
    threat_score: threat,
    vulnerability_score: vuln,
    tier,
    tier_label: label,
    tier_emoji: emoji,
    tier_color: color,
    rationale,
  };
}

export const TIER_ORDER: ThreatTier[] = [
  "active_opponent",
  "hostile_decision_maker",
  "flippable_target",
  "champion",
  "sympathetic_ally",
  "education_target",
  "low_priority",
];

export const TIER_META: Record<ThreatTier, { label: string; emoji: string; description: string }> = {
  active_opponent: {
    label: "Active opponents",
    emoji: "🚨",
    description: "Hostile stance + primary sponsor of restrictive bills. Conversion unlikely; organize counter-pressure.",
  },
  hostile_decision_maker: {
    label: "Hostile decision-makers",
    emoji: "⚠",
    description: "Hostile + committee/bill power. Block their bills procedurally.",
  },
  flippable_target: {
    label: "Flippable targets",
    emoji: "🎯",
    description: "Unknown/neutral + on kratom-deciding committee + low donor conflicts. Highest conversion ROI.",
  },
  champion: {
    label: "Champions",
    emoji: "⭐",
    description: "Pro-kratom public posture. Reinforce + fuel their case.",
  },
  sympathetic_ally: {
    label: "Sympathetic allies",
    emoji: "🤝",
    description: "Sympathetic posture + cosponsorship. Upgrade them to primary sponsor.",
  },
  education_target: {
    label: "Education targets",
    emoji: "📚",
    description: "Neutral / unknown + no power or conflicts. Build relationship for future leverage.",
  },
  low_priority: {
    label: "Low priority",
    emoji: "·",
    description: "No kratom signal + no committee leverage. Touch lightly; don't burn outreach budget.",
  },
};
