import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Data Quality — admin" };
export const dynamic = "force-dynamic";

/**
 * /admin/data-quality — read-only dashboard of known data integrity
 * issues uncovered during the 2026-05-14/15 push.
 *
 * Each row is a category of drift. The count is the current size of
 * the issue; the note explains the symptom + suggested resolution.
 * Where a single script or migration would fix the row, it's linked.
 *
 * Owner directive 2026-05-14: 'you should always audit and fix these
 * before they reach me. this is a fall back.' This page is the
 * fallback that visualizes anything the autonomous resolvers couldn't
 * handle.
 *
 * Categories surveyed:
 *   1. Bills with title-says-kratom but summary-says-other (LA SB 154
 *      pattern). Caught by `scripts/hygiene-misclassified-anti-bills.mjs
 *      --include-pass1`. 39 rows as of last audit.
 *   2. Policy alerts with no bill_id (orphan news headlines that
 *      should link to a bill but don't). 1,167 rows. See PR #283
 *      attempted backfill — script needs body extraction to be
 *      effective.
 *   3. Bills classified as anti + scope=state + status=enacted but
 *      WITHOUT opposition_summary_md (takeback editorial backlog).
 *      Also surfaced on /admin/intel-health Queue + freshness watch.
 *   4. News items active=true with state=NULL (we don't know what
 *      state to surface them under).
 *   5. Forum threads with system_generated=true but no bill_id link
 *      back (orphan auto-threads).
 *   6. Bills with status='enacted' but last_action_at older than 1
 *      year — likely from a closed prior session that got re-used.
 */
