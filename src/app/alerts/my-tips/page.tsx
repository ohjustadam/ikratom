import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMyIntelTips } from "@/modules/alerts/actions";

export const metadata = { title: "My intel tips" };
export const dynamic = "force-dynamic";

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
  moderation_status: string;
  moderation_note: string | null;
  moderated_at: string | null;
  campaign_id: string | null;
  created_at: string;
};

const STATUS_BADGE: Record<string, string> = {
  approved: "bg-emerald-950/40 text-emerald-300 border-emerald-700/40",
  pending: "bg-amber-950/40 text-amber-300 border-amber-700/40",
  rejected: "bg-red-950/40 text-red-300 border-red-700/40",
};

export default async function MyTipsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/alerts/my-tips");

  const tips = (await listMyIntelTips()) as unknown as Tip[];

  const { data: profile } = await supabase
    .from("profiles")
    .select("intel_tier, intel_approved_count, intel_rejected_count")
    .eq("id", user.id)
    .single();
  const tier = (profile as { intel_tier?: string } | null)?.intel_tier ?? "rookie";
  const approved = (profile as { intel_approved_count?: number } | null)?.intel_approved_count ?? 0;
  const rejected = (profile as { intel_rejected_count?: number } | null)?.intel_rejected_count ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/pulse" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Pulse
      </a>
      <header className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">My intel tips</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Status of every tip you&apos;ve submitted via <a href="/alerts/submit" className="text-emerald-400 hover:underline">/alerts/submit</a>.
          </p>
        </div>
        <a
          href="/alerts/submit"
          className="rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500"
        >
          + Submit a new tip
        </a>
      </header>

      {/* Tier card */}
      <div className={`mb-6 rounded-md border p-4 text-sm ${
        tier === "trusted_reporter" ? "border-emerald-700/50 bg-emerald-950/20" :
        tier === "field_reporter" ? "border-sky-700/50 bg-sky-950/20" :
        "border-zinc-800 bg-zinc-950/40"
      }`}>
        <p className={`font-semibold ${
          tier === "trusted_reporter" ? "text-emerald-300" :
          tier === "field_reporter" ? "text-sky-300" :
          "text-zinc-200"
        }`}>
          {tier === "trusted_reporter" && "✓ Trusted reporter"}
          {tier === "field_reporter" && "🛰 Field reporter"}
          {tier === "rookie" && "Rookie"}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          {approved} approved · {rejected} rejected
          {tier === "rookie" && approved + rejected === 0 && " · Submit your first tip to start earning trust."}
          {tier === "rookie" && approved + rejected > 0 && ` · ${Math.max(0, 3 - approved)} more clean approvals → 🛰 field reporter`}
          {tier === "field_reporter" && ` · ${Math.max(0, 10 - approved)} more clean approvals → ✓ trusted reporter (auto-publish)`}
          {tier === "trusted_reporter" && " · Your tips skip the moderation queue and go live immediately."}
        </p>
      </div>

      {tips.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
          <p className="text-3xl">📡</p>
          <p className="mt-2">You haven&apos;t submitted any tips yet.</p>
          <p className="mt-1 text-[11px] text-zinc-600">
            Spotted a city council agenda or AG presser? <a href="/alerts/submit" className="text-emerald-400 hover:underline">Send it in</a>.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {tips.map((t) => (
            <li
              key={t.id}
              className={`rounded-lg border p-4 ${
                t.moderation_status === "approved" ? "border-zinc-800 bg-zinc-950/40" :
                t.moderation_status === "pending" ? "border-amber-700/30 bg-amber-950/10" :
                "border-red-900/30 bg-red-950/10"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[t.moderation_status] ?? "bg-zinc-900 text-zinc-400"}`}>
                  {t.moderation_status}
                </span>
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">{t.locality}</span>
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400 capitalize">{t.severity}</span>
                {t.action_required && (
                  <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                    ACTION REQUESTED
                  </span>
                )}
                <span className="ml-auto text-zinc-500">
                  Submitted {new Date(t.created_at).toLocaleDateString()}
                </span>
              </div>

              <h3 className="mt-2 text-base font-semibold">{t.title}</h3>

              {t.moderation_status === "approved" && t.campaign_id && (
                <p className="mt-2 text-xs text-emerald-300">
                  ✓ A campaign was generated from this tip.{" "}
                  <a href={`/campaigns/${t.campaign_id}`} className="hover:underline">View campaign →</a>
                </p>
              )}
              {t.moderation_status === "approved" && !t.campaign_id && (
                <p className="mt-2 text-xs text-emerald-300">
                  ✓ Live on /pulse.
                </p>
              )}
              {t.moderation_status === "pending" && (
                <p className="mt-2 text-xs text-amber-300">
                  ⏳ Awaiting admin review.
                </p>
              )}
              {t.moderation_status === "rejected" && t.moderation_note && (
                <p className="mt-2 text-xs text-red-300">
                  ✗ Rejected: <span className="text-zinc-400">{t.moderation_note}</span>
                </p>
              )}
              {t.moderation_status === "rejected" && !t.moderation_note && (
                <p className="mt-2 text-xs text-red-300">
                  ✗ Rejected without note.
                </p>
              )}

              {t.source_url && (
                <p className="mt-2 text-[11px]">
                  <a href={t.source_url} target="_blank" rel="noreferrer noopener" className="text-zinc-500 hover:text-emerald-400">
                    🔗 source
                  </a>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
