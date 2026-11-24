/**
 * The weekly "Top 5" on /media (PJ, 2026-11-24): the five stories most worth
 * answering this week, and the month the leaderboard counts.
 *
 * A story qualifies when we found the writer's printed address
 * (press_contacts, kind reporter) and it was published in the last 7 days.
 * Ranked by the story's relevance score, newest first on a tie. Falls back to
 * the newest stories when fewer than five scored.
 */

export type BoardCandidate = {
  contactId: string;
  newsId: string;
  title: string;
  name: string | null;
  outlet: string | null;
  publishedAt: string | null;
  score: number | null;
};

const WEEK = 7 * 864e5;

export function pickTop5(rows: BoardCandidate[], now = Date.now()): BoardCandidate[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      const t = r.publishedAt ? Date.parse(r.publishedAt) : NaN;
      if (!Number.isFinite(t) || now - t > WEEK || t - now > 864e5) return false;
      if (seen.has(r.newsId)) return false;
      seen.add(r.newsId);
      return true;
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!))
    .slice(0, 5);
}

/** Midnight on the 1st of the current month in America/New_York, as an ISO instant (civic dates anchor to Eastern). */
export function monthStartEastern(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit" })
    .formatToParts(new Date(now));
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  // 05:00Z is midnight in EST; in EDT it reads 01:00, so midnight is 04:00Z.
  const est = new Date(`${y}-${m}-01T05:00:00Z`);
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(est);
  return (hour === "01" ? new Date(`${y}-${m}-01T04:00:00Z`) : est).toISOString();
}
