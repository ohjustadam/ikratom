/**
 * Turn the batch resolver's last outcome on a local-rep request into a plain
 * sentence for /admin/local-rep-requests, plus whether a human should step in.
 *
 * Reason codes are written by scripts/auto-fulfill-pending-local-reps.mjs from
 * findAndExtractOfficials (scripts/lib/officials-extract.mjs). Keep the two in
 * step — tests/local-rep-attempt.test.ts pins every code.
 */

export type AttemptReason =
  | "site-blocked"
  | "no-extract"
  | "no-gov-candidate"
  | "searxng-empty"
  | "no-officials";

export type AttemptNote = {
  text: string;
  /** True when retrying won't help — a person has to add the officials. */
  needsHuman: boolean;
};

export function describeLastAttempt(reason: string | null | undefined, detail?: string | null): AttemptNote | null {
  if (!reason) return null;
  const site = detail?.trim() || null;
  switch (reason) {
    case "site-blocked":
      return {
        text: `${site ?? "The official website"} blocks automated readers (bot check), so the batch can't read the council list. Retrying won't help — add the officials by hand.`,
        needsHuman: true,
      };
    case "no-extract":
    case "no-officials":
      return {
        text: `Read ${site ?? "the official website"} but couldn't pick out a list of officials. It retries every run; if it keeps failing, add them by hand.`,
        needsHuman: true,
      };
    case "no-gov-candidate":
      return {
        text: "Web search found no official city or county website. Add the officials by hand, or reject the request if this place has no local government.",
        needsHuman: true,
      };
    case "searxng-empty":
      return {
        text: "Web search returned nothing on the last run (usually a temporary search outage). It retries automatically.",
        needsHuman: false,
      };
    default:
      return { text: `Batch couldn't resolve it (${reason}). It retries every run.`, needsHuman: false };
  }
}

/** Prefilled hand-add form for one request's locality. */
export function handAddHref(state: string, locality: string, level: "municipal" | "county"): string {
  const q = new URLSearchParams({
    state,
    locality,
    role: level === "county" ? "county_commissioner" : "city_council",
  });
  return `/admin/locals/new?${q.toString()}`;
}
