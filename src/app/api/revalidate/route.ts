import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

/**
 * Cache-invalidation endpoint for the cron/script layer.
 *
 * WHY THIS EXISTS: sixteen surfaces call `unstable_cache(..., { tags: [...] })`
 * and, as of 2026-08-20, `revalidateTag` had ZERO call sites anywhere in src/.
 * Every tag was declared and none was ever fired, so a content change waited
 * out its TTL instead of publishing. Observed live: linking a news article to
 * the Massachusetts emergency alert took ten minutes to appear on
 * /alerts/[id], purely because that page caches for 600s. During an emergency
 * with a hard deadline, "published in up to ten minutes" is not published.
 *
 * The pipeline that mutates this data (sync-news-rss, classify-news-policy,
 * push-critical-alerts, the seeders) runs as standalone node scripts OUTSIDE
 * the Next runtime, where `revalidateTag` does not exist. An authenticated HTTP
 * endpoint is the only way for them to reach it.
 *
 * Auth: the same `Bearer $CRON_SECRET` the /api/cron/* routes use. Note those
 * routes are reachable at the Netlify origin (ikratom.netlify.app/api/cron/*)
 * because Cloudflare Bot Fight Mode challenges GitHub's datacenter IPs — this
 * route sits under /api/revalidate and is NOT in that passthrough, so callers
 * from CI should use the origin host only if it is added there deliberately.
 *
 * Tags are ALLOWLISTED. An open endpoint would let anyone who learned the
 * secret stampede every cache on the site; the allowlist bounds the blast
 * radius to surfaces we actually invalidate, and makes a typo fail loudly
 * instead of silently doing nothing.
 *
 * Usage:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     "$APP_URL/api/revalidate?tag=alert-detail"
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Every static tag declared via unstable_cache in src/. Keep in sync. */
const ALLOWED_TAGS = new Set([
  "alert-detail",
  "bill-detail",
  "bills-index-snapshot",
  "calendar-events",
  "campaigns-index",
  "editable-content",
  "emergency-banner",
  "intel-operation",
  "meeting-detail",
  "news-detail",
  "research-library",
  "research-paper",
  "state-hub",
  "state-index-stats",
  "status-snapshot",
]);

/** `similar-bills:<uuid>` is the one parameterised tag family in use. */
const DYNAMIC_TAG = /^similar-bills:[0-9a-f-]{36}$/i;

function isAllowed(tag: string): boolean {
  return ALLOWED_TAGS.has(tag) || DYNAMIC_TAG.test(tag);
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  // Missing CRON_SECRET must fail closed, not open — an unset env var would
  // otherwise make `Bearer undefined` the valid password.
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  // Accept repeated ?tag= so one call can flush a related set.
  const requested = url.searchParams.getAll("tag").flatMap((t) =>
    t.split(",").map((s) => s.trim()).filter(Boolean),
  );

  if (requested.length === 0) {
    return NextResponse.json({ error: "no tag supplied" }, { status: 400 });
  }
  if (requested.length > 20) {
    return NextResponse.json({ error: "too many tags (max 20)" }, { status: 400 });
  }

  const revalidated: string[] = [];
  const rejected: string[] = [];

  for (const tag of requested) {
    if (!isAllowed(tag)) {
      rejected.push(tag);
      continue;
    }
    // Next 16 requires a cache-life profile as the second argument (the 1-arg
    // form is Next 15 and no longer typechecks). "max" is what the Next docs
    // recommend for on-demand invalidation — stale-while-revalidate, so the
    // next visitor gets the cached copy instantly while the refresh happens
    // behind them, rather than eating the full uncached render.
    revalidateTag(tag, "max");
    revalidated.push(tag);
  }

  // 400 when NOTHING matched — a caller flushing only typo'd tags should see a
  // failure rather than a cheerful 200 that invalidated nothing.
  const status = revalidated.length === 0 ? 400 : 200;
  return NextResponse.json({ ok: revalidated.length > 0, revalidated, rejected }, { status });
}
