/**
 * Rule-based action-plan generator for the legislator intel briefing.
 *
 * Inputs are structured (stance + leverage signals); output is a
 * deterministic plan with channel recommendations, talking points,
 * and urgency markers. No AI — keeps the plan auditable and consistent.
 *
 * Used by `/legislators/[id]/briefing` to render the "what you should
 * do about this person" section.
 */

export type Stance = "champion" | "sympathetic" | "neutral" | "hostile" | "unknown";

export type ActionChannel = "call" | "email" | "letter" | "hearing" | "social" | "constituent_meeting";

export type LeverageSignal = {
  // Committee posture
  isChairOfKratomRelevant: boolean;
  isMemberOfKratomRelevant: boolean;
  // Active bills they decide RIGHT NOW
  bills_in_their_committees_count: number;
  // Sponsorship signal
  primary_sponsorships: number;
  cosponsorships: number;
  has_anti_sponsorship: boolean;
  has_pro_sponsorship: boolean;
  // Donor signals (federal only; null = unavailable / state-level)
  pharma_donations_usd: number | null;
  alcohol_donations_usd: number | null;
  tobacco_donations_usd: number | null;
  // Demographic
  is_user_rep: boolean;
};

export type ActionPlan = {
  posture: string; // 2-sentence summary
  urgency: "high" | "medium" | "low";
  primary_channel: ActionChannel;
  alt_channels: ActionChannel[];
  talking_points: string[];
  watch_outs: string[]; // things NOT to say or do
  leverage_flags: LeverageFlag[];
};

export type LeverageFlag = {
  emoji: string;
  label: string;
  detail: string;
  severity: "info" | "warn" | "alarm" | "win";
};

/**
 * Build a concrete plan from a stance + leverage signal bundle.
 */
