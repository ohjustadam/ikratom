import type { Stance } from "./legislator-action-plan";
import type { ThreatTier } from "./legislator-threat-score";

/**
 * "Follow the money" — a nonpartisan, RULE-BASED (no AI) synthesis that connects
 * an official's campaign money + personal trades to how they act on kratom, and
 * says plainly WHY it matters for an advocate. Deterministic so it's testable +
 * free-tier-safe.
 *
 * "Restriction-aligned" industries = those with a plausible financial interest
 * that runs COUNTER to keeping kratom legal/accessible: pharma (kratom competes
 * as a pain/addiction option), addiction-treatment (same patients), tobacco,
 * alcohol, hospital/health systems. This is a stated, sourced framing — not a
 * motive claim about any individual. Federal-only: state campaign-finance data
 * does not exist in our corpus (never fabricated) → returns null for state.
 */
export type MoneyConflictInput = {
  donorMatched: boolean;
  industries: {
    pharma: number | null;
    tobacco: number | null;
    alcohol: number | null;
    addictionTreatment: number | null;
    hospitalHealth: number | null;
  };
  kratomAdjacentTrades: number;
  stance: Stance;
  threatTier: ThreatTier;
};

export type MoneyConflict = {
  restrictionAlignedUsd: number;
  topIndustries: Array<{ key: string; label: string; usd: number }>;
  kratomAdjacentTrades: number;
  level: "aligned" | "watch" | "ally" | "clean";
  posture: "restrict" | "protect" | "unclear";
  headline: string;
  narrative: string;
  whyItMatters: string;
};

const INDUSTRY_LABEL: Record<string, string> = {
  pharma: "Pharmaceuticals",
  addictionTreatment: "Addiction treatment",
  tobacco: "Tobacco / nicotine",
  alcohol: "Alcohol",
  hospitalHealth: "Hospital / health systems",
};

// $10k floor — below this, campaign-finance "conflict" is noise, not signal.
const MATERIAL_USD = 10_000;

function postureFromTier(tier: ThreatTier, stance: Stance): "restrict" | "protect" | "unclear" {
  if (tier === "active_opponent" || tier === "hostile_decision_maker") return "restrict";
  if (tier === "champion" || tier === "sympathetic_ally") return "protect";
  if (stance === "hostile") return "restrict";
  if (stance === "champion" || stance === "sympathetic") return "protect";
  return "unclear";
}

const fmtUsd = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);

export function buildMoneyConflict(inp: MoneyConflictInput): MoneyConflict | null {
  // No federal donor match AND no flagged trades = nothing sourced to say.
  if (!inp.donorMatched && inp.kratomAdjacentTrades <= 0) return null;

  const entries = Object.entries(inp.industries)
    .map(([key, usd]) => ({ key, label: INDUSTRY_LABEL[key] ?? key, usd: usd ?? 0 }))
    .filter((e) => e.usd > 0)
    .sort((a, b) => b.usd - a.usd);
  const restrictionAlignedUsd = entries.reduce((s, e) => s + e.usd, 0);
  const posture = postureFromTier(inp.threatTier, inp.stance);
  const hasMaterialMoney = restrictionAlignedUsd >= MATERIAL_USD;
  const hasTrades = inp.kratomAdjacentTrades > 0;
  const hasSignal = hasMaterialMoney || hasTrades;

  let level: MoneyConflict["level"];
  if (!hasSignal) level = "clean";
  else if (posture === "restrict") level = "aligned";
  else if (posture === "protect") level = "ally";
  else level = "watch";

  const topList = entries.slice(0, 3);
  const moneyPhrase = hasMaterialMoney
    ? `${fmtUsd(restrictionAlignedUsd)} from ${topList.map((e) => e.label.toLowerCase()).join(", ")}`
    : "";
  const tradePhrase = hasTrades
    ? `${inp.kratomAdjacentTrades} personal stock trade${inp.kratomAdjacentTrades === 1 ? "" : "s"} in kratom-adjacent companies`
    : "";
  const sources = [moneyPhrase, tradePhrase].filter(Boolean).join(" + ");

  let headline: string, narrative: string, whyItMatters: string;
  switch (level) {
    case "aligned":
      headline = "⚠ Financial interest aligned with restricting kratom";
      narrative = `Took ${sources} — industries that profit when kratom is restricted — and acts to restrict it (${inp.threatTier === "active_opponent" ? "primary anti-kratom sponsor" : "hostile record"}).`;
      whyItMatters = "Their money and their votes point the same direction, so data alone won't move them — lead with constituent stories and the human cost, and name the conflict plainly when you contact them.";
      break;
    case "ally":
      headline = "Protects kratom despite restriction-aligned money";
      narrative = `Took ${sources} from industries that profit when kratom is restricted — yet has a pro-kratom record. An ally acting against that financial pull.`;
      whyItMatters = "A reliable ally worth thanking and keeping engaged — a thank-you keeps them voting with you, and they can be a credible messenger to colleagues who took the same money.";
      break;
    case "watch":
      headline = "Restriction-aligned money, posture not yet clear";
      narrative = `Took ${sources} from industries that profit when kratom is restricted; no clear kratom voting/sponsorship record yet.`;
      whyItMatters = "A persuadable target where the money cuts against us — get to them early with constituent contact before the industry framing sets in.";
      break;
    default:
      headline = "No notable kratom-industry financial conflict";
      narrative = "No material campaign money from restriction-aligned industries and no kratom-adjacent personal trades on record.";
      whyItMatters = "Make the merits case on substance — there's no obvious financial counter-pressure to work against here.";
  }

  return { restrictionAlignedUsd, topIndustries: topList, kratomAdjacentTrades: inp.kratomAdjacentTrades, level, posture, headline, narrative, whyItMatters };
}
