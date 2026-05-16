import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { recentUserErrorSummary, userErrorAutoResolveStats } from "@/lib/user-error-reports";
import { suggestedFixForErrorCode } from "@/lib/auth-events";
import { UserErrorClusterActions } from "./UserErrorClusterActions";

export const metadata = { title: "User error reports — admin" };
export const dynamic = "force-dynamic";

/**
 * /admin/user-errors — triage surface for the user-reported errors that
 * weren't silently auto-resolved by the classifier.
 *
 * Owner directive 2026-05-16: "the report error button to admin should
 * appear anytime a user gets an error."
 *
 * Mirrors /admin/oauth-config (same pattern, different table). Reports
 * land here when:
 *   - Error code is unknown (classifier doesn't recognize the pattern)
 *   - A "transient" error recurs >5 times in 24h (sustained outage)
 *   - A cookie/CSRF error recurs >10 times in 24h (config drift)
 *   - The error is a known config-drift code (redirect_uri_mismatch, etc)
 *
 * Otherwise the classifier silently resolves and admin never sees it.
 */
export default async function UserErrorsPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const clusters = await recentUserErrorSummary({ sinceHours: 24 * 7, limit: 30 });
  const stats = await userErrorAutoResolveStats({ sinceHours: 24 * 7 });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">User-reported errors</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          When a user hits an error on the site, they can click <strong>📮 Report to admin</strong> to flag it. The same self-healing classifier from /admin/oauth-config runs: known user-side errors (typos, validation) are silently resolved; only true issues bubble here.
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          Source: <code className="rounded bg-zinc-900 px-1">user_error_reports</code> table (migration 0147). Reports include page URL, error code, and what the user said they were trying to do.
        </p>
      </header>

      <section className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-md border border-emerald-700/30 bg-emerald-950/15 p-3">
          <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">Auto-resolved · 7d</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-emerald-300">{stats.auto_resolved}</p>
          <p className="mt-1 text-[10px] text-zinc-500">user typos · validation · transient blips</p>
        </div>
        <div className="rounded-md border border-amber-700/30 bg-amber-950/15 p-3">
          <p className="text-[10px] uppercase tracking-wider text-amber-300/80">Escalated · 7d</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-amber-300">{stats.escalated}</p>
          <p className="mt-1 text-[10px] text-zinc-500">unknown patterns · sustained outages</p>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400">Legacy unclassified · 7d</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-zinc-300">{stats.unclassified_legacy}</p>
          <p className="mt-1 text-[10px] text-zinc-500">pre-0147 rows; shown for safety</p>
        </div>
      </section>

      {clusters.length > 0 ? (
        <section className="rounded-lg border-2 border-amber-700/50 bg-amber-950/15 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-amber-300">
            🚨 Escalated reports · last 7 days
          </h2>
          <p className="mt-1 text-[11px] text-amber-200/80">
            Aggregated by (kind, error code). User-side errors and transient blips are auto-resolved and don&apos;t appear here — only patterns the classifier flagged as needing admin action.
          </p>
          <ul className="mt-3 space-y-2">
            {clusters.map((c, i) => {
              const fix = c.error_code ? suggestedFixForErrorCode(c.error_code) : null;
              return (
                <li key={i} className="rounded-md border border-amber-700/30 bg-zinc-950/40 p-3">
                  <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    <span className="font-mono text-2xl font-bold tabular-nums text-amber-200">{c.count}</span>
                    <span className="font-mono text-zinc-200">{c.kind}</span>
                    {c.error_code && <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-amber-200">{c.error_code}</span>}
                    {c.auto_resolved_count > 0 && (
                      <span className="rounded bg-emerald-950/50 px-1.5 py-0.5 text-[10px] text-emerald-300" title="Auto-resolved before escalation">
                        +{c.auto_resolved_count} auto-fixed
                      </span>
                    )}
                    <span className="ml-auto text-zinc-500">latest {new Date(c.latest_at).toLocaleString()}</span>
                  </div>
                  {fix && (
                    <p className="mt-2 text-[12px] text-zinc-300">
                      <span className="font-semibold text-emerald-400">Suggested fix:</span> {fix}
                    </p>
                  )}
                  {c.latest_notes && !fix && (
                    <p className="mt-2 text-[11px] italic text-zinc-400">
                      Classifier: {c.latest_notes}
                    </p>
                  )}
                  <UserErrorClusterActions
                    cluster={{
                      kind: c.kind,
                      error_code: c.error_code,
                      dev_issue_url: c.dev_issue_url,
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="rounded-md border border-emerald-700/40 bg-emerald-950/15 p-3 text-[12px] text-emerald-300">
          ✓ No user-reported errors need admin attention in the last 7 days. {stats.auto_resolved > 0 && <>The classifier auto-resolved <strong>{stats.auto_resolved}</strong> user-side errors silently. </>}Self-healing diagnostics armed and reporting clean.
        </p>
      )}

      <section className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          How users see this
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Anywhere on the site that renders an error, the <code className="rounded bg-zinc-900 px-1">&lt;ErrorWithReport&gt;</code> component shows a &quot;📮 Report to admin&quot; button next to the message. Click → user types a short description (optional) → server runs the same classifier as auth events. They see one of:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-400">
          <li><strong className="text-emerald-300">✓ Recorded:</strong> typo/validation/transient — auto-resolved, try again</li>
          <li><strong className="text-amber-300">📨 Escalated to admin:</strong> unknown pattern — appears in the list above</li>
        </ul>
      </section>
    </div>
  );
}
