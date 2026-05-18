/**
 * Bill momentum heuristic — predicts whether a bill is advancing,
 * stalled, or effectively dead. No ML; pure observable-signal scoring.
 *
 * Inputs (all already on the bill row or derivable from joins):
 *   - last_action_at: how stale is the bill?
 *   - status: introduced / passed_committee / passed_chamber / enacted / dead
 *   - current_committee_name: still in committee vs. floor
 *   - sponsor count + diversity
 *   - cluster membership: more clusters = part of a coordinated push
 *   - recent news mention count (last 30d)
 *
 * Output: { score: 0-100, label: human-readable, signals: [...why] }
 *
 * v2: train an actual classifier on historical bill outcomes once we
 * have ≥1 full session of labeled data. For now the heuristic
 * captures the obvious signals an experienced advocate would weigh.
 */

export type BillMomentumInput = {
  last_action_at: string | null;
  status: string | null;
  current_committee_name: string | null;
  sponsor_count: number;
  cluster_count: number;
  recent_news_mentions: number;        // last 30d
  active: boolean;
};

export type BillMomentum = {
  /** 0–100. Higher = more momentum / likely to advance. */
  score: number;
  /** Bucketed verdict for at-a-glance display. */
  label: "advancing-fast" | "active" | "watch" | "likely-stalled" | "dead";
  /** Human-readable contributing signals — surface as chips. */
  signals: string[];
  /** Optional one-line interpretation. */
  rationale: string;
};

const STATUS_BOOST: Record<string, number> = {
  introduced: 5,
  in_committee: 10,
  passed_committee: 25,
  passed_chamber: 35,
  enacted: 50,
  dead: -50,
  vetoed: -30,
};

export function computeBillMomentum(input: BillMomentumInput): BillMomentum {
  const signals: string[] = [];
  let score = 40; // neutral baseline

  // 1. Recency of last action (decay)
  if (input.last_action_at) {
    const ageDays = (Date.now() - new Date(input.last_action_at).getTime()) / 86400000;
    if (ageDays < 7) {
      score += 25;
      signals.push("acted on within last week");
    } else if (ageDays < 30) {
      score += 10;
      signals.push("acted on this month");
    } else if (ageDays < 90) {
      score -= 5;
      signals.push("no action in 30+ days");
    } else if (ageDays < 180) {
      score -= 20;
      signals.push("stale 90+ days");
    } else {
      score -= 35;
      signals.push("stale 180+ days");
    }
  } else {
    score -= 10;
    signals.push("no recorded actions");
  }

  // 2. Status boost
  const statusKey = (input.status ?? "").toLowerCase().replace(/[^a-z_]/g, "_");
  for (const [k, boost] of Object.entries(STATUS_BOOST)) {
    if (statusKey.includes(k)) {
      score += boost;
      if (boost >= 25) signals.push(`status: ${k.replace(/_/g, " ")}`);
      break;
    }
  }

  // 3. Currently in a committee → some structural momentum
  if (input.current_committee_name) {
    score += 5;
    signals.push("active committee referral");
  }

  // 4. Sponsor concentration
  if (input.sponsor_count >= 10) {
    score += 12;
    signals.push(`${input.sponsor_count} sponsors`);
  } else if (input.sponsor_count >= 5) {
    score += 6;
    signals.push(`${input.sponsor_count} sponsors`);
  } else if (input.sponsor_count >= 2) {
    score += 2;
  } else {
    score -= 3;
    signals.push("solo or no co-sponsor");
  }

  // 5. Cluster membership — coordinated push signal
  if (input.cluster_count >= 2) {
    score += 10;
    signals.push("part of multi-cluster operation");
  } else if (input.cluster_count === 1) {
    score += 5;
    signals.push("part of detected operation");
  }

  // 6. News mentions — public attention
  if (input.recent_news_mentions >= 5) {
    score += 12;
    signals.push(`${input.recent_news_mentions} news mentions this month`);
  } else if (input.recent_news_mentions >= 1) {
    score += 5;
    signals.push("recent news coverage");
  }

  // 7. Inactive bills are dead regardless
  if (!input.active) {
    score = Math.min(score, 5);
    signals.push("marked inactive");
  }

  // Clamp + label
  score = Math.max(0, Math.min(100, Math.round(score)));

  let label: BillMomentum["label"];
  let rationale: string;
  if (!input.active || statusKey.includes("dead") || statusKey.includes("vetoed")) {
    label = "dead";
    rationale = "Bill is inactive or has been marked dead/vetoed.";
  } else if (score >= 75) {
    label = "advancing-fast";
    rationale = "Heavy recent activity, strong sponsor backing, and structural momentum.";
  } else if (score >= 55) {
    label = "active";
    rationale = "Moving through the process at normal pace.";
  } else if (score >= 35) {
    label = "watch";
    rationale = "Some signal, but not enough to predict movement either way.";
  } else if (score >= 20) {
    label = "likely-stalled";
    rationale = "Stale, thin sponsor base, no recent attention — usually how bills die in this state.";
  } else {
    label = "dead";
    rationale = "Functionally dead — far stale, no sponsor energy, no public attention.";
  }

  return { score, label, signals, rationale };
}

/** Tailwind tone classes per label — keeps consumer pages consistent. */
export const MOMENTUM_TONE: Record<BillMomentum["label"], string> = {
  "advancing-fast": "border-red-500/60 bg-red-950/15 text-red-200",
  active:           "border-amber-500/60 bg-amber-950/15 text-amber-200",
  watch:            "border-zinc-700 bg-zinc-900/40 text-zinc-200",
  "likely-stalled": "border-emerald-700/40 bg-emerald-950/10 text-emerald-200",
  dead:             "border-zinc-800 bg-zinc-950/40 text-zinc-500",
};

export const MOMENTUM_LABEL: Record<BillMomentum["label"], string> = {
  "advancing-fast": "⚡ Advancing fast",
  active:           "🟠 Active",
  watch:            "👀 Watch",
  "likely-stalled": "🐢 Likely stalled",
  dead:             "💀 Dead / inactive",
};
