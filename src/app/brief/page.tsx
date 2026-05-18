import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Daily brief — what's moving in kratom policy",
  description:
    "Personalized digest: alerts in your state, bills you watch, news on tracked legislators, active operations near you. Pull-mode tracking burden converted to push-mode reading.",
};
export const dynamic = "force-dynamic";

/**
 * /brief — Daily Advocate Brief MVP.
 *
 * Single consolidated page that surfaces, for the signed-in user:
 *
 *   1. Open action surface — campaigns + operation-response routes for
 *      active operations in their state. The "do this now" header.
 *   2. State heat — critical/alert severity policy_alerts in their
 *      state from the last 7 days.
 *   3. Watched-bill movements — status changes on bills they subscribed
 *      to (bill_subscriptions) in the last 7 days.
 *   4. Active operations — clusters with bills touched in last 30 days
 *      in their state.
 *
 * Anon visitors get a national-scope version (no personalization).
 *
 * Defensive on every section so a single failing query (RLS hiccup,
 * pre-migration deploy, missing subscription table) degrades that
 * one section instead of 500-ing the whole page.
 *
 * MVP scope: live-computed, no storage. v2 will add daily push
 * delivery (cron writes the digest to a daily_briefs table + fires
 * web-push to opted-in users with a deep link to the snapshot).
 */
