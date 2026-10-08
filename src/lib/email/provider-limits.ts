/**
 * provider-limits.ts — how much can THIS user send today, and how fast?
 *
 * We send one individual, personalised message per recipient (never BCC), so
 * "recipients per day" and "messages per day" are the same number for us and
 * the per-message recipient cap is irrelevant.
 *
 * WHY THIS EXISTS: the send path used a flat `DAILY_SEND_CAP = 100` for every
 * user on every provider. That is 3-5x stricter than the real floor, so a user
 * selecting a full 198-seat chamber got 100 emails and an error — while a
 * Workspace user who could legitimately send 2,000 was held to the same 100.
 *
 * THE RULE THAT MATTERS MOST: we must stop BEFORE the provider does. Hitting a
 * provider's real wall is not a clean failure — it can get the user's personal
 * account rate-limited or flagged for spam. Their account is not ours to risk,
 * so every tier below carries deliberate headroom (SAFETY_MARGIN) and we treat
 * the documented number as a cliff we never walk up to.
 *
 * Figures verified 2026-08-22 against:
 *   Gmail / Workspace — knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace
 *   Microsoft Graph   — learn.microsoft.com/en-us/answers/a/1880719
 *   cross-checked     — cli.nylas.com/guides/email-api-rate-limits-compared
 * Providers change these without notice. They are DATA, not logic — correct the
 * table, not the code.
 */

export type UserSendProvider = "gmail" | "outlook";

export type ProviderTier =
  | "gmail_free"
  | "gmail_workspace"
  | "outlook_consumer"
  | "outlook_business";

export type ProviderLimits = {
  tier: ProviderTier;
  provider: UserSendProvider;
  /** Human label for the UI. */
  label: string;
  /** Documented ceiling, before our safety margin. */
  documentedDaily: number;
  /** What we actually allow — documentedDaily * SAFETY_MARGIN, floored. */
  effectiveDaily: number;
  /**
   * Hard pacing limit. Microsoft enforces 30 messages/minute on Exchange
   * Online; exceeding it throttles the mailbox. Gmail has no documented
   * per-minute cap but its API quota (~250 units/sec, 100 per send) works out
   * near 150/min, so we pace there too rather than sprinting.
   */
  maxPerMinute: number;
  /** Shown in the UI so the number is never a mystery number. */
  sourceNote: string;
};

/**
 * 15% headroom. Enough that a miscount, a retry, or mail the user sent by hand
 * from the same account earlier in the day cannot push them over the real
 * ceiling. Deliberately not tunable per tier — the reason applies everywhere.
 */
const SAFETY_MARGIN = 0.85;

const TIERS: Record<ProviderTier, Omit<ProviderLimits, "effectiveDaily">> = {
  gmail_free: {
    tier: "gmail_free",
    provider: "gmail",
    label: "Gmail (personal)",
    documentedDaily: 500,
    maxPerMinute: 60,
    sourceNote: "Google: 500 recipients/day on personal accounts, rolling 24h.",
  },
  gmail_workspace: {
    tier: "gmail_workspace",
    provider: "gmail",
    label: "Google Workspace",
    documentedDaily: 2000,
    maxPerMinute: 60,
    sourceNote: "Google: 2,000 external recipients/day on Workspace.",
  },
  outlook_consumer: {
    tier: "outlook_consumer",
    provider: "outlook",
    label: "Outlook.com (personal)",
    documentedDaily: 300,
    maxPerMinute: 30,
    sourceNote: "Microsoft Graph: 300 messages/day on consumer Outlook.com.",
  },
  outlook_business: {
    tier: "outlook_business",
    provider: "outlook",
    label: "Microsoft 365 (work)",
    documentedDaily: 10000,
    maxPerMinute: 30,
    sourceNote: "Exchange Online: 10,000 recipients/day, 30 messages/minute.",
  },
};

/** Consumer mail domains — an address here is definitively NOT a work tenant. */
const GMAIL_CONSUMER = new Set(["gmail.com", "googlemail.com"]);
const OUTLOOK_CONSUMER = new Set([
  "outlook.com", "hotmail.com", "live.com", "msn.com", "passport.com",
]);

function domainOf(email: string | null | undefined): string {
  return (email ?? "").split("@")[1]?.trim().toLowerCase() ?? "";
}

/**
 * Detect the tier from the connected account address.
 *
 * This direction of inference is sound: a Gmail-API account sending from a
 * CUSTOM domain must be Workspace — a free account cannot. And an @gmail.com
 * address is never a Workspace primary. So both branches are load-bearing, not
 * guesses.
 *
 * Where it is genuinely unsure (no address yet), it returns the FLOOR for that
 * provider rather than the optimistic tier. Being wrong low costs a user some
 * patience; being wrong high costs them their account standing.
 */
export function detectTier(
  provider: UserSendProvider,
  accountEmail: string | null | undefined,
): ProviderTier {
  const domain = domainOf(accountEmail);
  if (provider === "gmail") {
    if (!domain) return "gmail_free";                    // floor when unsure
    return GMAIL_CONSUMER.has(domain) ? "gmail_free" : "gmail_workspace";
  }
  if (!domain) return "outlook_consumer";                // floor when unsure
  return OUTLOOK_CONSUMER.has(domain) ? "outlook_consumer" : "outlook_business";
}

/** Resolve limits, honouring a user's explicit override when they set one. */
export function resolveLimits(
  provider: UserSendProvider,
  accountEmail: string | null | undefined,
  override?: ProviderTier | null,
): ProviderLimits {
  // An override only counts if it belongs to the provider actually connected —
  // otherwise a stale "outlook_business" left over from a previous connection
  // would grant a free Gmail account a 10,000/day allowance.
  const detected = detectTier(provider, accountEmail);
  const tier = override && TIERS[override]?.provider === provider ? override : detected;
  const base = TIERS[tier];
  return { ...base, effectiveDaily: Math.floor(base.documentedDaily * SAFETY_MARGIN) };
}

/** Every tier a given provider can be set to — for the settings dropdown. */
export function tiersForProvider(provider: UserSendProvider): ProviderLimits[] {
  return Object.values(TIERS)
    .filter((t) => t.provider === provider)
    .map((t) => ({ ...t, effectiveDaily: Math.floor(t.documentedDaily * SAFETY_MARGIN) }));
}

/**
 * Split a recipient count into provider-sized parts.
 *
 * `remainingToday` is what the user has LEFT today, not their full allowance —
 * a user who already sent 400 of 425 gets a first part of 25, not 425. Parts
 * after the first assume a fresh day, which is what a resumed batch actually
 * gets when the worker picks it up tomorrow.
 */
export function planParts(
  totalRecipients: number,
  limits: ProviderLimits,
  remainingToday: number,
): { part: number; count: number; sameDay: boolean }[] {
  const parts: { part: number; count: number; sameDay: boolean }[] = [];
  let left = Math.max(0, totalRecipients);
  let n = 1;

  const first = Math.min(left, Math.max(0, remainingToday));
  if (first > 0) {
    parts.push({ part: n++, count: first, sameDay: true });
    left -= first;
  }
  while (left > 0) {
    const take = Math.min(left, limits.effectiveDaily);
    parts.push({ part: n++, count: take, sameDay: false });
    left -= take;
  }
  return parts;
}
