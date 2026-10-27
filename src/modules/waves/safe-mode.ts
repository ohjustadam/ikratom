import { findUseAdmissions, rewordUseAdmissions } from "@/lib/use-admission";
import { adaptForHiddenHome } from "@/modules/campaigns/templates";

/**
 * Banned-state safe mode (migration 0275) for coordinated waves.
 *
 * A campaign send shows the member their letter and lets them edit it. A wave
 * fires unattended, hours or days after they join, from the template snapshotted
 * when the wave was created. Nobody reads the letter first, so the two rules the
 * composer applies with the member watching are applied here with no one to ask:
 *
 *  - a letter to officials who don't represent the member names no home
 *    (adaptForHiddenHome, same as the campaign page and the one-click queue);
 *  - a line that says the member uses kratom now goes out in the past tense. If
 *    a line can't be reworded safely the copy is NOT sent: the composer warns
 *    and lets the member decide what they sign, but a wave has no member to ask.
 */

export type WaveLetter =
  | { ok: true; subject: string; body: string }
  | { ok: false; reason: "safe_mode_use_admission"; phrases: string[] };

export function waveLetter(
  tpl: { subject: string; body: string },
  opts: { safeMode: boolean; hideHome: boolean },
): WaveLetter {
  if (!opts.safeMode) return { ok: true, ...tpl };
  const adapt = (t: string) => rewordUseAdmissions(opts.hideHome ? adaptForHiddenHome(t) : t);
  const subject = adapt(tpl.subject);
  const body = adapt(tpl.body);
  const phrases = findUseAdmissions(`${subject}\n${body}`);
  return phrases.length > 0 ? { ok: false, reason: "safe_mode_use_admission", phrases } : { ok: true, subject, body };
}

/**
 * True when the letter goes to officials who don't represent the member. The
 * same test the campaign page runs (campaign state or locality differs from the
 * member's), plus the target's own state, because a wave built from explicit
 * official ids can mix states under a campaign with no state of its own.
 * Anything unclear errs toward hiding the home.
 */
export function hidesHomeFrom(a: {
  campaignState: string | null;
  campaignLocality: string | null;
  member: { state: string | null; city: string | null; county: string | null };
  targetState: string | null;
}): boolean {
  const { member } = a;
  if (!member.state) return false;
  if (a.campaignState && a.campaignState !== member.state) return true;
  if (a.targetState && a.targetState !== member.state) return true;
  if (a.campaignLocality) {
    const mine = [member.city, member.county]
      .filter(Boolean)
      .map((place) => `${place}, ${member.state}`.toLowerCase());
    if (!mine.includes(a.campaignLocality.toLowerCase())) return true;
  }
  return false;
}
