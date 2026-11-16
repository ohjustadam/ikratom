// scripts/lib/news-summary.mjs
//
// What goes in news_items.summary. An AI summary is only worth showing when the
// AI read the article. Given a headline alone it guessed, and the guesses went
// public: "North Carolina Governor Roy Cooper, referred to as Stein", "A KHOU
// news article from New Jersey", and claims about what an unread article said
// (31 of 32 no-text stories checked on 2026-11-06). So:
//
//   * article text in hand       -> the AI summarizes it;
//   * extraction gave up, no text -> the headline, with no AI involved;
//   * extraction still running   -> wait. The text may yet arrive, and a summary
//     written now would stick, because the job only fills empty summaries.
//
// Waiting hides nothing: every feed lists only stories with body_extracted_at.

/** PostgREST or() filter for the stories the summary job can act on now. */
export const SUMMARY_READY_FILTER =
  "body_extracted_at.not.is.null,body_paragraphs.not.is.null,body_extract_excerpt.not.is.null";

/**
 * The article text we hold, capped for the prompt. Empty when there is none.
 * @param {{ body_paragraphs?: string[] | null, body_extract_excerpt?: string | null }} item
 * @returns {string}
 */
export function articleText({ body_paragraphs, body_extract_excerpt }) {
  const text = Array.isArray(body_paragraphs) && body_paragraphs.length
    ? body_paragraphs.join("\n\n")
    : body_extract_excerpt ?? "";
  return text.trim().slice(0, 4000);
}

/**
 * @param {{ body_paragraphs?: string[] | null, body_extract_excerpt?: string | null, body_extracted_at?: string | null }} item
 * @returns {"ai" | "headline" | "wait"}
 */
export function summaryPlan(item) {
  if (articleText(item)) return "ai";
  return item.body_extracted_at ? "headline" : "wait";
}

/** The headline, without the " - Publisher" tail Google News adds to it. */
export function headlineSummary({ title, source_name }) {
  const headline = String(title ?? "").trim();
  const tail = ` - ${source_name ?? ""}`.toLowerCase();
  return source_name && headline.toLowerCase().endsWith(tail)
    ? headline.slice(0, -tail.length).trim()
    : headline;
}
