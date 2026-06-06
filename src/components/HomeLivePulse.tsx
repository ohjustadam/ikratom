import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * Home "live pulse" strip — the latest critical/alert policy events, proving to
 * a first-time visitor that the platform is awake and watching right now (the
 * single biggest differentiator). Teaser only; the full feed is /pulse. Renders
 * nothing if there are no recent alerts (graceful, never a sad empty box).
 */
type PulseAlert = {
  id: string;
  title: string;
  severity: string;
  locality: string | null;
  created_at: string;
};

const DOT: Record<string, string> = {
  critical: "bg-red-500",
  alert: "bg-amber-500",
  watch: "bg-emerald-500",
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export async function HomeLivePulse() {
  let alerts: PulseAlert[] = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("policy_alerts")
      .select("id, title, severity, locality, created_at")
      .eq("moderation_status", "approved")
      .in("severity", ["critical", "alert"])
      .order("created_at", { ascending: false })
      .limit(4);
    alerts = (data ?? []) as PulseAlert[];
  } catch {
    return null;
  }
  if (alerts.length === 0) return null;

  return (
    <section className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live — the platform is watching right now
        </p>
        <Link href="/pulse" className="shrink-0 text-xs text-zinc-400 hover:text-emerald-400">
          Full feed →
        </Link>
      </div>
      <ul className="mt-4 divide-y divide-zinc-800/70">
        {alerts.map((a) => (
          <li key={a.id}>
            <Link href={`/alerts/${a.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-emerald-300">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[a.severity] ?? DOT.watch}`} />
              {a.locality && <span className="shrink-0 font-mono text-[11px] text-zinc-500">{a.locality}</span>}
              <span className="min-w-0 flex-1 truncate text-zinc-200">{a.title}</span>
              <span className="shrink-0 text-[11px] text-zinc-600">{timeAgo(a.created_at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
