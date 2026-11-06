import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SUMMARY_READY_FILTER,
  articleText,
  headlineSummary,
  summaryPlan,
} from "../scripts/lib/news-summary.mjs";

const source = (name: string) => readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8");

describe("summaryPlan — the AI only summarizes what it can read", () => {
  it("summarizes a story with article text, or with an excerpt alone", () => {
    expect(summaryPlan({ body_paragraphs: ["Lawmakers voted Tuesday."] })).toBe("ai");
    expect(summaryPlan({ body_paragraphs: null, body_extract_excerpt: "Lawmakers voted Tuesday." })).toBe("ai");
  });

  it("uses the headline once extraction has given up", () => {
    expect(summaryPlan({ body_paragraphs: null, body_extracted_at: "2026-11-06T12:00:00Z" })).toBe("headline");
  });

  it("waits while the text may still arrive, so a guess can't stick", () => {
    expect(summaryPlan({ body_paragraphs: null, body_extracted_at: null })).toBe("wait");
  });

  it("treats empty text as no text", () => {
    const empty = { body_paragraphs: [], body_extract_excerpt: "   " };
    expect(summaryPlan(empty)).toBe("wait");
    expect(summaryPlan({ ...empty, body_extracted_at: "2026-11-06T12:00:00Z" })).toBe("headline");
  });
});

describe("articleText", () => {
  it("prefers the paragraphs and caps what the prompt receives", () => {
    expect(articleText({ body_paragraphs: ["One.", "Two."], body_extract_excerpt: "Excerpt." })).toBe("One.\n\nTwo.");
    expect(articleText({ body_paragraphs: ["x".repeat(5000)] }).length).toBe(4000);
  });
});

describe("headlineSummary", () => {
  it("drops the publisher tail Google News adds", () => {
    expect(headlineSummary({ title: "Kratom banned in Idaho Falls - Idaho State Journal", source_name: "Idaho State Journal" }))
      .toBe("Kratom banned in Idaho Falls");
    expect(headlineSummary({ title: "Thousands of products removed - firstcoastnews.com", source_name: "FirstCoastNews.com" }))
      .toBe("Thousands of products removed");
  });

  it("keeps a headline whose dash is part of the headline", () => {
    const title = "Ascension: Three arrested - 650 products seized";
    expect(headlineSummary({ title, source_name: "WBRZ" })).toBe(title);
    expect(headlineSummary({ title, source_name: null })).toBe(title);
  });
});

describe("the jobs that write news_items.summary", () => {
  it("summarize-news no longer asks the AI to work from a headline", () => {
    expect(source("summarize-news.mjs")).not.toMatch(/based on the headline/i);
  });

  it("summarize-news selects every column its ready filter names", () => {
    const select = source("summarize-news.mjs").match(/\.select\("([^"]+)"\)/)?.[1] ?? "";
    const columns = SUMMARY_READY_FILTER.split(",").map((f) => f.split(".")[0]);
    expect(columns.length).toBe(3);
    for (const column of columns) expect(select).toContain(column);
  });

  it("enrich-news scores stories and never writes a summary", () => {
    const enrich = source("enrich-news.mjs");
    expect(enrich).not.toMatch(/parsed\.summary|summary\.is\.null|"summary":/);
    // A row with no summary must not hold a place in its queue forever.
    expect(enrich).toMatch(/\.or\("ai_relevance_score\.eq\.0\.5,ai_relevance_score\.is\.null"\)/);
  });
});
