/**
 * Shared shape for /deadlines rows.
 *
 * Everything here is JSON-serialisable on purpose: the list is fetched in the
 * cached server render and handed across the server -> client boundary, so
 * `Date` objects (which don't survive the crossing) are stored as ISO strings
 * and the human-readable stamp is preformatted server-side.
 */
export type DeadlineItem = {
  id: string;
  kind: "alert" | "bill";
  title: string;
  locality: string | null;
  /**
   * 2-letter code used for the "state hub" chip and the filter-pill list.
   * Null for federal rows and for city-scoped alerts, exactly as before.
   */
  state: string | null;
  /**
   * Code used ONLY by the `?state=` filter. Mirrors the old server-side match
   * (`locality.eq.XX` OR `locality.ilike.'%, XX'`), so an alert localised as
   * "Ventura, CA" still shows under ?state=CA without gaining a CA hub chip.
   */
  filterState: string | null;
  /** ISO 8601 instant the comment window closes. */
  deadline: string;
  deadlineSource: "occurs_at" | "expires_at" | "local_meta_comment_deadline";
  /** Preformatted (America/New_York) so server HTML and client hydration agree. */
  deadlineLabel: string;
  link: string;
  /** First meaningful paragraph of the alert body, already trimmed. */
  excerpt: string | null;
};

/** A DeadlineItem with its deadline resolved to epoch ms for countdown maths. */
export type DatedDeadlineItem = DeadlineItem & { ms: number };