export default async function BriefPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  // Viewer state — defaults a lot of the digest scope. Anon → null.
  let viewerState: string | null = null;
  let viewerName: string | null = null;
  if (user) {
    const { data } = await sb
      .from("profiles")
      .select("state, full_name")
      .eq("id", user.id)
      .maybeSingle();
    if (data) {
      viewerState = (data as { state: string | null }).state;
      viewerName = (data as { full_name: string | null }).full_name;
    }
  }

  // 7-day cutoff used by multiple sections
  const ALERT_HORIZON = 7;
  const cutoff7 = new Date(Date.now() - ALERT_HORIZON * 86400 * 1000).toISOString();
  const cutoff30 = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  // ── 1. State alerts (critical + alert severity, last 7 days)
  type Alert = { id: string; kind: string; severity: string; title: string; locality: string; created_at: string; source_url: string | null };
  let stateAlerts: Alert[] = [];
  try {
    let q = sb.from("policy_alerts")
      .select("id, kind, severity, title, locality, created_at, source_url")
      .in("severity", ["critical", "alert"])
      .eq("moderation_status", "approved")
      .gte("created_at", cutoff7)
      .order("created_at", { ascending: false })
      .limit(20);
    if (viewerState) q = q.eq("locality", viewerState);
    const { data } = await q;
    stateAlerts = (data ?? []) as Alert[];
  } catch { /* defensive */ }

  // ── 2. Watched-bill movements (status changes in last 7 days)
  type WatchedBill = {
    id: string; state: string; bill_number: string; title: string | null;
    status: string | null; last_action: string | null; last_action_at: string | null;
    kratom_relevance: string | null;
  };
  let watchedBills: WatchedBill[] = [];
  if (user) {
    try {
      const { data: subs } = await sb
        .from("bill_subscriptions")
        .select("bill_id")
        .eq("user_id", user.id);
      const billIds = (subs ?? []).map((s: { bill_id: string }) => s.bill_id);
      if (billIds.length > 0) {
        const { data } = await sb
          .from("bills")
          .select("id, state, bill_number, title, status, last_action, last_action_at, kratom_relevance")
          .in("id", billIds)
          .gte("last_action_at", cutoff7.slice(0, 10))
          .order("last_action_at", { ascending: false });
        watchedBills = (data ?? []) as WatchedBill[];
      }
    } catch { /* defensive */ }
  }

  // ── 3. Active operations in state (clusters with bills last touched ≤30d)
  type ActiveOp = { slug: string; name: string; posture: string; bills: number; states: number };
  let activeOps: ActiveOp[] = [];
  try {
    let q = sb.from("bill_cluster_members")
      .select("bill_clusters!inner(slug, name, posture), bills!inner(state, last_action_at, active)")
      .eq("bills.active", true)
      .gte("bills.last_action_at", cutoff30);
    if (viewerState) q = q.eq("bills.state", viewerState);
    const { data } = await q;
    type Row = {
      bill_clusters: { slug: string; name: string; posture: string } | Array<{ slug: string; name: string; posture: string }> | null;
      bills: { state: string } | Array<{ state: string }> | null;
    };
    const norm = <T,>(x: T | T[] | null): T | null => Array.isArray(x) ? x[0] ?? null : x;
    const agg = new Map<string, ActiveOp & { state_set: Set<string> }>();
    for (const r of (data ?? []) as Row[]) {
      const cl = norm(r.bill_clusters);
      const bl = norm(r.bills);
      if (!cl || !bl) continue;
      const cur = agg.get(cl.slug) ?? {
        slug: cl.slug, name: cl.name, posture: cl.posture,
        bills: 0, states: 0, state_set: new Set<string>(),
      };
      cur.bills += 1;
      cur.state_set.add(bl.state);
      agg.set(cl.slug, cur);
    }
    activeOps = [...agg.values()]
      .map((x) => ({ slug: x.slug, name: x.name, posture: x.posture, bills: x.bills, states: x.state_set.size }))
      .sort((a, b) => b.bills - a.bills);
  } catch { /* defensive */ }

  // ── 4. Open campaigns in state — surface as the "do this now" CTA
  type OpenCampaign = { slug: string; title: string; blurb: string | null; state: string | null };
  let openCampaigns: OpenCampaign[] = [];
  try {
    let q = sb.from("campaigns")
      .select("slug, title, blurb, state")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(6);
    if (viewerState) q = q.or(`state.is.null,state.eq.${viewerState}`);
    const { data } = await q;
    openCampaigns = (data ?? []) as OpenCampaign[];
  } catch { /* defensive */ }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const greeting = viewerName?.trim()
    ? `Good morning, ${viewerName.trim().split(" ")[0]}`
    : viewerState
    ? `Today in ${viewerState}`
    : "Today across the platform";

  const isEmpty =
    stateAlerts.length === 0 &&
    watchedBills.length === 0 &&
    activeOps.length === 0 &&
    openCampaigns.length === 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Daily brief
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{greeting}</h1>
        <p className="mt-2 text-sm text-zinc-400">{today}</p>
        {!user && (
          <p className="mt-3 rounded-md border border-amber-700/40 bg-amber-950/10 p-3 text-[11px] text-amber-200">
            💡 <Link href="/login" className="font-semibold underline">Sign in</Link> for a state-scoped, watched-bill-aware version. Anon sees national-scope signals only.
          </p>
        )}
      </header>

      {isEmpty && (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-6 text-center text-sm text-zinc-400">
          Nothing requiring attention right now in your scope. Quiet is good.
        </p>
      )}

      {/* 1. Action CTAs */}
      {(openCampaigns.length > 0 || activeOps.length > 0) && (
        <section className="mb-8 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-emerald-300">
            ⚡ Do this now
          </h2>
          <ul className="space-y-2">
            {openCampaigns.slice(0, 3).map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/campaigns/${c.slug}`}
                  className="block rounded-md border border-emerald-700/30 bg-emerald-950/10 px-3 py-2 text-[12px] hover:border-emerald-500"
                >
                  <div className="font-semibold text-emerald-100">📨 {c.title}</div>
                  {c.blurb && <div className="mt-0.5 text-[11px] text-zinc-400">{c.blurb}</div>}
                </Link>
              </li>
            ))}
            {activeOps.slice(0, 3).map((op) => (
              <li key={op.slug}>
                <Link
                  href={`/campaigns/operation/${op.slug}`}
                  className="block rounded-md border border-rose-700/30 bg-rose-950/10 px-3 py-2 text-[12px] hover:border-rose-500"
                >
                  <div className="font-semibold text-rose-100">
                    🕸 Respond to {op.name.split("—")[0].trim().split("(")[0].trim()}
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-400">
                    <strong>{op.bills}</strong> active bill{op.bills === 1 ? "" : "s"}
                    {op.states > 1 && <> across <strong>{op.states}</strong> states</>}
                    {" "}in the last 30 days
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 2. State alerts */}
      {stateAlerts.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-red-300">
            🚨 {viewerState ? `${viewerState} alerts` : "Critical alerts"} · last {ALERT_HORIZON} days
          </h2>
          <ul className="space-y-2">
            {stateAlerts.map((a) => {
              const daysAgo = Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86_400_000);
              return (
                <li key={a.id} className={`rounded border px-3 py-2 text-[11px] ${
                  a.severity === "critical"
                    ? "border-red-700/40 bg-red-950/10 text-red-100"
                    : "border-amber-700/30 bg-amber-950/10 text-amber-100"
                }`}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span>{a.severity === "critical" ? "🚨" : "⚠️"}</span>
                    <span className="font-mono text-[9px] uppercase text-zinc-400">{a.locality}</span>
                    <span className="font-semibold">{a.title}</span>
                    <span className="ml-auto text-[10px] text-zinc-500">
                      {daysAgo === 0 ? "today" : daysAgo === 1 ? "1d ago" : `${daysAgo}d ago`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] text-zinc-500">
            Full alert feed at <Link href="/pulse" className="text-emerald-400 hover:underline">/pulse</Link>.
          </p>
        </section>
      )}

      {/* 3. Watched-bill movements */}
      {watchedBills.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
            📋 Watched bills · moved in last {ALERT_HORIZON} days
          </h2>
          <ul className="space-y-1.5">
            {watchedBills.map((b) => (
              <li key={b.id}>
                <Link href={`/bills/${b.id}`} className="block rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px] hover:border-emerald-500">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono font-semibold text-zinc-100">{b.state} {b.bill_number}</span>
                    {b.kratom_relevance === "anti" && (
                      <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-[10px] text-red-300">Anti</span>
                    )}
                    {b.kratom_relevance === "pro" && (
                      <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300">Pro</span>
                    )}
                    {b.status && <span className="text-[10px] text-zinc-500">[{b.status}]</span>}
                    {b.last_action_at && (
                      <span className="ml-auto text-[10px] text-zinc-500">{b.last_action_at}</span>
                    )}
                  </div>
                  {b.title && <p className="mt-0.5 text-[11px] text-zinc-300">{b.title.slice(0, 100)}{b.title.length > 100 ? "…" : ""}</p>}
                  {b.last_action && <p className="mt-0.5 text-[10px] text-zinc-500">{b.last_action}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {user && watchedBills.length === 0 && (
        <section className="mb-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-400">
          <p className="font-semibold text-zinc-300">📋 You aren&apos;t watching any bills.</p>
          <p className="mt-1">
            Visit any <Link href="/bills" className="text-emerald-400 hover:underline">bill page</Link> and click &quot;Watch&quot; — the brief will surface status changes here when they happen.
          </p>
        </section>
      )}

      {/* 4. Active operations */}
      {activeOps.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
            🕸 {viewerState ? `Active operations in ${viewerState}` : "Most active operations"} · last 30 days
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {activeOps.slice(0, 6).map((op) => (
              <li key={op.slug}>
                <Link href={`/intel/operations/${op.slug}`} className="block rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px] hover:border-emerald-500">
                  <div className="font-semibold text-zinc-100">
                    {op.name.split("—")[0].trim().split("(")[0].trim()}
                  </div>
                  <div className="mt-0.5 text-[10px] text-zinc-400">
                    <strong className="font-mono text-zinc-200">{op.bills}</strong> bill{op.bills === 1 ? "" : "s"}
                    {op.states > 1 && (
                      <> · <strong className="font-mono text-zinc-200">{op.states}</strong> states</>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[10px] text-zinc-500">
        <p>
          <strong className="text-zinc-300">MVP brief.</strong> Live-computed every visit. Push delivery + daily snapshot history coming next — when shipped, you&apos;ll see today&apos;s brief in your phone&apos;s notifications without opening the site.
        </p>
      </footer>
    </div>
  );
}