export function buildActionPlan(stance: Stance, sig: LeverageSignal): ActionPlan {
  const flags = surfaceLeverageFlags(stance, sig);

  // Urgency: high if (anti-sponsor) OR (hostile and chairs a relevant committee) OR (they're deciding bills RIGHT NOW)
  const urgency: ActionPlan["urgency"] =
    sig.has_anti_sponsorship && stance !== "champion" && stance !== "sympathetic" ? "high" :
    stance === "hostile" && sig.isChairOfKratomRelevant ? "high" :
    sig.bills_in_their_committees_count > 0 ? "high" :
    stance === "hostile" || stance === "sympathetic" || stance === "champion" ? "medium" :
    "low";

  switch (stance) {
    case "champion":
      return {
        posture: sig.has_pro_sponsorship
          ? "A pro-kratom champion — primary sponsor of supportive legislation. Treat as an ally; your job is to fuel their case."
          : "Public champion of kratom access. They've stuck their neck out; reinforcement keeps them committed.",
        urgency,
        primary_channel: "email",
        alt_channels: ["letter", "social", "constituent_meeting"],
        talking_points: [
          "Thank them by name for their specific position or bill (cite it).",
          "Share your personal kratom story — they need stories to fuel committee testimony.",
          "Ask if they have an upcoming committee hearing where you can testify in support.",
          "Offer to organize a town-hall-style gathering at a local kratom retailer.",
        ],
        watch_outs: [
          "Don't ask for a 'position' — they've already taken one. Asking suggests you haven't done homework.",
          "Don't pile generic petition signatures on a champion — they get diluted in the staff's count.",
        ],
        leverage_flags: flags,
      };

    case "sympathetic":
      return {
        posture: sig.cosponsorships > 0
          ? `Cosponsor of pro-kratom legislation — won't lead, will follow. ${sig.cosponsorships} cosponsorship${sig.cosponsorships === 1 ? "" : "s"} on record.`
          : "Has publicly distinguished natural leaf from 7-OH or expressed sympathy. Not a leader yet — pressure can convert.",
        urgency,
        primary_channel: "email",
        alt_channels: ["call", "letter", "constituent_meeting"],
        talking_points: [
          "Acknowledge their nuance (leaf vs 7-OH distinction) — many legislators don't grasp it.",
          "Ask them to upgrade from cosponsor → primary sponsor on the next pro-kratom bill, OR to publicly state a position.",
          "Bring data: number of kratom retailers in their district, employment impact of a ban.",
          "Connect them with KCPA-state legislators who've successfully passed pro-kratom legislation.",
        ],
        watch_outs: [
          "Don't conflate them with hostile legislators — they'll see the form-letter and disengage.",
          "Don't demand a public statement on the first contact — build the relationship first.",
        ],
        leverage_flags: flags,
      };

    case "neutral":
      return {
        posture: "No clear position — has not sponsored, voted, or publicly addressed kratom. Education window is open.",
        urgency,
        primary_channel: "letter",
        alt_channels: ["constituent_meeting", "email"],
        talking_points: [
          "Frame as a CONSTITUENT-PROTECTION issue, not a substance-rights debate.",
          "Distinguish natural leaf (the consumer product) from 7-OH-enriched / synthetic (the real concern).",
          "Cite specific district businesses that depend on legal kratom (retailers, herbal shops).",
          "Cite mainstream usage stats: ~2M Americans use it, primarily for pain / wellness.",
          "Request a one-on-one meeting with their healthcare/judiciary aide — staffers shape the position.",
        ],
        watch_outs: [
          "Don't lead with FDA criticism — sounds anti-government, costs you the suburban centrist.",
          "Don't pre-load them with a take. Their unfamiliarity is the leverage; let them ask questions.",
        ],
        leverage_flags: flags,
      };

    case "hostile":
      return {
        posture: sig.has_anti_sponsorship
          ? `Active opponent — primary sponsor of ${sig.primary_sponsorships} restrictive bill${sig.primary_sponsorships === 1 ? "" : "s"}. Public statements likely conflate natural leaf with 7-OH / synthetics.`
          : "Public opposition to kratom or substance-restriction posture broadly. Conversion unlikely; goal is to organize counter-pressure.",
        urgency,
        primary_channel: "call",
        alt_channels: ["constituent_meeting", "hearing", "social"],
        talking_points: [
          "DO call, not just email — phone-call volume to a hostile rep's office shows up in their daily tally.",
          "Lead with: 'I'm a constituent who uses kratom for [specific personal reason].' Names + stories > stats.",
          "Distinguish leaf from 7-OH IMMEDIATELY — many hostile reps don't realize the distinction exists.",
          "Ask: 'Will you commit to amending this bill to exempt natural-leaf kratom?'",
          "If they've taken pharma / alcohol / tobacco donations, raise the conflict directly but respectfully.",
        ],
        watch_outs: [
          "Don't argue the underlying science with their staff — they're not the decision-maker.",
          "Don't make ad-hominem attacks — these go in the 'unhinged constituent' file and damage other advocates.",
          "Don't sign generic anti-bill petitions — they get auto-filtered. Personal stories beat petitions 10x.",
        ],
        leverage_flags: flags,
      };

    case "unknown":
    default:
      return {
        posture: "No public signal yet. We don't know how they'll vote when a kratom bill reaches them. Probe phase.",
        urgency,
        primary_channel: "letter",
        alt_channels: ["email", "constituent_meeting"],
        talking_points: [
          "Send a CONSTITUENT LETTER asking explicitly: 'What is your position on natural-leaf kratom for adult consumer use?'",
          "Include a single concrete ask: 'If a bill to ban kratom comes to your desk, will you commit to supporting an exemption for natural leaf?'",
          "Mention you'll be watching their public statements + sponsorship list — accountability framing.",
          "Don't dump every kratom argument on them — they haven't asked. One question, one reply.",
        ],
        watch_outs: [
          "Don't assume they're hostile just because they haven't acted. Most legislators are neutral by default on niche issues.",
          "Don't send the same letter you'd send to a known hostile — the staff will pattern-match and downgrade your engagement score.",
        ],
        leverage_flags: flags,
      };
  }
}

/**
 * Surface the leverage signals that should appear as chip-style
 * callouts in the briefing UI. Ordered roughly by severity.
 */
