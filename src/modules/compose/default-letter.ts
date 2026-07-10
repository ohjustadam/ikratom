/**
 * Deterministic constituent letter — the compose modal's instant prefill AND
 * the fallback when the free-tier AI router is exhausted. Every email surface
 * (briefing, bill pages, directories, dashboard) prefills from here so the
 * baseline experience is identical platform-wide.
 *
 * Content rules (mirror rebuttal-actions.ts):
 *  - Always distinguish natural-leaf kratom from synthetic 7-OH products.
 *  - One concrete ask, no medical claims, respectful tone.
 *  - PRIVACY: signature is name + city/state only. Street and ZIP never
 *    enter an email body (profiles.street exists solely for district
 *    matching — see templates.ts).
 */

export type OfficialLite = {
  full_name: string;
  role?: string | null;
  title?: string | null; // 'Mayor' | 'Council Member, District 4' (local officials)
  state?: string | null;
};

export type LetterContext = {
  kind: "legislator" | "bill" | "stakeholder" | "local";
  billNumber?: string | null;
  billTitle?: string | null;
  committeeName?: string | null;
  /** Posture toward the bill — shapes the ask sentence. */
  stance?: "oppose" | "support" | "improve" | "neutral" | null;
  /** Extra recipient-specific instruction (e.g. a chair's scheduling ask). */
  ask?: string | null;
};

export type SenderLite = {
  fullName?: string | null;
  city?: string | null;
  state?: string | null;
};

/**
 * Bill-cluster posture → the composer's stance hint. Lives here (a pure,
 * server+client-safe module) rather than in a "use client" component so the
 * Operation server page can read it without dotting into a client export
 * (which throws under React Server Components).
 */
export const POSTURE_STANCE: Record<string, LetterContext["stance"]> = {
  restrictive: "oppose",
  protective: "support",
  regulatory: "improve",
  mixed: "neutral",
};

/** 'Governor Landry', 'Sen. Smith', 'Rep. Jones', 'Mayor Adams', or the raw name. */
export function officialGreeting(o: OfficialLite): string {
  const last = lastName(o.full_name);
  const prefix = ROLE_GREETING[o.role ?? ""] ?? titlePrefix(o.title);
  return prefix ? `${prefix} ${last}` : o.full_name;
}

const ROLE_GREETING: Record<string, string> = {
  us_senate: "Senator",
  us_house: "Rep.",
  state_senate: "Senator",
  state_house: "Rep.",
  governor: "Governor",
  lt_governor: "Lt. Governor",
  attorney_general: "Attorney General",
  secretary_of_state: "Secretary",
  mayor: "Mayor",
};

function titlePrefix(title?: string | null): string {
  if (!title) return "";
  // 'Council Member, District 4' → 'Council Member'
  return title.split(",")[0].trim();
}

function lastName(fullName: string): string {
  const cleaned = fullName.replace(/,?\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").trim();
  const parts = cleaned.split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

/**
 * Build the default subject + body. Deterministic — no AI, works signed-out
 * (falls back to 'A concerned advocate' and omits the locality line).
 */
export function buildDefaultLetter(input: {
  official: OfficialLite;
  context?: LetterContext | null;
  sender: SenderLite;
}): { subject: string; body: string } {
  const { official, sender } = input;
  const ctx = input.context ?? { kind: "legislator" as const };
  const greeting = officialGreeting(official);

  // Honest constituency line — only claim "constituent" when states match.
  const sameState =
    !!sender.state && !!official.state && sender.state === official.state;
  const where = [sender.city, sender.state].filter(Boolean).join(", ");
  const intro = sameState
    ? `I'm writing as your constituent${where ? ` from ${where}` : ""}.`
    : `I'm writing as a kratom consumer and advocate${where ? ` from ${where}` : ""}.`;

  const re =
    ctx.kind === "bill" && ctx.billNumber
      ? ` as you consider ${ctx.billNumber}${ctx.billTitle ? ` (${truncate(ctx.billTitle, 90)})` : ""}`
      : "";

  const billRef = ctx.billNumber ?? "this legislation";
  // Ask sentence keyed to posture. Default (no stance) = the open "where do
  // you stand" ask used platform-wide.
  const askLine =
    ctx.stance === "oppose"
      ? `My specific ask: please oppose ${billRef}. If you have concerns about kratom, target the concentrated synthetic 7-OH products — don't cut off responsible adults from natural leaf.`
      : ctx.stance === "support"
        ? `My specific ask: please support ${billRef}. Sensible consumer protections — age limits, honest labeling, independent lab testing — protect the public while preserving adult access to natural-leaf kratom.`
        : ctx.stance === "improve"
          ? `My specific ask: as ${billRef} moves, please keep any new requirements evidence-based and narrowly tailored — regulate synthetic 7-OH, but don't create barriers to access for the adults who rely on natural leaf.`
          : `My specific ask: if a measure affecting kratom reaches you, will you commit to supporting sensible consumer protections — age limits, honest labeling, independent lab testing — while preserving adult access to natural-leaf kratom?`;
  const askExtra = ctx.ask ? `\n\n${ctx.ask.trim()}` : "";

  const subject =
    ctx.kind === "bill" && ctx.billNumber
      ? ctx.stance === "oppose"
        ? `Please oppose ${ctx.billNumber} — protect natural-leaf kratom`
        : ctx.stance === "support"
          ? `Please support ${ctx.billNumber} — sensible kratom policy`
          : `Constituent input on ${ctx.billNumber} — natural-leaf kratom`
      : `Constituent ask: kratom policy${official.state ? ` — ${official.state}` : ""}`;

  const name = (sender.fullName ?? "").trim() || "A concerned advocate";

  const body = `Dear ${greeting},

${intro} I want to share my perspective on kratom policy${re}.

Please distinguish between NATURAL LEAF kratom — the traditional plant product used responsibly by adults — and highly concentrated synthetic 7-OH products. Most of the genuine safety concerns trace to the synthetics, yet policy often sweeps both together. Banning or over-restricting natural leaf punishes responsible adults while doing little about the products that actually warrant scrutiny.

${askLine}${askExtra}

I'd welcome even a brief reply on where you stand. I follow this issue closely and share what I learn with other advocates in our community.

Thank you for your time and your service.

Sincerely,
${name}${where ? `\n${where}` : ""}`;

  return { subject, body: body.slice(0, 4000) };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
