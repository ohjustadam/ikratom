import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  BLOCKED_RESOLVED_HOSTS,
  isUsableResolvedUrl,
  keeperSortKey,
  newsIdsInLink,
  planResolvedDedupe,
  rewriteNewsLink,
} from "../scripts/lib/news-resolved-url.mjs";

/**
 * News twins (audit 2026-11-24): one story under several Google News URLs,
 * collapsing only after resolve-news-urls fills resolved_url. Migration 0330
 * links new twins in the database; scripts/dedupe-news-resolved.mjs clears the
 * old ones. The live trigger proof is tests/sql/news-resolved-twin.sql.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/0330_news_resolved_twin_link.sql");

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";

type Row = {
  id: string; resolved_url: string | null; duplicate_of: string | null; active: boolean;
  scraped_at: string | null; body_extracted_at: string | null; policy_alert_id: string | null;
  auto_pushed_at: string | null;
};
const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  resolved_url: "https://example.com/story",
  duplicate_of: null,
  active: true,
  scraped_at: "2026-11-01T00:00:00Z",
  body_extracted_at: "2026-11-01T01:00:00Z",
  policy_alert_id: null,
  auto_pushed_at: null,
  ...over,
});

describe("isUsableResolvedUrl", () => {
  it("accepts a publisher URL", () => {
    expect(isUsableResolvedUrl("https://www.unionleader.com/news/politics/x")).toBe(true);
    expect(isUsableResolvedUrl("http://kwch.com/2026/11/01/kratom/")).toBe(true);
  });
  it("treats error pages and redirects as not resolved", () => {
    for (const u of [
      "chrome-error://chromewebdata/",
      "about:blank",
      "data:text/html,hi",
      "javascript:void(0)",
      "https://news.google.com/rss/articles/CBMiabc",
      "https://consent.google.com/ml?continue=x",
      "https://www.google.com/sorry/index?continue=x",
      "https://errors.edgesuite.net/18.abc",
      "http://localhost/x",
      "https://www.intranet/x",
      "not a url",
      "",
      null,
      undefined,
    ]) expect(isUsableResolvedUrl(u), String(u)).toBe(false);
  });
  it("keeps the database rule (0330) on the same hosts", () => {
    const sqlHosts = migration.match(/h\.host not in \(([^)]+)\)/)?.[1]
      .split(",").map((s) => s.trim().replace(/'/g, "")) ?? [];
    expect(sqlHosts.sort()).toEqual([...BLOCKED_RESOLVED_HOSTS].sort());
    expect(migration).toMatch(/google\\\.com\/sorry/);
    expect(migration).toMatch(/\^https\?:\/\//);
  });
});

describe("migration 0330", () => {
  it("guards every write of resolved_url, before the insert dedupe runs", () => {
    expect(migration).toMatch(/create trigger trg_news_items_clean_resolved_url\s+before insert or update of resolved_url/);
    // BEFORE triggers fire in name order: the guard must sort first.
    expect("trg_news_items_clean_resolved_url" < "trg_news_items_dedup").toBe(true);
  });
  it("links twins with a real UPDATE of duplicate_of, so duplicate_count follows", () => {
    expect(migration).toMatch(/create trigger trg_news_items_link_resolved_twin\s+after update of resolved_url/);
    expect(migration).toMatch(/update public\.news_items\s+set duplicate_of = v_canonical/);
    expect(migration).toMatch(/order by active desc, scraped_at asc, id asc/);
  });
  it("folds duplicates of a row that stops being canonical", () => {
    expect(migration).toMatch(/after update of duplicate_of/);
    expect(migration).toMatch(/old\.duplicate_of is null and new\.duplicate_of is not null/);
  });
  it("keeps the trigger functions away from clients", () => {
    for (const fn of ["news_items_clean_resolved_url", "news_items_link_resolved_twin", "news_items_fold_duplicate_children"]) {
      expect(migration).toContain(`revoke execute on function public.${fn}() from public, anon, authenticated`);
    }
  });
  it("deletes nothing", () => {
    expect(migration).not.toMatch(/^\s*delete\s/im);
    expect(migration).not.toMatch(/^\s*(drop table|truncate)/im);
  });
});

describe("resolve-news-urls", () => {
  const src = read("scripts/resolve-news-urls.mjs");
  it("never stores an unusable URL", () => {
    expect(src).toMatch(/import \{ isUsableResolvedUrl \}/);
    expect(src).toMatch(/res\.ok && !isUsableResolvedUrl\(res\.url\)/);
    expect(src).toMatch(/permanent: false/);
  });
});

describe("keeper choice", () => {
  it("prefers an active row over an older inactive one", () => {
    const plan = planResolvedDedupe([
      row(A, { active: false, scraped_at: "2026-01-01T00:00:00Z" }),
      row(B),
    ]);
    expect(plan.groups[0].keeper).toBe(B);
    expect(plan.deleteIds).toEqual([A]);
  });
  it("prefers the row with the article text over a referenced one without", () => {
    const plan = planResolvedDedupe([
      row(A, { body_extracted_at: null, auto_pushed_at: "2026-11-02T00:00:00Z" }),
      row(B),
    ]);
    expect(plan.groups[0].keeper).toBe(B);
  });
  it("prefers a referenced row, then the canonical, then the oldest", () => {
    const refs = new Map([[C, 2]]);
    expect(planResolvedDedupe([row(A), row(C, { scraped_at: "2026-11-05T00:00:00Z" })], refs).groups[0].keeper).toBe(C);
    expect(planResolvedDedupe([row(A, { duplicate_of: B }), row(B, { scraped_at: "2026-11-09T00:00:00Z" })]).groups[0].keeper).toBe(B);
    expect(planResolvedDedupe([row(B, { scraped_at: "2026-11-09T00:00:00Z" }), row(A)]).groups[0].keeper).toBe(A);
  });
  it("sorts deterministically on id when everything else ties", () => {
    expect(keeperSortKey(row(A)).at(-1)).toBe(A);
    expect(planResolvedDedupe([row(B), row(A)]).groups[0].keeper).toBe(A);
  });
});

describe("planResolvedDedupe", () => {
  it("leaves singletons, empty and unusable URLs alone", () => {
    const err = "chrome-error://chromewebdata/";
    const plan = planResolvedDedupe([
      row(A, { resolved_url: err }),
      row(B, { resolved_url: err }),
      row(C, { resolved_url: null }),
      row(D, { resolved_url: "https://example.com/only-once" }),
    ]);
    expect(plan.groups).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.skippedUnusable).toBe(2);
  });
  it("moves a twin's alert to a keeper that has none", () => {
    const plan = planResolvedDedupe([row(A), row(B, { policy_alert_id: "alert-1", body_extracted_at: null })]);
    expect(plan.groups[0].keeper).toBe(A);
    expect(plan.alertMoves).toEqual([{ keeper: A, from: B, policy_alert_id: "alert-1" }]);
    expect(plan.deleteIds).toEqual([B]);
  });
  it("holds back a twin tied to a different alert instead of deleting it", () => {
    const plan = planResolvedDedupe([
      row(A, { policy_alert_id: "alert-1" }),
      row(B, { policy_alert_id: "alert-2", scraped_at: "2026-11-03T00:00:00Z" }),
      row(C, { policy_alert_id: "alert-1", scraped_at: "2026-11-04T00:00:00Z" }),
    ]);
    expect(plan.groups[0]).toMatchObject({ keeper: A, losers: [C], held: [B] });
    expect(plan.holdIds).toEqual([B]);
    expect(plan.deleteIds).toEqual([C]);
    expect(plan.loserToKeeper.get(C)).toBe(A);
    expect(plan.loserToKeeper.has(B)).toBe(false);
  });
});

describe("notification links", () => {
  const map = new Map([[B, A]]);
  it("rewrites a twin's /news link to the keeper", () => {
    expect(rewriteNewsLink(`/news/${B}?from=push`, map)).toBe(`/news/${A}?from=push`);
    expect(rewriteNewsLink(`https://www.ikratom.org/news/${B.toUpperCase()}`, map)).toBe(`https://www.ikratom.org/news/${A}`);
  });
  it("returns null when nothing changes", () => {
    expect(rewriteNewsLink(`/news/${C}`, map)).toBeNull();
    expect(rewriteNewsLink("/bills/x", map)).toBeNull();
    expect(rewriteNewsLink(null, map)).toBeNull();
  });
  it("lists the news ids in a link", () => {
    expect(newsIdsInLink(`/news/${A} and /news/${B}`)).toEqual([A, B]);
    expect(newsIdsInLink(undefined)).toEqual([]);
  });
});
