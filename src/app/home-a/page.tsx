import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata = { title: "iKratom — Field Intelligence" };
export const dynamic = "force-dynamic";

/**
 * HOME PAGE DRAFT A — "INTEL / WAR ROOM" direction.
 *
 * Voice: nonpartisan field-intelligence service. Imagine a briefing
 * board hung in a hallway at 6am — not advertising, just laying out
 * what's happening today and where attention is needed.
 *
 * Strengths: trustworthy, doesn't shout, treats the visitor as an
 * adult, conveys the platform's depth at a glance.
 * Risks: skews "serious" — might feel cold to first-time advocates
 * looking for community.
 */
export default async function HomeA() {
  const supabase = await createClient();
  const today = new Date();

  const [
    { count: activeBills },
    { count: critical },
    { count: actions },
    { count: campaigns },
    { count: members },
    { data: recentAlerts },
    { data: recentBills },
  ] = await Promise.all([
    supabase.from("bills").select("id", { count: "exact", head: true })
      .eq("active", true).in("kratom_relevance", ["anti", "pro"]),
    supabase.from("policy_alerts").select("id", { count: "exact", head: true })
      .in("severity", ["alert", "critical"]).eq("moderation_status", "approved"),
    supabase.from("campaign_actions").select("id", { count: "exact", head: true }),
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("policy_alerts")
      .select("id, title, severity, locality, created_at")
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false })
      .limit(4),
    supabase.from("bills")
      .select("id, state, bill_number, title, status, last_action_at, kratom_relevance")
      .eq("active", true).in("kratom_relevance", ["anti", "pro"])
      .order("last_action_at", { ascending: false, nullsFirst: false })
      .limit(5),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 font-mono sm:px-6 lg:px-8">
      {/* Header strip — looks like a daily briefing letterhead */}
      <header className="border-b border-zinc-800 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-[10px] tracking-[0.4em] text-emerald-500">
              IKRATOM • FIELD INTELLIGENCE • CONFIDENCE: PUBLIC
            </p>
            <h1 className="mt-2 font-sans text-3xl font-bold sm:text-4xl">
              Daily kratom-policy briefing
            </h1>
            <p className="mt-1 font-sans text-sm text-zinc-400">
              {today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <Link href="/signup" className="rounded bg-emerald-500 px-3 py-1.5 font-bold text-zinc-950 hover:bg-emerald-400">
              ENLIST →
            </Link>
            <Link href="/pulse" className="rounded border border-zinc-700 px-3 py-1.5 hover:border-emerald-500">
              FULL PULSE
            </Link>
          </div>
        </div>
      </header>

      {/* Counters — at-a-glance situational awareness */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Counter label="Active bills" value={activeBills ?? 0} />
        <Counter label="Critical alerts" value={critical ?? 0} tone={(critical ?? 0) > 0 ? "warn" : "ok"} />
        <Counter label="Live campaigns" value={campaigns ?? 0} />
        <Counter label="Actions sent" value={actions ?? 0} />
        <Counter label="Advocates" value={members ?? 0} />
      </section>

      {/* Today's flagged */}
      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-zinc-500">▮ TODAY&apos;S FLAGGED</p>
          <ul className="mt-3 space-y-2">
            {(recentAlerts ?? []).map((a) => (
              <li key={a.id} className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    a.severity === "critical" ? "bg-red-500 text-zinc-950" :
                    a.severity === "alert" ? "bg-amber-500 text-zinc-950" :
                    "bg-zinc-800 text-zinc-400"
                  }`}>
                    {a.severity}
                  </span>
                  <span className="text-zinc-500">{a.locality}</span>
                  <span className="ml-auto text-zinc-600">{new Date(a.created_at).toLocaleDateString()}</span>
                </div>
                <p className="mt-1 font-sans leading-snug text-zinc-200">{a.title}</p>
              </li>
            ))}
            {(recentAlerts?.length ?? 0) === 0 && (
              <li className="rounded border border-emerald-700/40 bg-emerald-950/10 p-3 text-xs text-emerald-300">
                Nothing flagged in the last 24 hours.
              </li>
            )}
          </ul>
        </div>

        <div>
          <p className="text-[10px] tracking-[0.3em] text-zinc-500">▮ MOVING THIS WEEK</p>
          <ul className="mt-3 space-y-2">
            {(recentBills ?? []).map((b) => (
              <li key={b.id} className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">{b.state}</span>
                  <span className="font-bold text-zinc-100">{b.bill_number}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    b.kratom_relevance === "anti" ? "bg-red-950/60 text-red-300" : "bg-emerald-950/60 text-emerald-300"
                  }`}>
                    {b.kratom_relevance === "anti" ? "RESTRICTIVE" : "SUPPORTIVE"}
                  </span>
                  <span className="ml-auto text-zinc-500">{b.status}</span>
                </div>
                <p className="mt-1 line-clamp-2 font-sans leading-snug text-zinc-300">{b.title}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Mission card — the "what is this" pitch in field-intel voice */}
      <section className="mt-12 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 font-sans">
        <p className="text-[10px] tracking-[0.3em] text-emerald-500">▮ MISSION</p>
        <p className="mt-3 text-lg leading-relaxed text-zinc-200">
          iKratom is the war room for organized kratom advocacy. We track every bill,
          every BoP hearing, every news event across all 50 states + the federal
          stack. When something critical hits — a city ordinance, an FDA warning, a
          floor vote with hours notice — you get a one-click action ready to send
          from your real address. Free. Nonpartisan. No org politics.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 text-xs">
          <Link href="/signup" className="rounded bg-emerald-500 px-4 py-2 font-bold text-zinc-950 hover:bg-emerald-400">
            Create your account →
          </Link>
          <Link href="/how-it-works" className="rounded border border-zinc-700 px-4 py-2 hover:border-emerald-500">
            How it works
          </Link>
          <Link href="/communities" className="rounded border border-zinc-700 px-4 py-2 hover:border-emerald-500">
            Find your people
          </Link>
        </div>
      </section>

      <p className="mt-8 text-center text-[10px] text-zinc-600">
        Data refreshed hourly via OpenStates, LegiScan, Google News RSS, and our own field reporters.
      </p>
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  return (
    <div className={`rounded border bg-zinc-950 p-3 ${
      tone === "warn" ? "border-amber-700/40" : "border-zinc-800"
    }`}>
      <div className="text-[9px] tracking-[0.2em] text-zinc-500">{label.toUpperCase()}</div>
      <div className={`mt-1 font-mono text-2xl font-bold ${tone === "warn" ? "text-amber-300" : "text-zinc-100"}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
