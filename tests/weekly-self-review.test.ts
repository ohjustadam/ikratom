import { describe, it, expect } from "vitest";
import {
  redact,
  summarise,
  findDecay,
  findMovement,
  parseNarrative,
  renderMarkdown,
} from "../scripts/lib/self-review.mjs";

/**
 * The weekly self-review's whole value is its judgement about decay, and
 * judgement that only runs against the production database is judgement nobody
 * can check. These run the classifier over hand-built histories instead.
 *
 * The case that matters most is `quiet`: a source that runs exactly on
 * schedule and writes nothing. check-cron-staleness compares finished_at
 * against a cadence, so that source reads as perfectly healthy to it while its
 * data goes stale. If this test ever stops asserting that, the review has lost
 * the one thing the existing monitoring cannot do.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-18T00:00:00Z");
const WINDOW_START = NOW - 7 * DAY;

const REGISTRY = [
  { source: "sync_news_rss", interval_hours: 4, system: "gh-hourly", cadence: "every-2h" },
  { source: "sync_donors", interval_hours: 48, system: "gh-daily", cadence: "daily" },
  { source: "sync_nonprofit_990s", interval_hours: 216, system: "gh-weekly", cadence: "weekly" },
];

/** n runs spread through a window, each writing `rows` rows. */
function runs(source: string, n: number, opts: { rows?: number; status?: string; ageDays: number; error?: string }) {
  return Array.from({ length: n }, (_, i) => ({
    source,
    status: opts.status ?? (opts.rows ? "success" : "empty"),
    started_at: new Date(NOW - opts.ageDays * DAY - i * 3600_000).toISOString(),
    rows_added: opts.rows ?? 0,
    rows_updated: 0,
    error_message: opts.error ?? null,
  }));
}

/** The classifier is plain JS, so give its output a shape TS can read. */
type Signal = Record<string, string | number | undefined>;
type Decay = { silent: Signal[]; failing: Signal[]; quiet: Signal[]; shrinking: Signal[]; unregistered: Signal[] };

function classify(rows: unknown[]) {
  const { cur, prev } = summarise(rows, { windowStartMs: WINDOW_START });
  return { cur, prev, decay: findDecay(cur, prev, { registry: REGISTRY, windowDays: 7 }) as Decay };
}

describe("weekly self-review — decay classifier", () => {
  it("flags a source that runs on schedule but has stopped producing rows", () => {
    const { decay } = classify([
      ...runs("sync_news_rss", 12, { rows: 0, ageDays: 2 }), // this week: healthy-looking, empty
      ...runs("sync_news_rss", 12, { rows: 40, ageDays: 9 }), // last week: producing
    ]);
    expect(decay.quiet).toEqual([{ source: "sync_news_rss", runs: 12, priorRows: 480 }]);
    // and it must NOT be reported as silent — it ran, which is exactly why the
    // staleness pager is blind to it.
    expect(decay.silent).toEqual([]);
  });

  it("does not flag a source that was always empty (nothing decayed)", () => {
    const { decay } = classify([
      ...runs("sync_news_rss", 12, { rows: 0, ageDays: 2 }),
      ...runs("sync_news_rss", 12, { rows: 0, ageDays: 9 }),
    ]);
    expect(decay.quiet).toEqual([]);
  });

  it("needs at least three runs before calling a source quietly empty", () => {
    const { decay } = classify([
      ...runs("sync_news_rss", 2, { rows: 0, ageDays: 2 }),
      ...runs("sync_news_rss", 8, { rows: 30, ageDays: 9 }),
    ]);
    expect(decay.quiet).toEqual([]);
  });

  it("flags a source that stopped running, but only when its cadence fits the window", () => {
    const { decay } = classify([
      ...runs("sync_donors", 6, { rows: 10, ageDays: 9 }), // daily source, silent this week
      ...runs("sync_nonprofit_990s", 1, { rows: 10, ageDays: 9 }), // weekly source, legitimately absent
    ]);
    expect(decay.silent).toEqual([{ source: "sync_donors", priorRuns: 6 }]);
  });

  it("flags a rising failure rate and redacts the error it quotes", () => {
    const { decay } = classify([
      ...runs("sync_donors", 4, { status: "error", ageDays: 2, error: "auth failed for admin@example.com" }),
      ...runs("sync_donors", 4, { rows: 5, ageDays: 2 }),
      ...runs("sync_donors", 8, { rows: 5, ageDays: 9 }),
    ]);
    expect(decay.failing).toHaveLength(1);
    expect(decay.failing[0]).toMatchObject({ source: "sync_donors", errors: 4, runs: 8, priorErrors: 0 });
    expect(decay.failing[0].lastError).toBe("auth failed for [email]");
  });

  it("flags a large output drop separately from a total stop", () => {
    const { decay } = classify([
      ...runs("sync_donors", 4, { rows: 1, ageDays: 2 }), // 4 rows
      ...runs("sync_donors", 4, { rows: 25, ageDays: 9 }), // 100 rows
    ]);
    expect(decay.shrinking).toEqual([{ source: "sync_donors", rows: 4, priorRows: 100 }]);
    expect(decay.quiet).toEqual([]);
  });

  it("names a source that writes telemetry but is in no registry", () => {
    const { decay } = classify(runs("some_new_job", 3, { rows: 7, ageDays: 2 }));
    expect(decay.unregistered).toEqual([{ source: "some_new_job", runs: 3 }]);
  });

  it("reports a clean week as clean", () => {
    const { decay } = classify([
      ...runs("sync_news_rss", 12, { rows: 40, ageDays: 2 }),
      ...runs("sync_news_rss", 12, { rows: 40, ageDays: 9 }),
    ]);
    expect(decay).toMatchObject({ silent: [], failing: [], quiet: [], shrinking: [], unregistered: [] });
  });
});