export default async function DataQualityPage() {
  const ctx = await getAdminContext({ require: "run_data_diagnostics" });
  if (!ctx.ok) redirect("/dashboard");

  const sb = await createClient();
  const now = Date.now();
  const oneYearAgo = new Date(now - 365 * 86_400_000).toISOString();

  const [
    { count: missing_takeback_intel },
    { count: orphan_alerts_no_bill },
    { count: news_items_no_state },
    { count: bills_no_summary_long },
    { count: bills_no_session_id },
    { count: bills_enacted_stale },
    { count: bills_anti_state_enacted_total },
  ] = await Promise.all([
    sb.from("bills").select("id", { count: "exact", head: true })
      .eq("active", true).eq("kratom_relevance", "anti").eq("scope", "state")
      .in("status", ["enacted", "passed_chamber"])
      .is("opposition_summary_md", null),
    sb.from("policy_alerts").select("id", { count: "exact", head: true })
      .eq("moderation_status", "approved").is("bill_id", null),
    sb.from("news_items").select("id", { count: "exact", head: true })
      .eq("active", true).is("state", null),
    sb.from("bills").select("id", { count: "exact", head: true })
      .eq("active", true).in("kratom_relevance", ["anti", "pro"])
      .eq("scope", "state").is("summary_long", null),
    sb.from("bills").select("id", { count: "exact", head: true })
      .eq("active", true).is("session_id", null),
    sb.from("bills").select("id", { count: "exact", head: true })
      .eq("active", true).eq("status", "enacted")
      .lt("last_action_at", oneYearAgo),
    sb.from("bills").select("id", { count: "exact", head: true })
      .eq("active", true).eq("kratom_relevance", "anti").eq("scope", "state")
      .in("status", ["enacted", "passed_chamber"]),
  ]);

  type IssueRow = {
    title: string;
    count: number;
    total?: number;
    severity: "ok" | "info" | "warn" | "bad";
    note: string;
    action?: string;
  };

  const rows: IssueRow[] = [
    {
      title: "Takeback editorial backlog",
      count: missing_takeback_intel ?? 0,
      total: bills_anti_state_enacted_total ?? 0,
      severity: (missing_takeback_intel ?? 0) > 0 ? "warn" : "ok",
      note: "Anti-kratom state-scope enacted/imminent bills missing opposition_summary_md. /banned filters these out so they're invisible to users until curated.",
      action: "Curate via the admin bill editor; see scripts/seed-banned-state-takeback.mjs as the template.",
    },
    {
      title: "Policy alerts without bill_id",
      count: orphan_alerts_no_bill ?? 0,
      severity: (orphan_alerts_no_bill ?? 0) > 1000 ? "warn" : "info",
      note: "Approved alerts that aren't linked to a specific bill. News-only alerts (kind=news_break / bill_event without an extractable bill number) are expected to be in this bucket — bill-anchored alerts shouldn't be.",
      action: "scripts/backfill-alert-bill-linkage.mjs (experimental, needs news_items.body extraction extension)",
    },
    {
      title: "News items with NULL state",
      count: news_items_no_state ?? 0,
      severity: (news_items_no_state ?? 0) > 100 ? "warn" : "info",
      note: "Active news_items with no state attribution. These don't surface on any /states/[code] page. May be federal-only items that should be tagged as such.",
    },
    {
      title: "Bills missing summary_long",
      count: bills_no_summary_long ?? 0,
      severity: "info",
      note: "Anti/pro state-scope bills that haven't been deep-analyzed by enrich-bill-journey.mjs. Empties as the daily enrich cron runs.",
      action: "scripts/enrich-bill-journey.mjs",
    },
    {
      title: "Bills with NULL session_id",
      count: bills_no_session_id ?? 0,
      severity: "info",
      note: "Bills synced without a recognizable session. Usually local/editorial seeds.",
    },
    {
      title: "Enacted bills with last_action 1y+ stale",
      count: bills_enacted_stale ?? 0,
      severity: "info",
      note: "Bills marked enacted whose last action is more than 365 days old. Mostly historical — these may need re-classification if the session was reused for new content. Related to the 39 stale-title-bill audit in OVERNIGHT_2026-05-15.md.",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </Link>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Data quality audit</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Read-only view of known data-integrity issues uncovered during the 2026-05-14/15 push. Each row is a category, with current count and a suggested resolution path. Refresh the page to re-query.
        </p>
        <p className="mt-2 text-[10px] uppercase tracking-wider text-zinc-600">
          checked {new Date().toISOString().slice(0, 19).replace("T", " ")} UTC
        </p>
      </header>

      <section className="space-y-3">
        {rows.map((r, i) => {
          const cls =
            r.severity === "bad"  ? "border-red-700/50 bg-red-950/15" :
            r.severity === "warn" ? "border-amber-700/50 bg-amber-950/15" :
            r.severity === "info" ? "border-zinc-700 bg-zinc-950/40" :
                                    "border-emerald-700/40 bg-emerald-950/15";
          const valCls =
            r.severity === "bad"  ? "text-red-200" :
            r.severity === "warn" ? "text-amber-200" :
            r.severity === "info" ? "text-zinc-300" :
                                    "text-emerald-200";
          return (
            <div key={i} className={`rounded-md border p-4 ${cls}`}>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className={`font-mono text-2xl font-bold tabular-nums ${valCls}`}>
                  {r.count.toLocaleString()}
                  {r.total != null && (
                    <span className="ml-1 text-sm text-zinc-500">/ {r.total.toLocaleString()}</span>
                  )}
                </span>
                <h2 className="text-sm font-semibold text-zinc-100">{r.title}</h2>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">{r.note}</p>
              {r.action && (
                <p className="mt-1 text-[11px] text-emerald-400">
                  <span className="text-zinc-500">Action:</span> {r.action}
                </p>
              )}
            </div>
          );
        })}
      </section>

      <footer className="mt-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-400">
        <p>
          <strong className="text-zinc-200">How to use this page.</strong>{" "}
          Each category here represents data that the autonomous resolvers couldn&apos;t handle — see <code className="rounded bg-zinc-900 px-1">scripts/auto-resolve-sync-discrepancies.mjs</code>, <code className="rounded bg-zinc-900 px-1">scripts/hygiene-misclassified-anti-bills.mjs</code>, and the auto-poster trigger guard (migration 0142). The numbers here should trend toward zero as editorial work + script refinements proceed.
        </p>
      </footer>
    </div>
  );
}
