import { Suspense } from "react";
import Link from "next/link";
import { createAnonClient } from "@/lib/supabase/anon";
import { CoverageTable } from "./CoverageTable";
import { DirectFindingsStat, FilteredFindings } from "./FilteredView";
import { countDirect, FindingsList, StatCard } from "./parts";
import type { Finding, Source } from "./types";

export const metadata = {
  title: "BoP Watch · State Pharmacy Board Monitoring",
  description:
    "iKratom monitors every U.S. state Board of Pharmacy daily for kratom-related rulemaking — the administrative path to a ban that bypasses the legislature. Live coverage status + flagged findings.",
};

/**
 * Static + ISR. Was force-dynamic.
 *
 * WHY (2026-09-08 egress emergency). Two things forced a render per request:
 * the cookie-bound `@/lib/supabase/server` client, and reading `?state=XX`
 * from searchParams. Neither was per-viewer. Both public RPCs
 * (`get_public_bop_sources` / `get_public_bop_findings`) return identical rows
 * to an anonymous caller — verified 2026-09-10 against service role: 53
 * sources, 1 finding, same ids and columns — which is why
 * modules/bop/BopWatchSummary.tsx already moved to the anon client. This page
 * now uses the same client, and the state filter moved into FilteredView.tsx
 * behind useSearchParams(). Nothing on this page is scoped to the viewer, so
 * there is nothing per-user to leak into the shared cache.
 *
 * The findings/stat Suspense fallbacks are the SAME components rendered
 * unfiltered on the server, so the static HTML carries the real numbers and
 * the real findings — a crawler with no JS sees the page as it always looked,
 * and a reader with a `?state=` link gets it narrowed on hydration.
 *
 * Beyond egress: exceeding the Supabase free-tier cap RESTRICTS the project
 * rather than billing for it. A dynamic route 500s in that state; a
 * prerendered one is a file on the CDN and keeps serving — and BoP Watch is
 * exactly the early-warning surface you do not want dark during an outage.
 */
/**
 * ⚠ FROZEN WINDOW — RESTORE TO 3600 ON 2026-09-16. ⚠
 *
 * Supabase free-tier egress was at 96.3% with the cycle resetting 09-16, and
 * exceeding it RESTRICTS the project (the API stops answering; the site goes
 * down). ISR is lazy — a cached page only re-renders when a request arrives
 * after its window — so the window IS the per-page cost ceiling. Stretching it
 * past the reset means this page renders at most once more for the rest of the
 * cycle and then costs nothing at all, while still serving instantly from the
 * CDN.
 *
 * The usual objection — "but the content goes stale" — barely applies here:
 * the cron fleet is ALREADY deferred by the egress gate, so the underlying
 * data is not moving either. The BoP sweep itself only runs once a day at
 * 10:00 UTC, which is why the post-freeze window is an hour and not minutes.
 *
 * tests/egress-freeze-expiry.test.ts turns red after 2026-09-16 so the frozen
 * pages revert on evidence rather than on someone remembering.
 */
export const revalidate = 604800; // 7d — frozen; normal is 3600

export default async function BopWatchPage() {
  const supabase = createAnonClient();

  const [{ data: sources }, { data: findings }] = await Promise.all([
    supabase.rpc("get_public_bop_sources"),
    supabase.rpc("get_public_bop_findings", { p_days: 90 }),
  ]);

  const allSources = (sources ?? []) as Source[];
  const allFindings = (findings ?? []) as Finding[];

  const enabledCount = allSources.filter((s) => s.enabled).length;
  const lastScrapeAt = allSources
    .map((s) => s.last_scraped_at)
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  const okCount = allSources.filter((s) => s.last_status === "ok" || s.last_status === "no_findings").length;
  const errorCount = allSources.filter((s) => s.last_status === "error").length;
  const directTotal = countDirect(allFindings);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/" className="text-xs text-zinc-500 hover:text-emerald-400">← Home</Link>

      <header className="mt-2 mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Early-warning monitoring
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">BoP Watch</h1>
        <p className="mt-3 max-w-3xl text-zinc-400">
          Every U.S. state Board of Pharmacy can{" "}
          <strong className="text-zinc-100">schedule kratom administratively</strong>{" "}
          without a legislative vote. North Carolina has done it. Several other states
          have tried. iKratom monitors {enabledCount} state agency surfaces{" "}
          <strong className="text-zinc-100">daily</strong> so the kratom community
          can catch a hostile rule proposal the day it drops, not the week it goes
          into effect.
        </p>
      </header>

      {/* Live status banner. Three cards are filter-independent and stay on the
          server; only the kratom-direct count reacts to `?state=`. */}
      <section className="mb-10 grid gap-4 sm:grid-cols-4">
        <StatCard label="Sources monitored" value={enabledCount} sub="states + DC" />
        <StatCard
          label="Scraped today"
          value={okCount}
          sub={okCount === enabledCount ? "all clear" : `${errorCount} error${errorCount === 1 ? "" : "s"}`}
          accent={okCount === enabledCount ? "ok" : errorCount > 5 ? "warn" : "neutral"}
        />
        <Suspense
          fallback={
            <StatCard
              label="Kratom-direct findings"
              value={directTotal}
              sub="last 90 days"
              accent={directTotal > 0 ? "warn" : "ok"}
            />
          }
        >
          <DirectFindingsStat findings={allFindings} />
        </Suspense>
        <StatCard
          label="Last sweep"
          value={lastScrapeAt ? new Date(lastScrapeAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}
          sub={lastScrapeAt ? new Date(lastScrapeAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "never"}
        />
      </section>

      {/* Suspense is REQUIRED: FilteredFindings calls useSearchParams(), and
          Next refuses to prerender a page that reads them outside a boundary. */}
      <Suspense fallback={<FindingsList findings={allFindings} />}>
        <FilteredFindings findings={allFindings} />
      </Suspense>

      <CoverageTable sources={allSources} />

      <footer className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-sm text-zinc-400">
        <h3 className="mb-2 font-semibold text-zinc-200">How this works</h3>
        <p>
          Every day at 10:00 UTC a cron job pulls each board&apos;s public meeting
          agenda or rule-proposal page, extracts every linked agenda item, and
          flags anything mentioning kratom, mitragynine, 7-OH, or related
          scheduling language. Findings classified as{" "}
          <strong className="text-zinc-100">kratom-direct</strong> are surfaced here
          immediately; an admin reviews and can promote the hostile ones into the
          main alert feed which fans out to your push/email notifications.
        </p>
        <p className="mt-3 text-xs text-zinc-500">
          See something we should be watching that we&apos;re not? Submit a tip at{" "}
          <Link href="/alerts/submit" className="text-emerald-400 hover:underline">/alerts/submit</Link>.
        </p>
      </footer>
    </div>
  );
}
