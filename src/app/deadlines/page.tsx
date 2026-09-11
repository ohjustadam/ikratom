import { Suspense } from "react";
import { createAnonClient } from "@/lib/supabase/anon";
import { DeadlineSummary } from "./DeadlineSummary";
import { DeadlinesView } from "./DeadlinesView";
import type { DeadlineItem } from "./types";

export const metadata = {
  title: "Comment deadline radar — every public-input window we know about",
  description: "Every state BoP rule, federal DEA scheduling proposal, and city ordinance currently accepting public comment, with countdown timers. The intel lobbyists already have.",
};

/**
 * /deadlines — public-comment deadline radar.
 *
 * Mission lever: regulatory-affairs lobbyists pay for subscriptions
 * that surface every state BoP rule, federal DEA proposal, and city
 * ordinance with its public-comment window + deadline. Advocates
 * typically find out 24 hours before close (or after).
 *
 * This page aggregates every alert with an occurs_at OR expires_at
 * AND every bill with local_meta.public_comment_deadline. Sorted by
 * urgency. Color-coded by remaining time.
 *
 * Three buckets:
 *   🔴 < 7 days  — act now
 *   🟡 7-30 days — calendar
 *   🟢 > 30 days — monitor
 *
 * Each row links to the alert/bill detail page, where signed-in users get the
 * one-click draft flow. Nothing on THIS page is per-viewer.
 */

/**
 * ISR — was `force-dynamic`.
 *
 * WHY (2026-09-10 egress emergency). Three things forced a per-request render:
 * the cookie-bound `@/lib/supabase/server` client (a cookie read alone opts a
 * route out of caching), the `?state=` searchParams read, and an explicit
 * `force-dynamic`. All three are gone: the data is public reference data, so it
 * now goes through `createAnonClient()` (verified same row counts as service
 * role for both queries below), and the state narrow moved client-side.
 *
 * Two wins, not one. Supabase's free plan does not bill for egress overage — it
 * RESTRICTS the project, and 99.97% of hits on this class of page are crawlers
 * that were each re-running both queries. And a prerendered page is a file on
 * the CDN: it keeps serving through an outage that would 500 a dynamic route.
 *
 * The queries also got narrower. Alerts are now windowed in SQL instead of
 * pulling an arbitrary unordered 200 rows and discarding almost all of them
 * (measured: 200 rows -> 1), and bills filter on the JSON key itself
 * (44 rows / 22.9 KB -> 1 row).
 */
/**
 * ⚠ FROZEN WINDOW — RESTORE TO 1800 ON 2026-09-16. ⚠
 *
 * Supabase free-tier egress was over the 5 GB cap with the cycle resetting
 * 09-16, and exceeding it RESTRICTS the project (the API stops answering; the
 * site goes down). ISR is lazy — a cached page only re-renders when a request
 * arrives after its window — so the window IS the per-page cost ceiling.
 * Stretching it past the reset means this page renders at most once more for
 * the rest of the cycle and then costs nothing at all.
 *
 * Staleness is survivable here specifically because the countdowns are NOT
 * baked into the cached HTML: `useVisibleDeadlines` re-buckets against the
 * browser's clock and drops anything that has since closed, so a week-old page
 * never tells an advocate they have three days left on a window that shut.
 * What a frozen window can cost is a brand-new deadline appearing late — and
 * the cron fleet that discovers them is already deferred by the egress gate, so
 * there is little new to miss. On-demand revalidation still works if something
 * genuinely urgent needs to publish.
 *
 * tests/egress-freeze-expiry.test.ts turns red after 2026-09-16 so this reverts
 * on evidence rather than on someone remembering.
 */
export const revalidate = 604800; // 7d — frozen; normal is 1800

/**
 * How far past the render clock the server fetches. Deliberately WIDER than the
 * 90 days the client displays: the cached HTML can be up to a week old, and a
 * viewer's live 90-day horizon reaches further than the render-time one did.
 */
const HORIZON_MS = 120 * 86_400_000;
/** Small look-back so date-only / offset-bearing values don't fall off the edge. */
const LOOKBACK_MS = 86_400_000;

/**
 * Civic dates anchor to Eastern, and formatting server-side keeps the string
 * byte-identical between the prerender and hydration (a viewer-local format
 * would mismatch). Previously this rendered in the Netlify runtime's UTC.
 */
const DEADLINE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

type AlertRow = {
  id: string;
  title: string;
  body: string | null;
  locality: string | null;
  occurs_at: string | null;
  expires_at: string | null;
};

type BillRow = {
  id: string;
  state: string;
  bill_number: string;
  title: string | null;
  locality: string | null;
  local_meta: { public_comment_deadline?: string } | null;
};

/** First non-empty paragraph, minus any leading **Bold label**: prefix. */
function excerptOf(body: string | null): string | null {
  const para = body?.split(/\n+/).find((p) => p.trim().length > 0);
  return para ? para.replace(/^\*\*[^*]+\*\*:?\s*/, "").slice(0, 400) : null;
}

/**
 * `state` drives the hub chip and the pill list (exact 2-letter locality only,
 * as before). `filterState` reproduces the old server-side `?state=` match,
 * which also accepted a trailing ", XX" — so "Ventura, CA" keeps filtering
 * under CA without gaining a CA hub chip it never had.
 */
