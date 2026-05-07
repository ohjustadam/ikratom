import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Per-partner public dashboard.
 *
 * URL: /partners/<hostname> — e.g. /partners/example-shop.com
 *
 * Public on purpose: partners are encouraged to share their stats. We
 * only expose aggregate counts + top campaigns; never per-user identity.
 *
 * Hostname is restricted to the same regex used in proxy.ts to prevent
 * crafted URLs from probing arbitrary internals.
 */

const HOST_RE = /^[a-z0-9.-]{1,80}$/;

export const metadata = { title: "Partner stats" };

export default async function PartnerStatsPage({
  params,
}: {
  params: Promise<{ host: string }>;
}) {
  const { host: rawHost } = await params;
  const host = rawHost.toLowerCase();
  if (!HOST_RE.test(host)) notFound();

  const supabase = await createClient();
  // 30-day daily series helper
  function buildDailySeries(rows: { sent_at: string }[]): { day: string; count: number }[] {
    const buckets: Record<string, number> = {};
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      buckets[d.toISOString().slice(0, 10)] = 0;
    }
    for (const r of rows) {
      const day = r.sent_at.slice(0, 10);
      if (day in buckets) buckets[day]++;
    }
    return Object.entries(buckets).map(([day, count]) => ({ day, count }));
  }


  // Last 30 days cutoff for the activity sparkline
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();

  // All-time totals + per-method breakdown for this referrer + last-30-day series
  const [
    { count: totalActions },
    { count: emailActions },
    { count: callActions },
    byCampaign,
    last30,
    recentRows,
  ] = await Promise.all([
    supabase
      .from("campaign_actions")
      .select("id", { count: "exact", head: true })
      .eq("referred_from", host),
    supabase
      .from("campaign_actions")
      .select("id", { count: "exact", head: true })
      .eq("referred_from", host)
      .neq("method", "call"),
    supabase
      .from("campaign_actions")
      .select("id", { count: "exact", head: true })
      .eq("referred_from", host)
      .eq("method", "call"),
    // Top campaigns by referred actions (need a join — Supabase will
    // handle it via the FK)
    supabase
      .from("campaign_actions")
      .select("campaign_id, campaigns(slug, title, state)")
      .eq("referred_from", host)
      .limit(500),
    // Daily counts last 30 days
    supabase
      .from("campaign_actions")
      .select("sent_at, method")
      .eq("referred_from", host)
      .gte("sent_at", since30),
    // Last 10 actions (for the recent-activity feed)
    supabase
      .from("campaign_actions")
      .select("sent_at, method, campaigns(slug, title, state)")
      .eq("referred_from", host)
      .order("sent_at", { ascending: false })
      .limit(10),
  ]);

  // If the partner has zero actions, we still render a "preview" page
  // explaining how the widget works — it's a marketing page even before
  // they have data.
  const hasAnyActivity = (totalActions ?? 0) > 0;

  // Top-campaigns aggregation (in-memory because Supabase RPC for group-by
  // would be overkill for typical partner volumes)
  const campaignCounts = new Map<string, { count: number; title: string; slug: string; state: string | null }>();
  type Joined = { campaign_id: string | null; campaigns: { slug: string; title: string; state: string | null }[] | { slug: string; title: string; state: string | null } | null };
  for (const row of (byCampaign.data ?? []) as Joined[]) {
    if (!row.campaign_id || !row.campaigns) continue;
    // Supabase typing yields arrays for FK joins even when 1:1; normalize.
    const c = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns;
    if (!c) continue;
    const prev = campaignCounts.get(row.campaign_id);
    if (prev) {
      prev.count++;
    } else {
      campaignCounts.set(row.campaign_id, {
        count: 1,
        title: c.title,
        slug: c.slug,
        state: c.state,
      });
    }
  }
  const topCampaigns = Array.from(campaignCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <a href="/embed" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Embed widget
      </a>

      <header className="mt-3 mb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Partner stats
        </p>
        <h1 className="mt-2 text-4xl font-bold sm:text-5xl">
          {host}
        </h1>
        <p className="mt-3 text-sm text-zinc-400">
          Activity attributed to <span className="font-mono text-zinc-300">{host}</span>{" "}
          via the iKratom embed widget. Public page — share freely.
        </p>
      </header>

      {!hasAnyActivity && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/10 p-6">
          <h2 className="text-base font-semibold text-amber-300">
            No activity yet
          </h2>
          <p className="mt-2 text-sm text-zinc-300">
            Either your widget hasn&apos;t been clicked yet, or the click-through
            users haven&apos;t taken action. Once an action lands, this page
            populates automatically.
          </p>
          <p className="mt-3 text-xs text-zinc-500">
            Make sure your install snippet on{" "}
            <span className="font-mono text-zinc-300">{host}</span> looks like{" "}
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
              &lt;script src=&quot;.../email-rep.js&quot; data-state=&quot;XX&quot;&gt;&lt;/script&gt;
            </code>
            . See{" "}
            <a href="/embed" className="text-emerald-400 hover:underline">
              the embed docs
            </a>
            .
          </p>
        </div>
      )}

      {hasAnyActivity && (
        <>
          {/* Totals */}
          <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat value={totalActions ?? 0} label="Total actions" accent />
            <Stat value={emailActions ?? 0} label="Emails sent" />
            <Stat value={callActions ?? 0} label="Calls made" />
          </section>

          {/* 30-day sparkline */}
          {(() => {
            const series = buildDailySeries((last30.data ?? []) as { sent_at: string }[]);
            const max = Math.max(1, ...series.map((s) => s.count));
            const last30Total = series.reduce((a, b) => a + b.count, 0);
            return (
              <section className="mb-8">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
                  Last 30 days · {last30Total.toLocaleString()} actions
                </h2>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                  <div className="flex h-24 items-end gap-1">
                    {series.map((s) => {
                      const h = Math.round((s.count / max) * 88);
                      return (
                        <div
                          key={s.day}
                          title={`${s.day}: ${s.count} action${s.count === 1 ? "" : "s"}`}
                          className="flex-1 rounded-t bg-emerald-700/40 hover:bg-emerald-500"
                          style={{ height: `${Math.max(2, h)}px` }}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-2 flex justify-between text-[10px] text-zinc-600">
                    <span>{series[0].day.slice(5)}</span>
                    <span>{series[Math.floor(series.length / 2)].day.slice(5)}</span>
                    <span>today</span>
                  </div>
                </div>
              </section>
            );
          })()}

          {/* Recent activity feed */}
          {(recentRows.data ?? []).length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
                Recent actions
              </h2>
              <ul className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
                {(recentRows.data ?? []).map((r: { sent_at: string; method: string; campaigns: { slug: string; title: string; state: string | null }[] | { slug: string; title: string; state: string | null } | null }, i: number) => {
                  const c = Array.isArray(r.campaigns) ? r.campaigns[0] : r.campaigns;
                  return (
                    <li
                      key={i}
                      className={`flex items-center gap-3 px-4 py-2 text-sm ${
                        i > 0 ? "border-t border-zinc-900" : ""
                      }`}
                    >
                      <span className="text-zinc-500">
                        {new Date(r.sent_at).toLocaleString()}
                      </span>
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                        {r.method === "call" ? "📞 call" : "✉ email"}
                      </span>
                      {c && (
                        <a
                          href={`/campaigns/${c.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 truncate text-zinc-200 hover:text-emerald-400"
                        >
                          {c.title}
                        </a>
                      )}
                      {c?.state && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {c.state}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Top campaigns */}
          {topCampaigns.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
                Top campaigns
              </h2>
              <ul className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
                {topCampaigns.map((c, i) => (
                  <li
                    key={c.slug}
                    className={`flex items-center gap-3 px-4 py-3 ${
                      i > 0 ? "border-t border-zinc-900" : ""
                    }`}
                  >
                    <span className="font-mono text-sm tabular-nums text-emerald-300">
                      {c.count}
                    </span>
                    <a
                      href={`/campaigns/${c.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 truncate text-sm text-zinc-200 hover:text-emerald-400"
                    >
                      {c.title}
                    </a>
                    {c.state && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-zinc-400">
                        {c.state}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* About + share */}
      <section className="mt-10 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-300">
        <h2 className="mb-3 text-lg font-bold">Share these numbers</h2>
        <p className="text-zinc-400">
          This URL is public. Drop it in your customer newsletter or social
          posts: real impact attributed to your shop&apos;s footprint.
        </p>
        <div className="mt-3 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3">
          <code className="font-mono text-xs text-emerald-300">
            https://ikratom.org/partners/{host}
          </code>
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-4 text-center ${
        accent
          ? "border-emerald-700/50 bg-emerald-950/20"
          : "border-zinc-800 bg-zinc-950/40"
      }`}
    >
      <div
        className={`text-3xl font-bold tabular-nums sm:text-4xl ${
          accent ? "text-emerald-300" : "text-zinc-100"
        }`}
      >
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </div>
    </div>
  );
}