function surfaceLeverageFlags(stance: Stance, sig: LeverageSignal): LeverageFlag[] {
  const out: LeverageFlag[] = [];

  if (sig.is_user_rep) {
    out.push({
      emoji: "📍",
      label: "Your representative",
      detail: "You live in this person's district. Your contact carries the most weight.",
      severity: "info",
    });
  }

  if (sig.bills_in_their_committees_count > 0) {
    out.push({
      emoji: "⚡",
      label: `Deciding ${sig.bills_in_their_committees_count} bill${sig.bills_in_their_committees_count === 1 ? "" : "s"} right now`,
      detail: "Bills are sitting in committees this person serves on. Their vote determines outcomes today.",
      severity: stance === "hostile" ? "alarm" : "win",
    });
  }

  if (sig.isChairOfKratomRelevant) {
    out.push({
      emoji: "🪑",
      label: "Chairs a kratom-deciding committee",
      detail: "Committee chairs control the calendar — they decide whether bills get heard at all.",
      severity: stance === "hostile" ? "alarm" : stance === "champion" ? "win" : "warn",
    });
  } else if (sig.isMemberOfKratomRelevant) {
    out.push({
      emoji: "🏛",
      label: "Sits on a kratom-relevant committee",
      detail: "Member of a committee historically handling kratom legislation.",
      severity: "info",
    });
  }

  if (sig.has_anti_sponsorship && stance !== "champion") {
    out.push({
      emoji: "🚫",
      label: `Primary sponsor of ${sig.primary_sponsorships} restrictive bill${sig.primary_sponsorships === 1 ? "" : "s"}`,
      detail: "Has taken active legislative action against kratom access.",
      severity: "alarm",
    });
  }

  if (sig.has_pro_sponsorship && stance !== "hostile") {
    out.push({
      emoji: "⭐",
      label: "Primary sponsor of pro-kratom legislation",
      detail: "Has taken active legislative action FOR kratom access.",
      severity: "win",
    });
  }

  // Donor conflict signals (federal only — null elsewhere).
  if (sig.pharma_donations_usd !== null && sig.pharma_donations_usd >= 50_000) {
    out.push({
      emoji: "💊",
      label: `$${Math.round(sig.pharma_donations_usd / 1000)}K from pharma`,
      detail: "Significant pharmaceutical industry contributions over recent cycles. Potential conflict on substance-restriction bills.",
      severity: "warn",
    });
  }
  if (sig.alcohol_donations_usd !== null && sig.alcohol_donations_usd >= 25_000) {
    out.push({
      emoji: "🍺",
      label: `$${Math.round(sig.alcohol_donations_usd / 1000)}K from alcohol industry`,
      detail: "Alcohol industry funds the lobby that competes with alternative substances. Worth flagging.",
      severity: "warn",
    });
  }
  if (sig.tobacco_donations_usd !== null && sig.tobacco_donations_usd >= 25_000) {
    out.push({
      emoji: "🚬",
      label: `$${Math.round(sig.tobacco_donations_usd / 1000)}K from tobacco`,
      detail: "Tobacco industry has historically lobbied against alternative substances. Worth flagging.",
      severity: "warn",
    });
  }

  return out;
}

export const CHANNEL_LABEL: Record<ActionChannel, string> = {
  call: "📞 Phone call",
  email: "✉ Email",
  letter: "✉ Constituent letter",
  hearing: "🎤 Hearing testimony",
  social: "📣 Public mention",
  constituent_meeting: "🤝 Schedule a meeting",
};

export const STANCE_META: Record<Stance, { label: string; tone: string; emoji: string }> = {
  champion: { label: "Champion", tone: "bg-emerald-500 text-zinc-950", emoji: "⭐" },
  sympathetic: { label: "Sympathetic", tone: "bg-emerald-700 text-zinc-100", emoji: "🤝" },
  neutral: { label: "Neutral", tone: "bg-zinc-700 text-zinc-100", emoji: "⚖" },
  hostile: { label: "Hostile", tone: "bg-red-600 text-zinc-100", emoji: "🚫" },
  unknown: { label: "Unknown", tone: "bg-zinc-800 text-zinc-400", emoji: "❓" },
};
