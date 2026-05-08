import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Pulse — live policy feed" };
// Force dynamic so newly-inserted alerts and breaking events appear on
// next refresh — the alerts table is the live war room and stale page
// caches there hurt advocacy speed.
export const dynamic = "force-dynamic";

type Alert = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  locality: string;
  source_url: string | null;
  campaign_id: string | null;
  occurs_at: string | null;
  expires_at: string | null;
  created_at: string;
  bill_id: string | null;
};
type Campaign = {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  state: string | null;
  active: boolean;
  mobilization_type: string | null;
  ends_at: string | null;
};
type Briefing = { slug: string; title: string; subtitle: string | null; published: string | null };

const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  bill_event:        { label: "Legislation", cls: "bg-emerald-950/40 text-emerald-300 border-emerald-700/40" },
  bop_hearing:       { label: "BoP",         cls: "bg-purple-950/40 text-purple-300 border-purple-700/40" },
  ag_enforcement:    { label: "AG Action",   cls: "bg-amber-950/40 text-amber-300 border-amber-700/40" },
  fda_action:        { label: "FDA",         cls: "bg-amber-950/40 text-amber-300 border-amber-700/40" },
  dea_action:        { label: "DEA",         cls: "bg-red-950/40 text-red-300 border-red-700/40" },
  court_ruling:      { label: "Court",       cls: "bg-blue-950/40 text-blue-300 border-blue-700/40" },
  news_break:        { label: "News",        cls: "bg-zinc-900 text-zinc-300 border-zinc-700" },
  intel_tip:         { label: "Intel tip",   cls: "bg-pink-950/40 text-pink-300 border-pink-700/40" },
  scraper_stale:     { label: "Pipeline",    cls: "bg-zinc-900 text-zinc-500 border-zinc-800" },
  briefing_published: { label: "Briefing",   cls: "bg-emerald-950/40 text-emerald-300 border-emerald-700/40" },
};

const SEV_DOT: Record<string, string> = {
  critical: "bg-red-500 animate-pulse",
  alert: "bg-amber-400",
  watch: "bg-emerald-400",
  routine: "bg-zinc-600",
};