describe("weekly self-review — movement", () => {
  it("totals both windows and names sources seen for the first time", () => {
    const { cur, prev } = summarise(
      [...runs("sync_news_rss", 2, { rows: 10, ageDays: 1 }), ...runs("sync_donors", 2, { rows: 5, ageDays: 9 })],
      { windowStartMs: WINDOW_START },
    );
    const m = findMovement(cur, prev);
    expect(m.totals).toMatchObject({ sources: 1, runs: 2, rows: 20, priorRuns: 2, priorRows: 10 });
    expect(m.fresh).toEqual(["sync_news_rss"]);
    expect(m.top[0]).toEqual({ source: "sync_news_rss", rows: 20, priorRows: 0 });
  });
});

describe("weekly self-review — redaction", () => {
  it("removes things shaped like credentials from public output", () => {
    expect(redact("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6")).toContain("[redacted-jwt]");
    expect(redact("key gsk_abcdefghijklmnop rejected")).toContain("[redacted-key]");
    expect(redact("GET https://x.test/v1?api_key=supersecretvalue")).toContain("api_key=[redacted]");
    expect(redact("owner adam@ikratom.org not found")).toBe("owner [email] not found");
  });

  it("caps length so an upstream stack trace cannot become the review", () => {
    expect(redact("x".repeat(9000)).length).toBe(160);
  });
});

describe("weekly self-review — narrative handling", () => {
  const good = {
    moved: "News intake ran 84 times.",
    decayed: "Donor sync went quiet.",
    proposals: [{ action: "Check the donor sync.", because: "It wrote nothing for seven days." }],
  };

  it("accepts a well-shaped answer and strips markup from it", () => {
    const n = parseNarrative({ ...good, moved: "News `intake` ran <b>84</b> times." }, "groq");
    expect(n.moved).toBe("News intake ran b84/b times.");
    expect(n.proposals).toHaveLength(1);
    expect(n.provider).toBe("groq");
  });

  it("treats a wrong-shaped answer as no answer at all", () => {
    expect(() => parseNarrative({ summary: "all good" }, "mistral")).toThrow(/unusable shape/);
    expect(() => parseNarrative({ ...good, proposals: [] }, "mistral")).toThrow(/unusable shape/);
    expect(() => parseNarrative(null, "mistral")).toThrow(/unusable shape/);
  });

  it("caps the number of proposals", () => {
    const many = { ...good, proposals: Array.from({ length: 9 }, () => good.proposals[0]) };
    expect(parseNarrative(many, "groq").proposals).toHaveLength(5);
  });
});

describe("weekly self-review — rendering", () => {
  const evidence = {
    window_days: 7,
    movement: {
      top: [{ source: "sync_news_rss", rows: 480, priorRows: 500 }],
      fresh: [],
      totals: { sources: 1, runs: 12, errors: 0, rows: 480, priorRuns: 12, priorRows: 500 },
    },
    decay: {
      silent: [],
      failing: [],
      quiet: [{ source: "sync_donors", runs: 7, priorRows: 90 }],
      shrinking: [],
      unregistered: [],
    },
    admin_actions: { total: 3, byAction: [["campaign_created", 3]] as [string, number][] },
    merged_to_main: ["release: one merge window"],
  };

  it("publishes the evidence and says why, when no provider answered", () => {
    const md = renderMarkdown({
      evidence,
      narrative: null,
      degraded: "all providers 429",
      windowStartMs: WINDOW_START,
      nowMs: NOW,
    });
    expect(md).toContain("The judgement half of this review is missing");
    expect(md).toContain("all providers 429");
    // The degrade path must still carry the facts, or a busy week of
    // telemetry is lost because a free vendor was throttling.
    expect(md).toContain("sync_donors");
    expect(md).toContain("ran 7 times and wrote nothing");
    expect(md).toContain("campaign_created");
    expect(md).toContain("release: one merge window");
  });

  it("renders the proposals when a provider did answer", () => {
    const md = renderMarkdown({
      evidence,
      narrative: {
        moved: "Steady week.",
        decayed: "Donor sync stopped writing.",
        proposals: [{ action: "Look at the donor sync.", because: "It wrote nothing for seven days." }],
        provider: "groq",
      },
      degraded: null,
      windowStartMs: WINDOW_START,
      nowMs: NOW,
    });
    expect(md).toContain("### What I would do next");
    expect(md).toContain("1. **Look at the donor sync.** It wrote nothing for seven days.");
    expect(md).not.toContain("judgement half");
  });

  it("dates the review by its window", () => {
    const md = renderMarkdown({ evidence, narrative: null, degraded: "x", windowStartMs: WINDOW_START, nowMs: NOW });
    expect(md).toContain("2026-09-11 to 2026-09-18");
  });
});
