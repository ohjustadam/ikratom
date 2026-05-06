import { notFound, redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Campaign analytics" };
export const dynamic = "force-dynamic";

export default async function CampaignStatsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");

  const { id } = await params;
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, slug, title, state, created_at")
    .eq("id", id)
    .single();
  if (!campaign) notFound();
  const c = campaign as { id: string; slug: string; title: string; state: string | null; created_at: string };

  // All actions for this campaign
  const { count: totalActions } = await supabase
    .from("campaign_actions")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", c.id);

  // Per-method breakdown
  const { data: actions } = await supabase
    .from("campaign_actions")
    .select("method, sent_at, legislator_id, referred_from")
    .eq("campaign_id", c.id);
  const allActions = (actions ?? []) as Array<{ method: string; sent_at: string; legislator_id: string | null; referred_from: string | null }>;

  const methodCounts = { mailto: 0, platform_email: 0, call: 0 };
  for (const a of allActions) {
    if (a.method === "mailto") methodCounts.mailto++;
    else if (a.method === "platform_email") methodCounts.platform_email++;
    else if (a.method === "call") methodCounts.call++;
  }

  // Top legislators by action count
  const legCounts = new Map<string, number>();
  for (const a of allActions) {
    if (!a.legislator_id) continue;
    legCounts.set(a.legislator_id, (legCounts.get(a.legislator_id) ?? 0) + 1);
  }
  const topLegIds = Array.from(legCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const { data: legRows } = topLegIds.length > 0
    ? await supabase
        .from("legislators")
        .select("id, full_name, state, role, party, district")
        .in("id", topLegIds.map(([id]) => id))
    : { data: [] };
  const legById = new Map(((legRows ?? []) as Array<{ id: string; full_name: string; state: string; role: string; party: string | null; district: string | null }>).map((l) => [l.id, l]));

  // Top referrers (embed widget)
  const refCounts = new Map<string, number>();
  for (const a of allActions) {
    if (!a.referred_from) continue;
    refCounts.set(a.referred_from, (refCounts.get(a.referred_from) ?? 0) + 1);
  }
  const topRefs = Array.from(refCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // 30-day daily series
  const buckets: Record<string, number> = {};
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  for (const a of allActions) {
    const day = a.sent_at.slice(0, 10);
    if (day in buckets) buckets[day]++;
  }
  const series = Object.entries(buckets).map(([day, count]) => ({ day, count }));
  const sparkMax = Math.max(1, ...series.map((s) => s.count));
  const last30 = series.reduce((a, b) => a + b.count, 0);

  // Shares + waves count
  const [{ count: sharesCount }, { data: waves }] = await Promise.all([
    supabase.from("campaign_shares").select("id", { count: "exact", head: true }).eq("campaign_id", c.id),
    supabase
      .from("campaign_waves")
      .select("id, title, scheduled_at, fired_at, sent_count, failed_count, active")
      .eq("campaign_id", c.id)
      .order("scheduled_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href={`/admin/campaigns/${c.id}/edit`} className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Edit campaign
      </a>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Analytics
        </p>
        <h1 className="mt-1 text-3xl font-bold">{c.title}</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Live since {new Date(c.created_at).toLocaleDateString()}
          {c.state && <> · {c.state}</>}
        </p>
      </header>

      {/* Stat strip */}
      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={totalActions ?? 0} label="Total actions" accent />
        <Stat value={methodCounts.mailto + methodCounts.platform_email} label="Emails sent" />
        <Stat value={methodCounts.call} label="Calls made" />
        <Stat value={sharesCount ?? 0} label="Shares" />
      </section>

      {/* Sparkline */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Last 30 days · {last30.toLocaleString()} actions
        </h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="flex h-24 items-end gap-1">
            {series.map((s) => {
              const h = Math.round((s.count / sparkMax) * 88);
              return (
                <div
                  key={s.day}
                  title={`${s.day}: ${s.count}`}
                  className="flex-1 rounded-t bg-emerald-700/40 hover:bg-emerald-500"
                  style={{ height: `${Math.max(2, h)}px` }}
                />
              );
            })}
          </div>
        </div>
      </section>

      {/* Method breakdown */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Send method
        </h2>
        <div className="space-y-2">
          <Bar label="Manual mailto / Outlook / Apple Mail" count={methodCounts.mailto} max={totalActions ?? 1} />
          <Bar label="Gmail one-click batch" count={methodCounts.platform_email} max={totalActions ?? 1} />
          <Bar label="Phone calls" count={methodCounts.call} max={totalActions ?? 1} />
        </div>
      </section>

      {/* Top legislators */}
      {topLegIds.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Most-contacted legislators
          </h2>
          <ul className="space-y-2">
            {topLegIds.map(([legId, count]) => {
              const l = legById.get(legId);
              if (!l) return null;
              return (
                <li key={legId} className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
                  <span className="font-mono tabular-nums text-emerald-300">{count}</span>
                  <a href={`/legislators/${l.id}`} className="flex-1 text-zinc-200 hover:text-emerald-400">
                    {l.full_name}
                  </a>
                  <span className="text-xs text-zinc-500">
                    {l.state} · {l.role}{l.district ? ` D${l.district}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Top referring partners */}
      {topRefs.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Top embed referrers
          </h2>
          <ul className="space-y-2">
            {topRefs.map(([host, count]) => (
              <li key={host} className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
                <span className="font-mono tabular-nums text-emerald-300">{count}</span>
                <a href={`/partners/${host}`} className="flex-1 truncate text-zinc-200 hover:text-emerald-400">
                  {host}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Wave history */}
      {(waves ?? []).length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Coalition waves
          </h2>
          <ul className="space-y-2">
            {((waves ?? []) as Array<{ id: string; title: string; scheduled_at: string; fired_at: string | null; sent_count: number; failed_count: number; active: boolean }>).map((w) => {
              const status = w.fired_at ? "Fired" : !w.active ? "Cancelled" : "Scheduled";
              const cls = w.fired_at ? "text-emerald-300" : !w.active ? "text-zinc-500" : "text-amber-300";
              return (
                <li key={w.id} className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs font-semibold ${cls}`}>{status}</span>
                    <a href={`/admin/campaigns/${c.id}/waves/${w.id}`} className="flex-1 text-zinc-200 hover:text-emerald-400">
                      {w.title}
                    </a>
                    {w.fired_at && (
                      <span className="text-xs text-zinc-400">
                        {w.sent_count} sent
                        {w.failed_count > 0 && <span className="text-red-400"> · {w.failed_count} failed</span>}
                      </span>
                    )}
                    <span className="text-xs text-zinc-500">{new Date(w.scheduled_at).toLocaleDateString()}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 text-center ${accent ? "border-emerald-700/50 bg-emerald-950/20" : "border-zinc-800 bg-zinc-950/40"}`}>
      <div className={`text-3xl font-bold tabular-nums ${accent ? "text-emerald-300" : "text-zinc-100"}`}>
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}

function Bar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = Math.round((count / Math.max(1, max)) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-zinc-300">{label}</span>
        <span className="font-mono text-zinc-400">{count.toLocaleString()} ({pct}%)</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-900">
        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
