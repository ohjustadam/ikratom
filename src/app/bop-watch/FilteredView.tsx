"use client";

import { useSearchParams } from "next/navigation";
import { countDirect, FindingsList, StatCard } from "./parts";
import type { Finding } from "./types";

/**
 * The only two filter-dependent regions of /bop-watch.
 *
 * WHY (2026-09-08 egress emergency). The page read `?state=XX` on the server
 * to scope the findings list and one stat card. Reading searchParams forces a
 * per-request render, so every crawler hit re-ran both public BoP RPCs against
 * Supabase — on a page whose content changes once a day, at 10:00 UTC.
 *
 * The param now comes from useSearchParams() here instead. Both components are
 * mounted inside a <Suspense> whose FALLBACK is the same list/card rendered
 * unfiltered on the server, so the static HTML still carries the real findings
 * (crawlers see them without running JS) and the client only narrows them when
 * a filter is actually present.
 *
 * The findings payload is public BoP record, identical for every viewer —
 * nothing here is per-user, so passing it through the cached page is safe.
 */
function useStateFilter(): string | undefined {
  const sp = useSearchParams();
  const raw = (sp.get("state") ?? "").trim();
  // Every link we generate is a 2-letter code; anything else is junk and is
  // ignored rather than reflected back into the page as a heading.
  return /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : undefined;
}

export function FilteredFindings({ findings }: { findings: Finding[] }) {
  const stateFilter = useStateFilter();
  return <FindingsList findings={findings} stateFilter={stateFilter} />;
}

export function DirectFindingsStat({ findings }: { findings: Finding[] }) {
  const stateFilter = useStateFilter();
  const n = countDirect(findings, stateFilter);
  return (
    <StatCard
      label="Kratom-direct findings"
      value={n}
      sub={`last 90 days${stateFilter ? ` · ${stateFilter}` : ""}`}
      accent={n > 0 ? "warn" : "ok"}
    />
  );
}
