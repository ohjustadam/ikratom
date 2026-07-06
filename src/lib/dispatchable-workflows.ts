/**
 * Registry of GitHub Actions workflows the owner can dispatch on demand from
 * the admin panel + AI Editor — "run all the crons without leaving the site,
 * without a developer" (owner ask 2026-07-05).
 *
 * Plain data module (NO "use server") so BOTH client components (the cron
 * panel) and server actions (console-actions.dispatchWorkflow, the AI editor
 * tool) can import it — a "use server" file may only export async functions.
 *
 * Only workflows that:
 *   - declare `on: workflow_dispatch:` (verified 2026-07-05), AND
 *   - are safe/idempotent to re-run manually
 * are listed. Deliberately EXCLUDED: desktop-build (cuts a release),
 * ghost-canary (throwaway), sync-architecture-gist (push-triggered/dead),
 * auto-patch-notes (doc drafter, low value here). The server action
 * allowlists exactly this set — the file string is the security boundary.
 */
export type DispatchableWorkflow = {
  /** The workflow filename under .github/workflows/ — the API path segment. */
  file: string;
  label: string;
  purpose: string;
  /** Roughly how long a run takes, for the UI. */
  runtime: string;
};

export const DISPATCHABLE_WORKFLOWS: readonly DispatchableWorkflow[] = [
  {
    file: "cron-hourly.yml",
    label: "Hourly cron",
    purpose: "News intake → enrich → policy actions → self-watchdog. The freshness engine.",
    runtime: "~25 min",
  },
  {
    file: "cron-daily.yml",
    label: "Daily cron",
    purpose: "Bill/legislator/donor syncs, state briefings, campaign generation + cleanup janitors, queue clearing.",
    runtime: "~30 min (many parallel jobs)",
  },
  {
    file: "cron-nightly-cloud.yml",
    label: "Nightly cloud chassis",
    purpose: "Box-independent nightly steps — bill texts, elections, cloud data pulls.",
    runtime: "~20 min",
  },
  {
    file: "cron-weekly.yml",
    label: "Weekly cron",
    purpose: "Nonprofit 990s, patch-note draft, weekly legislator stance sweep.",
    runtime: "~15 min",
  },
  {
    file: "cron-localreps-cloud.yml",
    label: "Local reps (cloud)",
    purpose: "Drain the pending local-official queue via in-job SearXNG + headless Chromium.",
    runtime: "~10 min",
  },
  {
    file: "news-backfill-burst.yml",
    label: "News backfill burst",
    purpose: "Burst-resolve Google News URLs from clean cloud IPs (box IP gets throttled).",
    runtime: "~10 min",
  },
  {
    file: "portrait-sync.yml",
    label: "Portrait sync",
    purpose: "Official + state-executive portraits (OpenStates people tarball + Wayback).",
    runtime: "~15 min",
  },
  {
    file: "topic-bills-sync.yml",
    label: "Topic classify",
    purpose: "Multi-topic bill discovery (LegiScan) + substance classification.",
    runtime: "~10 min",
  },
] as const;

/** Just the filenames — the dispatch allowlist / security boundary. */
export const DISPATCHABLE_WORKFLOW_FILES: readonly string[] =
  DISPATCHABLE_WORKFLOWS.map((w) => w.file);
