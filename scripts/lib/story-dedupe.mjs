/**
 * One story, many outlets. A single event reaches us as five or six articles
 * (Louisiana's Oct 2026 emergency rule came from WWL, WGNO, KTVE, NOLA, KATC
 * and WBRZ inside two days), so anything that notifies people has to collapse
 * them. Headlines whose significant words overlap >= 45% are one story.
 *
 * Shared by the email digest (send-email-notifications.mjs) and the state-news
 * push (push-state-news.mjs), which until 2026-10-23 pushed every outlet.
 */
const STOP = new Set("a an the of to in on for and or with by at from as is are was be over after into its their his her this that federal state".split(" "));

/** Significant words of a headline. A leading "Source: " label is ignored. */
export function headlineWords(title) {
  return new Set(
    String(title ?? "")
      .toLowerCase()
      .replace(/^[^a-z0-9]*[a-z]+:\s*/, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** Share of the shorter headline's words that the other one also has. */
export function headlineOverlap(a, b) {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.max(1, Math.min(a.size, b.size));
}

/** True when two headlines (as headlineWords sets) report the same story. */
export function sameStory(a, b) {
  return a.size >= 3 && headlineOverlap(a, b) >= 0.45;
}

/** Drop exact link/title repeats, then near-duplicate headlines. Keeps the first of each story. */
export function dedupeStories(items) {
  const seen = new Set(), kept = [];
  for (const n of items) {
    const k = n.link || n.title;
    if (seen.has(k)) continue;
    const w = headlineWords(n.title);
    if (kept.some((m) => sameStory(w, m.w))) continue;
    seen.add(k); kept.push({ ...n, w });
  }
  return kept;
}
