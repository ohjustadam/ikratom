import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata = { title: "Notifications Health" };
export const dynamic = "force-dynamic";

/**
 * /admin/notifications-health — delivery observability (PR-J). The #1 reason
 * "some users don't get notifications" was undiagnosable; push_send_log
 * (0194) records every fan-out decision per user per run, and this page
 * rolls up the last 7 days: outcome mix, recent send errors, and the users
 * whose pushes are being held or failing.
 */
type LogRow = {
  run_at: string;
  user_id: string;
  outcome: string;
  notification_count: number;
  sent_count: number;
  failed_count: number;
  error: string | null;
};

const OUTCOME_LABEL: Record<string, string> = {
  sent: "✅ sent",
  held_dnd: "🔕 held (DND/quiet hours)",
  held_rate: "⏳ held (rate cap)",
  held_digest: "📰 held (digest window)",
  opt_out: "🚪 opt-out",
  no_subs: "📵 no push subscription",
  error: "❌ send error",
};

export default async function NotificationsHealthPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  // Service role: notifications RLS is self-only — a user-context count
  // would silently report only the viewing admin's own rows.
  const supabase = createServiceRoleClient();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: logRaw, error: logErr } = await supabase
    .from("push_send_log")
    .select("run_at, user_id, outcome, notification_count, sent_count, failed_count, error")
    .gte("run_at", weekAgo)
    .order("run_at", { ascending: false })
    .limit(2000);
  const log = (logRaw ?? []) as LogRow[];

  const byOutcome = new Map<string, { rows: number; notifs: number }>();
  for (const r of log) {
    const o = byOutcome.get(r.outcome) ?? { rows: 0, notifs: 0 };
    o.rows += 1;
    o.notifs += r.notification_count;
    byOutcome.set(r.outcome, o);
  }
  const errors = log.filter((r) => r.outcome === "error").slice(0, 20);

  const { count: unpushedCount } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("pushed_at", null)
    .gte("created_at", weekAgo);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold text-zinc-100">Notifications health</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Last 7 days of push fan-out decisions (push_send_log). Pending (unpushed, 7d): <b>{unpushedCount ?? 0}</b>.
      </p>

      {logErr && (
        <p className="mt-4 rounded-md border border-amber-900/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
          {logErr.message} — is migration 0194 applied?
        </p>
      )}
      {!logErr && log.length === 0 && (
        <p className="mt-4 text-sm text-zinc-500">No fan-out activity logged yet — the hourly cron writes here from its next run.</p>
      )}

      {log.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-400">Outcome mix</h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {[...byOutcome.entries()].sort((a, b) => b[1].rows - a[1].rows).map(([outcome, v]) => (
              <div key={outcome} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
                <p className="text-sm font-medium text-zinc-100">{OUTCOME_LABEL[outcome] ?? outcome}</p>
                <p className="text-xs text-zinc-500">{v.rows} user-runs · {v.notifs} notifications</p>
              </div>
            ))}
          </div>

          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-400">Recent send errors</h2>
          {errors.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">None in the last 7 days. 🎉</p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs">
              {errors.map((r, i) => (
                <li key={i} className="rounded border border-red-900/30 bg-red-950/20 px-3 py-2 text-red-200">
                  {new Date(r.run_at).toLocaleString()} · user {r.user_id.slice(0, 8)}… · {r.failed_count} failed — {r.error ?? "(no message)"}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
