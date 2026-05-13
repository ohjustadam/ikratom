import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type PulseEvent = {
  id: string;
  kind: "broadcast" | "alert" | "meeting_approved" | "bill_event";
  title: string;
  state: string | null;
  occurred_at: string;
  link: string;
};

/**
 * Live Policy Pulse — at-a-glance "what's happening in kratom policy
 * RIGHT NOW" across the platform.
 *
 * Sources merged + sorted by recency:
 *   - municipal_meetings broadcast in the last 24h (LIVE NOW alerts)
 *   - policy_alerts (critical/alert) auto-pushed in the last 24h
 *   - municipal_meetings approved in the last 24h (calendar adds)
 *   - bill_actions in the last 24h (status changes)
 *
 * Capped at 6 events. Tighter than ActivityRadar (which focuses on
 * forum + campaign chatter) — this is policy-event-only.
 *
 * Hides itself when nothing happened in the last 24h.
 */
export async function PolicyPulseWidget({
  userState,
}: {
  userState: string | null;
}) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [broadcasts, alerts, newMeetings, billActions] = await Promise.all([
    supabase
      .from("municipal_meetings")
      .select("id, state, locality, body_name, broadcast_at")
      .not("broadcast_at", "is", null)
      .gte("broadcast_at", since)
      .order("broadcast_at", { ascending: false })
      .limit(5),
    supabase
      .from("policy_alerts")
      .select("id, kind, severity, title, locality, auto_pushed_at, created_at")
      .eq("moderation_status", "approved")
      .in("severity", ["critical", "alert"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("municipal_meetings")
      .select("id, state, locality, body_name, meeting_at, moderation_reviewed_at")
      .eq("moderation_status", "approved")
      .gte("moderation_reviewed_at", since)
      .order("moderation_reviewed_at", { ascending: false })
      .limit(5),
    supabase
      .from("bill_actions")
      .select("id, bill_id, action, action_at, bills!inner(state, bill_number)")
      .gte("action_at", since)
      .order("action_at", { ascending: false })
      .limit(5),
  ]);

  const events: PulseEvent[] = [];

  for (const b of broadcasts.data ?? []) {
    events.push({
      id: `broadcast-${b.id}`,
      kind: "broadcast",
      title: `🚨 LIVE: ${b.locality ?? b.state} ${b.body_name ?? "meeting"} broadcast`,
      state: b.state,
      occurred_at: b.broadcast_at,
      link: `/meetings/${b.id}`,
    });
  }

  for (const a of alerts.data ?? []) {
    events.push({
      id: `alert-${a.id}`,
      kind: "alert",
      title: `${a.severity === "critical" ? "🚨" : "⚠️"} ${a.title.slice(0, 80)}`,
      state: /^[A-Z]{2}$/.test(a.locality ?? "") ? a.locality : null,
      occurred_at: a.created_at,
      link: `/pulse`,
    });
  }

  for (const m of newMeetings.data ?? []) {
    if (!m.moderation_reviewed_at) continue;
    events.push({
      id: `meeting-${m.id}`,
      kind: "meeting_approved",
      title: `📅 New: ${m.locality ?? m.state} ${m.body_name ?? "meeting"}`,
      state: m.state,
      occurred_at: m.moderation_reviewed_at,
      link: `/meetings/${m.id}`,
    });
  }

  // Bill action joins — Supabase returns the joined row as either an
  // object or single-element array depending on relation, normalize.
  type BillActionRow = { id: string; bill_id: string; action: string; action_at: string; bills: { state: string; bill_number: string } | Array<{ state: string; bill_number: string }> };
  for (const ba of ((billActions.data ?? []) as BillActionRow[])) {
    const bill = Array.isArray(ba.bills) ? ba.bills[0] : ba.bills;
    if (!bill) continue;
    events.push({
      id: `billaction-${ba.id}`,
      kind: "bill_event",
      title: `📜 ${bill.state} ${bill.bill_number} · ${ba.action.slice(0, 70)}`,
      state: bill.state,
      occurred_at: ba.action_at,
      link: `/bills/${ba.bill_id}`,
    });
  }

  events.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
  const top = events.slice(0, 6);

  if (top.length === 0) return null;

  // Highlight in-state events
  const inStateCount = userState ? top.filter((e) => e.state === userState).length : 0;

  return (
    <section className="rounded-lg border border-red-700/30 bg-red-950/10">
      <div className="flex items-end justify-between border-b border-zinc-900 px-4 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-red-300">
          ◉ Live policy pulse · last 24h
        </p>
        <Link href="/pulse" className="text-[10px] text-red-400 hover:underline">
          full feed →
        </Link>
      </div>
      <ul className="divide-y divide-zinc-900">
        {top.map((e) => {
          const isInState = e.state === userState;
          const minsAgo = Math.floor((Date.now() - new Date(e.occurred_at).getTime()) / 60_000);
          const timeLabel = minsAgo < 60
            ? `${minsAgo}m ago`
            : minsAgo < 1440
            ? `${Math.floor(minsAgo / 60)}h ago`
            : `${Math.floor(minsAgo / 1440)}d ago`;
          return (
            <li key={e.id} className={`px-4 py-2.5 text-sm ${isInState ? "border-l-2 border-l-emerald-500" : ""}`}>
              <Link href={e.link} className="flex items-start gap-2 hover:bg-zinc-950/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-zinc-100">{e.title}</p>
                  <div className="flex items-baseline gap-2 text-[10px] text-zinc-500">
                    {e.state && (
                      <span className={`rounded px-1 font-mono ${isInState ? "bg-emerald-900/40 text-emerald-300" : "bg-zinc-900 text-zinc-400"}`}>
                        {e.state}
                      </span>
                    )}
                    <span>{timeLabel}</span>
                    {isInState && <span className="font-bold text-emerald-400">YOUR STATE</span>}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {inStateCount > 0 && (
        <div className="border-t border-zinc-900 px-4 py-2 text-[10px] text-emerald-300">
          {inStateCount} event{inStateCount === 1 ? "" : "s"} in {userState} · <Link href={`/pulse?state=${userState}`} className="hover:underline">filter to {userState} →</Link>
        </div>
      )}
    </section>
  );
}
