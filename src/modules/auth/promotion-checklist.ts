/**
 * What a member still has to finish before the Advocate Leader role can apply.
 * Pure, so the owner's refusal message, the member's invite notification and
 * the /leader/invite checklist all say the same thing in the same words.
 *
 * The rules themselves live in trust-tier.ts (verifyUserForPromotion); this
 * only turns its facts into plain language with a place to go fix each one.
 */

export const LEADER_MIN_AGE_HOURS = 48;

export type PromotionFacts = {
  emailConfirmed: boolean;
  ageHours: number;
  mfaEnrolled: boolean;
  profile: {
    full_name?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null;
};

export type ChecklistKey = "email" | "age" | "mfa" | "profile";

export type ChecklistItem = {
  key: ChecklistKey;
  done: boolean;
  /** What the member sees, written to them. */
  label: string;
  /** Short form for the owner's view of the same gap. */
  short: string;
  /** Where to go to finish it; null when only time can finish it. */
  href: string | null;
};

export function missingAddressParts(p: PromotionFacts["profile"]): string[] {
  const out: string[] = [];
  if (!p?.full_name?.trim()) out.push("full name");
  if (!p?.street?.trim()) out.push("street");
  if (!p?.city?.trim()) out.push("city");
  if (!p?.state?.trim()) out.push("state");
  if (!p?.zip?.trim()) out.push("ZIP");
  return out;
}

/** "a, b and c" */
export function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function promotionChecklist(f: PromotionFacts): ChecklistItem[] {
  const missingAddress = missingAddressParts(f.profile);
  const hoursLeft = Math.max(0, Math.ceil(LEADER_MIN_AGE_HOURS - f.ageHours));
  return [
    {
      key: "email",
      done: f.emailConfirmed,
      label: "Confirm your email address (use the link we emailed you)",
      short: "confirmed email",
      href: "/account",
    },
    {
      key: "mfa",
      done: f.mfaEnrolled,
      label: "Turn on two-step sign-in (2FA) so nobody else can use your account",
      short: "2FA",
      href: "/account/security",
    },
    {
      key: "profile",
      done: missingAddress.length === 0,
      label:
        missingAddress.length === 0
          ? "Add your full name and mailing address to your profile"
          : `Add your ${joinAnd(missingAddress)} to your profile`,
      short: missingAddress.length === 0 ? "name and address" : joinAnd(missingAddress),
      href: "/account#identity",
    },
    {
      key: "age",
      done: hoursLeft === 0,
      label:
        hoursLeft === 0
          ? "Have your account for two days"
          : `Have your account for two days (about ${hoursLeft} more ${hoursLeft === 1 ? "hour" : "hours"}, nothing to do)`,
      short: hoursLeft === 0 ? "account age" : `${hoursLeft}h until the account is 2 days old`,
      href: null,
    },
  ];
}

export function checklistDone(items: ChecklistItem[]): boolean {
  return items.every((i) => i.done);
}

/** The owner-facing line: "needs 2FA and street, city and ZIP". */
export function ownerMissingLine(items: ChecklistItem[]): string {
  const open = items.filter((i) => !i.done).map((i) => i.short);
  return open.length === 0 ? "nothing left" : `needs ${joinAnd(open)}`;
}

export const ADDRESS_PRIVACY_NOTE =
  "Your name and address stay private. Other members only ever see your @username. " +
  "Your address is used for one thing: signing your own letters to your own officials.";

/** The in-app notification a member gets when the owner invites them to lead. */
export function inviteNotificationBody(items: ChecklistItem[]): string {
  const open = items.filter((i) => !i.done);
  if (open.length === 0) {
    return "You're invited to be an Advocate Leader. Open this to accept.";
  }
  const steps = open.map((i, n) => `${n + 1}. ${i.label}.`).join(" ");
  return (
    `You're invited to be an Advocate Leader. To finish: ${steps} ` +
    `The role turns on by itself once these are done. ${ADDRESS_PRIVACY_NOTE}`
  );
}