function codesFor(locality: string | null) {
  const exact = /^[A-Z]{2}$/.test(locality ?? "") ? locality : null;
  const suffix = locality?.match(/,\s*([A-Za-z]{2})$/)?.[1]?.toUpperCase() ?? null;
  return { state: exact, filterState: exact ?? suffix };
}

export default async function DeadlinesPage() {
  const supabase = createAnonClient();
  const renderedAt = Date.now();
  const fromMs = renderedAt - LOOKBACK_MS;
  const toMs = renderedAt + HORIZON_MS;
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const inWindow = (ms: number) => Number.isFinite(ms) && ms >= fromMs && ms <= toMs;

  const [alertsRes, billsRes] = await Promise.all([
    // Alerts whose comment window closes inside the horizon. The window is
    // applied in SQL now — this used to pull 200 arbitrary rows (body column
    // included) and throw nearly all of them away in JS.
    supabase
      .from("policy_alerts")
      .select("id, title, body, locality, occurs_at, expires_at")
      .eq("moderation_status", "approved")
      .in("severity", ["critical", "alert"])
      .or(
        `and(expires_at.gte.${fromIso},expires_at.lte.${toIso}),` +
        `and(occurs_at.gte.${fromIso},occurs_at.lte.${toIso})`,
      )
      .limit(200),
    // Bills carrying an explicit public-comment deadline. Filtering on the JSON
    // key drops this from 44 rows to the handful that actually have one; the
    // date comparison stays in JS because the stored value is a free-form
    // string and lexical text comparison would be a silent-drop hazard.
    supabase
      .from("bills")
      .select("id, state, bill_number, title, locality, local_meta")
      .eq("active", true)
      .not("local_meta->>public_comment_deadline", "is", null)
      .limit(200),
  ]);

  const items: DeadlineItem[] = [];

  for (const a of (alertsRes.data ?? []) as unknown as AlertRow[]) {
    const expires = a.expires_at ? Date.parse(a.expires_at) : NaN;
    const occurs = a.occurs_at ? Date.parse(a.occurs_at) : NaN;
    // Prefer expires_at (explicit deadline); fall back to occurs_at.
    const picked = inWindow(expires)
      ? { ms: expires, source: "expires_at" as const }
      : inWindow(occurs)
        ? { ms: occurs, source: "occurs_at" as const }
        : null;
    if (!picked) continue;
    items.push({
      id: `alert-${a.id}`,
      kind: "alert",
      title: a.title,
      locality: a.locality,
      ...codesFor(a.locality),
      deadline: new Date(picked.ms).toISOString(),
      deadlineSource: picked.source,
      deadlineLabel: DEADLINE_FMT.format(picked.ms),
      link: `/alerts/${a.id}`,
      excerpt: excerptOf(a.body),
    });
  }

  for (const b of (billsRes.data ?? []) as unknown as BillRow[]) {
    const ms = Date.parse(b.local_meta?.public_comment_deadline ?? "");
    if (!inWindow(ms)) continue;
    items.push({
      id: `bill-${b.id}`,
      kind: "bill",
      title: `${b.state} ${b.bill_number} · ${b.title?.slice(0, 80) ?? "(no title)"}`,
      locality: b.locality ?? b.state,
      state: b.state,
      filterState: b.state,
      deadline: new Date(ms).toISOString(),
      deadlineSource: "local_meta_comment_deadline",
      deadlineLabel: DEADLINE_FMT.format(ms),
      link: `/bills/${b.id}`,
      excerpt: null,
    });
  }

  // Closest deadline first. The client re-sorts after filtering, but shipping
  // it ordered keeps the prerendered HTML correct for crawlers.
  items.sort((x, y) => Date.parse(x.deadline) - Date.parse(y.deadline));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          ⏰ Comment deadline radar
        </p>
        <h1 className="mt-2 text-3xl font-bold">Public-input windows closing soon</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every Board of Pharmacy rule, federal DEA proposal, and bill with a
          public-comment deadline we&apos;re tracking. Lobbyists pay $5,000/mo
          subscriptions for this intel. We give it free because every comment
          submitted moves the needle.
        </p>
        {/* Suspense is REQUIRED around anything calling useSearchParams(): Next
            refuses to prerender a page that reads them outside a boundary. */}
        <Suspense fallback={<p className="mt-2 h-4 text-xs" />}>
          <DeadlineSummary items={items} baselineNow={renderedAt} />
        </Suspense>
      </header>

      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-zinc-900/50" />}>
        <DeadlinesView items={items} baselineNow={renderedAt} />
      </Suspense>

      <footer className="mt-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-zinc-200">How this radar works</p>
        <p className="mt-1">
          Pipeline pulls from: state Board of Pharmacy rule announcements (50
          scrapers), federal DEA proposals (Federal Register), bill texts with
          explicit deadline language (parsed by AI), and admin-curated alerts.
          Each row links to a full alert/bill detail page where signed-in users
          can one-click draft + send a personalized response letter.
        </p>
      </footer>
    </div>
  );
}
