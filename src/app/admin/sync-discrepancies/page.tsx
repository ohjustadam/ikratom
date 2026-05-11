import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { DiscrepancyRow } from "./DiscrepancyRow";

export const metadata = { title: "Sync discrepancies" };
export const dynamic = "force-dynamic";

/**
 * /admin/sync-discrepancies — triage surface for the daily AI-grounded
 * verification pass (scripts/verify-bill-status-ai.mjs). When the AI
 * reports a status that differs from our DB, a kind='scraper_stale'
 * policy_alert lands here for admin review.
 *
 * This is the "what bills did we miss?" board — the visible output of
 * Layer 3 of the real-time accuracy pipeline.
 */
type Discrepancy = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  locality: string;
  bill_id: string | null;
  created_at: string;
  moderation_status: string;
};

export default async function SyncDiscrepanciesPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");
  const supabase = await createClient();

  // Open discrepancies — kind='scraper_stale', approved status, not resolved
  const { data: openDiscrepancies } = await supabase
    .from("policy_alerts")
    .select("id, title, body, severity, locality, bill_id, created_at, moderation_status")
    .eq("kind", "scraper_stale")
    .eq("moderation_status", "approved")
    .order("created_at", { ascending: false })
    .limit(50);

  // Resolved (admin marked them rejected after fixing)
  const { data: resolvedDiscrepancies } = await supabase
    .from("policy_alerts")
    .select("id, title, body, severity, locality, bill_id, created_at, moderation_status, moderated_at, moderation_note")
    .eq("kind", "scraper_stale")
    .eq("moderation_status", "rejected")
    .order("moderated_at", { ascending: false })
    .limit(20);

  const open = (openDiscrepancies ?? []) as Discrepancy[];
  const resolved = (resolvedDiscrepancies ?? []) as Discrepancy[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Sync discrepancies</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Bills where AI-grounded fact-check (Gemini + Search) disagrees with our DB.
            Each one is a potential TN SB 1656-class miss — review, force-sync, or mark resolved.
          </p>
        </div>
        <div className="text-right text-xs">
          <p className="text-zinc-500">
            Last AI verification run: <span className="font-mono text-zinc-300">daily at 10:00 UTC</span>
          </p>
          <p className="text-zinc-600">{open.length} open · {resolved.length} resolved (last 20)</p>
        </div>
      </header>

      <div className="mb-6 rounded-md border border-emerald-700/40 bg-emerald-950/10 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-emerald-300">How to triage</p>
        <ol className="mt-2 ml-4 list-decimal space-y-1">
          <li>Read the AI&apos;s reported status + the DB&apos;s current status. AI usually wins for time-sensitive events.</li>
          <li>Click <strong>View bill</strong> to see what we have. Update status / last_action via <code>/admin/bills/[id]/edit</code> if AI is correct.</li>
          <li>If LegiScan or OpenStates needs a kick, click <strong>Force re-sync</strong> to push the bill to the front of the next cron queue.</li>
          <li>When the DB matches reality, click <strong>Mark resolved</strong> to move the alert to history.</li>
        </ol>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Open discrepancies {open.length > 0 && `(${open.length})`}
        </h2>
        {open.length === 0 ? (
          <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-8 text-center">
            <p className="text-3xl">✓</p>
            <p className="mt-2 text-sm text-emerald-300">
              Every tracked bill matches the AI verification. System in sync.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {open.map((d) => (
              <DiscrepancyRow key={d.id} discrepancy={d} />
            ))}
          </ul>
        )}
      </section>

      {resolved.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Recently resolved
          </h2>
          <ul className="space-y-2 opacity-70">
            {resolved.map((d) => (
              <li
                key={d.id}
                className="rounded-md border border-zinc-900 bg-zinc-950/30 p-3 text-xs text-zinc-400"
              >
                <p>{d.title}</p>
                <p className="mt-1 text-[10px] text-zinc-600">
                  Resolved {new Date((d as { moderated_at?: string }).moderated_at ?? d.created_at).toLocaleString()}
                  {(d as { moderation_note?: string }).moderation_note && ` · ${(d as { moderation_note?: string }).moderation_note}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
