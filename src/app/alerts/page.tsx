import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Alert archive — every policy signal | iKratom",
  description:
    "The full searchable archive of kratom policy alerts: bill movements, BoP hearings, FDA/DEA actions, and verified field intel.",
};

/**
 * /alerts — the archive the 404 left missing. /pulse is the live 30-day
 * war-room view; this is the FULL filterable history. Every card links
 * to /alerts/[id] (which carries the campaign CTA, bill card, and clean
 * source link). Filters via query params: ?state=XX&severity=critical.
 */
const SEVERITY_TONE: Record<string, string> = {
  critical: "border-red-700/60 bg-red-950/20 text-red-300",
  alert: "border-amber-700/50 bg-amber-950/15 text-amber-300",
  watch: "border-sky-700/40 bg-sky-950/10 text-sky-300",
  routine: "border-zinc-700 bg-zinc-950/40 text-zinc-400",
};
const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🚨", alert: "⚠️", watch: "👁", routine: "·",
};
const KIND_LABEL: Record<string, string> = {
  bill_event: "Bill movement",
  bop_hearing: "BoP hearing",
  fda_action: "FDA",
  dea_action: "DEA",
  news_break: "Breaking news",
  intel_tip: "Field intel",
  briefing_published: "Briefing",
};

type AlertRow = {
  id: string; kind: string; severity: string; title: string;
  locality: string | null; bill_id: string | null; campaign_id: string | null;
  source_url: string | null; occurs_at: string | null; created_at: string;
};

export default async function AlertArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; severity?: string }>;
}) {
  const params = await searchParams;
  const stateFilter = (params.state ?? "").toUpperCase().slice(0, 2);
  const sevFilter = ["critical", "alert", "watch", "routine"].includes(params.severity ?? "")
    ? params.severity
    : "";

  const sb = await createClient();
  let q = sb
    .from("policy_alerts")
    .select("id, kind, severity, title, locality, bill_id, campaign_id, source_url, occurs_at, created_at")
    .eq("moderation_status", "approved")
    .order("created_at", { ascending: false })
    .limit(200);
  if (/^[A-Z]{2}$/.test(stateFilter)) q = q.ilike("locality", `%${stateFilter}%`);
  if (sevFilter) q = q.eq("severity", sevFilter);
  const { data } = await q;
  const alerts = (data ?? []) as AlertRow[];

  // Distinct states present (for the filter strip) — derived from data,
  // truthful to what actually exists.
  const states = [...new Set(
    alerts.map((a) => (a.locality?.match(/\b([A-Z]{2})\b/) ?? [])[1]).filter(Boolean),
  )].sort() as string[];

  const filterHref = (s?: string, sev?: string) => {
    const p = new URLSearchParams();
    if (s) p.set("state", s);
    if (sev) p.set("severity", sev);
    const str = p.toString();
    return str ? `/alerts?${str}` : "/alerts";
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📡 Alert archive
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Every policy signal, on the record</h1>
        <p className="mt-2 text-sm text-zinc-400">
          The full history behind <Link href="/pulse" className="text-emerald-400 hover:underline">/pulse</Link> —
          bill movements, hearings, federal actions, verified field intel. Click any
          alert for its full story: linked bill, campaign, and source.
        </p>
      </header>

      {/* Filter strip */}
      <div className="mb-6 flex flex-wrap items-center gap-1.5 text-[11px]">
        <Link
          href={filterHref(undefined, sevFilter)}
          className={`rounded border px-2 py-1 ${!stateFilter ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"}`}
        >
          All states
        </Link>
        {states.map((s) => (
          <Link
            key={s}
            href={filterHref(s, sevFilter)}
            className={`rounded border px-2 py-1 font-mono ${stateFilter === s ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"}`}
          >
            {s}
          </Link>
        ))}
        <span className="mx-2 text-zinc-700">|</span>
        {["critical", "alert", "watch"].map((sev) => (
          <Link
            key={sev}
            href={filterHref(stateFilter || undefined, sevFilter === sev ? undefined : sev)}
            className={`rounded border px-2 py-1 capitalize ${sevFilter === sev ? SEVERITY_TONE[sev] : "border-zinc-800 text-zinc-400 hover:border-zinc-600"}`}
          >
            {SEVERITY_EMOJI[sev]} {sev}
          </Link>
        ))}
      </div>

      {alerts.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-6 text-center text-sm text-zinc-400">
          No alerts match this filter. <Link href="/alerts" className="text-emerald-400 hover:underline">Clear filters</Link>
        </p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id}>
              <Link
                href={`/alerts/${a.id}`}
                className="block rounded-md border border-zinc-800 bg-zinc-950/40 p-3 transition hover:border-emerald-600/60"
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`rounded border px-1.5 py-0.5 ${SEVERITY_TONE[a.severity] ?? SEVERITY_TONE.routine}`}>
                    {SEVERITY_EMOJI[a.severity] ?? "·"} {a.severity}
                  </span>
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">
                    {KIND_LABEL[a.kind] ?? a.kind}
                  </span>
                  {a.locality && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                      {a.locality.slice(0, 40)}
                    </span>
                  )}
                  <span className="ml-auto text-zinc-500">
                    {new Date(a.occurs_at ?? a.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-1.5 text-sm font-medium text-zinc-100">{a.title}</p>
                <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-zinc-500">
                  {a.bill_id && <span className="text-emerald-400">⚖ linked bill</span>}
                  {a.campaign_id && <span className="text-emerald-400">📣 has campaign</span>}
                  {a.source_url && <span>🔗 sourced</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-center text-xs text-zinc-600">
        Showing up to 200 most recent approved alerts.
        {" "}<Link href="/pulse" className="text-emerald-400 hover:underline">Live view →</Link>
      </p>
    </div>
  );
}
