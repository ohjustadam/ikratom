/**
 * seat-turnover.ts — what a profile says about a seat that is on the ballot
 * or changing hands (the officials-turnover engine, migration 0277).
 *
 * Pure, so the copy for every ledger state is pinned by
 * tests/seat-turnover.test.ts. Facts only: a seat on the ballot, who won it,
 * the day the term changes hands. No outlook, no labels, nothing about
 * parties: the platform is nonpartisan.
 */

export type SeatElection = {
  election_date: string;
  kind: "regular" | "special";
  status: "on_ballot" | "needs_review" | "incumbent_reelected" | "successor_elected" | "swapped" | "cancelled";
  handover_date: string | null;
  winner_name: string | null;
};

export type SeatBanner = { tone: "ballot" | "leaving" | "reelected"; title: string; detail: string };

/** Today in Eastern time as an ISO day — civic dates anchor to America/New_York. */
export function todayEastern(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** "2026-11-18" → "November 18, 2026". The value is a calendar day, so format it in UTC. */
export function longDate(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const REELECTED_SHOWN_DAYS = 60;

export function seatBanner(seat: SeatElection | null | undefined, officialName: string, today: string): SeatBanner | null {
  if (!seat) return null;
  const election = longDate(seat.election_date);
  const handover = seat.handover_date ? longDate(seat.handover_date) : null;

  if (seat.status === "successor_elected") {
    if (seat.handover_date && seat.handover_date < today) return null; // the swap job takes it from here
    return {
      tone: "leaving",
      title: handover ? `Leaving office on ${handover}` : "Leaving office",
      detail: `${seat.winner_name ?? "A successor"} won this seat on ${election}. ${officialName} is still in office and can be contacted until then.`,
    };
  }
  if (seat.status === "incumbent_reelected") {
    const shownUntil = new Date(Date.parse(`${seat.election_date}T00:00:00Z`) + REELECTED_SHOWN_DAYS * 86_400_000).toISOString().slice(0, 10);
    if (today > shownUntil) return null;
    return { tone: "reelected", title: `Re-elected on ${election}`, detail: handover ? `The new term begins ${handover}.` : "The new term begins once the result is certified." };
  }
  if (seat.status !== "on_ballot" && seat.status !== "needs_review") return null;

  if (today > seat.election_date) {
    return { tone: "ballot", title: `Results pending for the ${election} election`, detail: `${officialName} remains in office until the winner takes office.` };
  }
  if (seat.kind === "special") {
    return { tone: "ballot", title: `A special election for this seat is on the ${election} ballot`, detail: "The winner takes office once the result is certified." };
  }
  return {
    tone: "ballot",
    title: `This seat is on the ${election} ballot`,
    detail: handover ? `The winner takes office ${handover}. ${officialName} serves until then.` : `${officialName} serves until the winner takes office.`,
  };
}
