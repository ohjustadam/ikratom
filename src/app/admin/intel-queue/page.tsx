import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listPendingIntelTips } from "@/modules/alerts/actions";
import { ModerateIntelRow } from "./ModerateIntelRow";
import ResolveQueue from "@/app/admin/_components/ResolveQueue";

export const metadata = { title: "Intel queue" };
export const dynamic = "force-dynamic";

/**
 * /admin/intel-queue — moderation surface for advocate-submitted
 * intel tips (kind='intel_tip', moderation_status='pending').
 *
 * Approve flow: admin reassigns kind to a real type (bill_event,
 * bop_hearing, etc.) so the auto-campaign trigger picks the right
 * template; flips moderation_status to 'approved'; trigger fires
 * if action_required is true.
 *
 * Reject flow: marks moderation_status='rejected' with a note
 * (audit log only — no email back to submitter for now).
 */
type Tip = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  locality: string;
  source_url: string | null;
  occurs_at: string | null;
  action_required: boolean;
  submitted_by_user_id: string | null;
  is_anonymous: boolean;
  created_at: string;
  _submitter_tier?: string;
  _submitter_approved?: number;
  _submitter_rejected?: number;
};

export default async function IntelQueuePage() {
  const ctx = await getAdminContext({ require: "moderate_intel_queue" });
  if (!ctx.ok) redirect("/dashboard");
  const tips = (await listPendingIntelTips()) as unknown as Tip[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Intel queue</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {tips.length === 0
              ? "Queue is empty."
              : `${tips.length} ${tips.length === 1 ? "tip" : "tips"} from the field awaiting review.`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ResolveQueue kind="intel" />
          <span className="text-[11px] font-mono text-zinc-600">
            approval auto-spawns a campaign (Phase 4 trigger)
          </span>
        </div>
      </header>

      {tips.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
          <p className="text-3xl">✓</p>
          <p className="mt-2">All caught up.</p>
          <p className="mt-1 text-[11px] text-zinc-600">
            New tips show up here as advocates submit them via /alerts/submit.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {tips.map((t) => (
            <li key={t.id} className="rounded-lg border border-amber-700/40 bg-amber-950/10 p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                  PENDING
                </span>
                <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                  t.severity === "critical" ? "bg-red-950/60 text-red-300" :
                  t.severity === "alert" ? "bg-amber-950/60 text-amber-300" :
                  "bg-zinc-900 text-zinc-400"
                }`}>
                  {t.severity}
                </span>
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                  {t.locality}
                </span>
                {t.action_required && (
                  <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                    ACTION REQUESTED
                  </span>
                )}
                {t.occurs_at && (
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">
                    📅 {new Date(t.occurs_at).toLocaleString()}
                  </span>
                )}
                <span className="ml-auto text-zinc-500">
                  {new Date(t.created_at).toLocaleString()}
                </span>
              </div>

              <h3 className="mt-3 text-lg font-semibold">{t.title}</h3>

              {t.body && (
                <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-900 bg-zinc-950 p-3 font-sans text-sm leading-relaxed text-zinc-300">
                  {t.body}
                </pre>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                {t.source_url ? (
                  <a
                    href={t.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-emerald-400 hover:underline"
                  >
                    🔗 source
                  </a>
                ) : (
                  <span className="text-red-400">⚠ no source URL</span>
                )}
                <span>
                  Submitter:{" "}
                  {t.is_anonymous
                    ? <span className="text-zinc-600">(anonymous to public)</span>
                    : t.submitted_by_user_id
                    ? <a href={`/profile/${t.submitted_by_user_id}`} target="_blank" rel="noreferrer" className="font-mono hover:text-zinc-300">{t.submitted_by_user_id.slice(0, 8)}</a>
                    : <span className="text-zinc-600">—</span>
                  }
                </span>
                {t._submitter_tier && (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    t._submitter_tier === "trusted_reporter" ? "bg-emerald-950/60 text-emerald-300" :
                    t._submitter_tier === "field_reporter" ? "bg-sky-950/60 text-sky-300" :
                    "bg-zinc-900 text-zinc-500"
                  }`}>
                    {t._submitter_tier === "trusted_reporter" ? "✓ Trusted" :
                     t._submitter_tier === "field_reporter" ? "🛰 Field rep" :
                     "Rookie"}
                  </span>
                )}
                {(t._submitter_approved ?? 0) + (t._submitter_rejected ?? 0) > 0 && (
                  <span className="text-zinc-600">
                    ({t._submitter_approved}✓ / {t._submitter_rejected}✗)
                  </span>
                )}
              </div>

              <div className="mt-4">
                <ModerateIntelRow
                  alertId={t.id}
                  initialSeverity={t.severity as "watch" | "alert" | "critical"}
                  initialActionRequired={t.action_required}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