export default async function PulsePage() {
  const supabase = await createClient();

  // Pull alerts. Severity-gated zones (critical / alert / watch). We
  // don't expose 'routine' on the main feed — too noisy.
  const { data: alertsRaw } = await supabase
    .from("policy_alerts")
    .select("id, kind, severity, title, body, locality, source_url, campaign_id, occurs_at, expires_at, created_at, bill_id")
    .eq("moderation_status", "approved")
    .in("severity", ["critical", "alert", "watch"])
    .order("severity", { ascending: false }) // alphabetic — critical before watch — close enough
    .order("created_at", { ascending: false })
    .limit(40);
  const alerts = (alertsRaw ?? []) as Alert[];

  const critical = alerts.filter((a) => a.severity === "critical");
  const alert = alerts.filter((a) => a.severity === "alert");
  const watch = alerts.filter((a) => a.severity === "watch");

  // Active campaigns linked to alerts (the ones we just auto-generated)
  const alertCampaignIds = alerts.map((a) => a.campaign_id).filter(Boolean) as string[];
  const { data: alertCampaigns } = alertCampaignIds.length
    ? await supabase
        .from("campaigns")
        .select("id, slug, title, blurb, state, active, mobilization_type, ends_at")
        .in("id", alertCampaignIds)
    : { data: [] as Campaign[] };

  // Other active campaigns (bill-driven, hand-built) — top 5 by recency
  const { data: otherCampaigns } = await supabase
    .from("campaigns")
    .select("id, slug, title, blurb, state, active, mobilization_type, ends_at")
    .eq("active", true)
    .not("id", "in", `(${alertCampaignIds.length ? alertCampaignIds.map((id) => `"${id}"`).join(",") : '""'})`)
    .order("created_at", { ascending: false })
    .limit(5);

  // Briefings — auto-discovered from src/content/briefings/
  const briefingsDir = path.join(process.cwd(), "src", "content", "briefings");
  const briefings: Briefing[] = fs.existsSync(briefingsDir)
    ? fs
        .readdirSync(briefingsDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => {
          const { data } = matter(fs.readFileSync(path.join(briefingsDir, f), "utf8"));
          // gray-matter parses unquoted YAML dates as Date objects;
          // coerce at the boundary so JSX never renders a raw Date.
          const toStr = (v: unknown): string | null => {
            if (v == null) return null;
            if (v instanceof Date) return v.toISOString().slice(0, 10);
            return String(v);
          };
          return {
            slug: f.replace(/\.md$/, ""),
            title: toStr(data.title) ?? f,
            subtitle: toStr(data.subtitle),
            published: toStr(data.published),
          };
        })
        .sort((a, b) => (a.published && b.published ? (a.published < b.published ? 1 : -1) : 0))
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            ◉ live policy feed
          </p>
          <h1 className="mt-2 text-4xl font-bold leading-tight">Pulse</h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Every kratom-policy event the platform is tracking — federal, state,
            board-of-pharmacy, news, and advocate intel — sorted by urgency.
            Action campaigns are linked directly from each alert.
          </p>
        </div>
        <div className="hidden flex-col items-end gap-2 sm:flex">
          <a
            href="/alerts/submit"
            className="rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-500 hover:bg-emerald-950/40"
          >
            + Submit a tip
          </a>
          <span className="text-[10px] font-mono text-zinc-600">
            synced {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC
          </span>
        </div>
      </header>

      <div className="mb-6 flex sm:hidden">
        <a
          href="/alerts/submit"
          className="block w-full rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-2 text-center text-sm font-semibold text-emerald-300 transition hover:border-emerald-500 hover:bg-emerald-950/40"
        >
          + Submit a tip
        </a>
      </div>

      {alerts.length === 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
          <p className="text-sm text-zinc-400">No active policy events right now.</p>
          <p className="mt-1 text-xs text-zinc-600">
            New alerts surface here automatically as the news + bill pipeline catches them.
          </p>
        </div>
      )}

      {critical.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-red-300">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            Today&apos;s breaking
            <span className="text-[10px] font-normal normal-case text-zinc-500">
              · upcoming votes / hearings / urgent decisions
            </span>
          </h2>
          <div className="space-y-3">
            {critical.map((a) => (
              <AlertCard key={a.id} alert={a} campaign={alertCampaigns?.find((c) => c.id === a.campaign_id) as Campaign | undefined} />
            ))}
          </div>
        </section>
      )}

      {alert.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-amber-300">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
            This week
            <span className="text-[10px] font-normal normal-case text-zinc-500">
              · recent decisions, near-term events
            </span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {alert.map((a) => (
              <AlertCard key={a.id} alert={a} campaign={alertCampaigns?.find((c) => c.id === a.campaign_id) as Campaign | undefined} compact />
            ))}
          </div>
        </section>
      )}

      {(otherCampaigns ?? []).length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-emerald-300">
            Active campaigns
          </h2>
          <ul className="space-y-2">
            {(otherCampaigns ?? []).map((c) => (
              <li key={c.id}>
                <a
                  href={`/campaigns/${c.slug}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 hover:border-emerald-500"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-zinc-100">{c.title}</span>
                    {c.blurb && <span className="ml-2 text-xs text-zinc-500">{c.blurb}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-emerald-400">Open →</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {briefings.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-400">
            Background briefings
          </h2>
          <ul className="space-y-2">
            {briefings.map((b) => (
              <li key={b.slug}>
                <a
                  href={`/briefings/${b.slug}`}
                  className="block rounded-md border border-zinc-800 bg-zinc-950/40 p-3 hover:border-emerald-500"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {b.published && <span className="font-mono text-zinc-500">{b.published}</span>}
                    <span className="font-semibold text-zinc-100">{b.title}</span>
                  </div>
                  {b.subtitle && <p className="mt-1 text-xs text-zinc-500">{b.subtitle}</p>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {watch.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-emerald-400">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            Watch list
            <span className="text-[10px] font-normal normal-case text-zinc-500">
              · ongoing context, monitor
            </span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {watch.map((a) => (
              <AlertCard key={a.id} alert={a} compact />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AlertCard({ alert, campaign, compact }: { alert: Alert; campaign?: Campaign; compact?: boolean }) {
  const kindMeta = KIND_BADGE[alert.kind] ?? KIND_BADGE.news_break;
  const sevDot = SEV_DOT[alert.severity] ?? "bg-zinc-600";
  const occursDate = alert.occurs_at ? new Date(alert.occurs_at).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) : null;

  return (
    <article
      className={`rounded-lg border p-4 ${
        alert.severity === "critical"
          ? "border-red-700/50 bg-red-950/10"
          : alert.severity === "alert"
          ? "border-amber-700/40 bg-amber-950/10"
          : "border-zinc-800 bg-zinc-950/40"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${sevDot}`} />
        <span className={`rounded border px-2 py-0.5 font-mono uppercase ${kindMeta.cls}`}>
          {kindMeta.label}
        </span>
        <span className="font-mono text-zinc-500">{alert.locality}</span>
        {occursDate && <span className="text-zinc-500">{occursDate}</span>}
      </div>
      <h3 className={`font-semibold leading-snug ${compact ? "text-sm" : "text-base"}`}>
        {alert.title}
      </h3>
      {!compact && alert.body && (
        <p className="mt-2 line-clamp-3 text-sm text-zinc-400">
          {alert.body.split(/\n+/).find((p) => p.trim().length > 0)?.replace(/^\*\*[^*]+\*\*:?\s*/, "")}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {campaign?.active ? (
          <a
            href={`/campaigns/${campaign.slug}`}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            ⚡ Take action →
          </a>
        ) : campaign ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-700/40 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-300">
            campaign in admin review
          </span>
        ) : null}
        {alert.bill_id && (
          <a
            href={`/bills/${alert.bill_id}`}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
          >
            View bill
          </a>
        )}
        {alert.source_url && (
          <a
            href={alert.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
          >
            Source ↗
          </a>
        )}
      </div>
    </article>
  );
}
