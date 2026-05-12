import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Kratom policy calendar — every public event we know about",
  description: "Upcoming city, county, state, and federal events affecting kratom policy. Zoom links, public-comment signups, hearing schedules.",
};
export const dynamic = "force-dynamic";

type Event = {
  kind: "municipal" | "alert" | "bill_action" | "state_session";
  date: Date;
  end_date?: Date | null;
  title: string;
  body?: string | null;
  state: string | null;
  locality?: string | null;
  zoom_url?: string | null;
  livestream_url?: string | null;
  agenda_url?: string | null;
  public_comment_url?: string | null;
  in_person_address?: string | null;
  source_url?: string | null;
  detail_href?: string | null;
  severity?: string | null;
};

const KIND_BADGE: Record<string, { emoji: string; label: string; cls: string }> = {
  municipal: { emoji: "🏛️", label: "City/county", cls: "bg-amber-950/30 text-amber-300 border-amber-700/40" },
  alert: { emoji: "🚨", label: "Policy alert", cls: "bg-red-950/30 text-red-300 border-red-700/40" },
  bill_action: { emoji: "📜", label: "Bill action", cls: "bg-blue-950/30 text-blue-300 border-blue-700/40" },
  state_session: { emoji: "🏛️", label: "State session", cls: "bg-emerald-950/30 text-emerald-300 border-emerald-700/40" },
};

export default async function CalendarPage({ searchParams }: {
  searchParams?: Promise<{ state?: string; kind?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const stateFilter = sp.state?.toUpperCase() ?? null;
  const kindFilter = sp.kind ?? null;

  const sb = await createClient();
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * 86_400_000);  // next 90 days

  // Pull from multiple sources in parallel
  const [meetings, alerts, billActions, sessions] = await Promise.all([
    sb.from("municipal_meetings")
      .select("id, state, locality, body_name, meeting_at, format, zoom_url, livestream_url, agenda_url, agenda_text, in_person_address, public_comment_signup_url, source_url")
      .eq("moderation_status", "approved")
      .gte("meeting_at", now.toISOString())
      .lte("meeting_at", horizon.toISOString())
      .order("meeting_at", { ascending: true }),
    sb.from("policy_alerts")
      .select("id, kind, severity, title, body, locality, source_url, occurs_at")
      .eq("moderation_status", "approved")
      .not("occurs_at", "is", null)
      .gte("occurs_at", now.toISOString())
      .lte("occurs_at", horizon.toISOString())
      .in("severity", ["critical", "alert"])
      .order("occurs_at", { ascending: true }),
    sb.from("bills")
      .select("id, state, bill_number, title, last_action, last_action_at, kratom_relevance, status")
      .eq("active", true)
      .in("kratom_relevance", ["anti", "pro"])
      .not("last_action_at", "is", null)
      .gte("last_action_at", new Date(now.getTime() - 14 * 86_400_000).toISOString())
      .order("last_action_at", { ascending: false })
      .limit(80),
    sb.from("state_capital_info")
      .select("state, current_session_id, current_session_start, current_session_end, capital_city, legislature_url, hearing_schedule_url"),
  ]);

  const events: Event[] = [];

  for (const m of meetings.data ?? []) {
    events.push({
      kind: "municipal",
      date: new Date(m.meeting_at),
      title: `${m.locality ?? "(locality)"} · ${m.body_name ?? "Public meeting"}`,
      body: m.agenda_text,
      state: m.state,
      locality: m.locality,
      zoom_url: m.zoom_url,
      livestream_url: m.livestream_url,
      agenda_url: m.agenda_url,
      public_comment_url: m.public_comment_signup_url,
      in_person_address: m.in_person_address,
      source_url: m.source_url,
    });
  }

  for (const a of alerts.data ?? []) {
    events.push({
      kind: "alert",
      date: new Date(a.occurs_at!),
      title: a.title,
      body: a.body?.split("\n")[0] ?? null,
      state: /^[A-Z]{2}$/.test(a.locality ?? "") ? a.locality : null,
      locality: a.locality,
      source_url: a.source_url,
      detail_href: `/pulse`,
      severity: a.severity,
    });
  }

  // Recent bill actions surface for advocates who want to track current legislative motion
  for (const b of billActions.data ?? []) {
    if (!b.last_action_at) continue;
    events.push({
      kind: "bill_action",
      date: new Date(b.last_action_at),
      title: `${b.state} ${b.bill_number} · ${b.last_action ?? b.status ?? "action"}`,
      body: b.title ? b.title.slice(0, 200) : null,
      state: b.state,
      detail_href: `/bills/${b.id}`,
    });
  }

  // State sessions — show start and end dates if upcoming
  for (const s of sessions.data ?? []) {
    if (s.current_session_start) {
      const start = new Date(s.current_session_start);
      if (start.getTime() > now.getTime() && start.getTime() < horizon.getTime()) {
        events.push({
          kind: "state_session",
          date: start,
          title: `${s.state} legislative session begins`,
          body: `${s.capital_city ?? "?"} · ${s.current_session_id ?? "?"}`,
          state: s.state,
          source_url: s.legislature_url,
        });
      }
    }
    if (s.current_session_end) {
      const end = new Date(s.current_session_end);
      if (end.getTime() > now.getTime() && end.getTime() < horizon.getTime()) {
        events.push({
          kind: "state_session",
          date: end,
          title: `${s.state} legislative session ends — last day to act`,
          body: `${s.capital_city ?? "?"} · ${s.current_session_id ?? "?"}`,
          state: s.state,
          source_url: s.legislature_url,
        });
      }
    }
  }

  // Apply filters + sort by date
  let filtered = events;
  if (stateFilter) filtered = filtered.filter((e) => e.state === stateFilter);
  if (kindFilter) filtered = filtered.filter((e) => e.kind === kindFilter);
  filtered.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Group by day for the list view
  const groups = new Map<string, Event[]>();
  for (const e of filtered) {
    const dayKey = e.date.toISOString().slice(0, 10);
    if (!groups.has(dayKey)) groups.set(dayKey, []);
    groups.get(dayKey)!.push(e);
  }

  // Counts for filter pills
  const stateOptions = [...new Set(events.map((e) => e.state).filter(Boolean) as string[])].sort();
  const counts = {
    municipal: events.filter((e) => e.kind === "municipal").length,
    alert: events.filter((e) => e.kind === "alert").length,
    bill_action: events.filter((e) => e.kind === "bill_action").length,
    state_session: events.filter((e) => e.kind === "state_session").length,
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📅 Kratom policy calendar
        </p>
        <h1 className="mt-2 text-3xl font-bold">Every event we know about</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          City council meetings · Board of Pharmacy hearings · bill action dates ·
          legislative session bookends. Join by Zoom, livestream, in-person, or
          phone — links + addresses below.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Found something we missed? Drop the URL in <Link href="/alerts/submit" className="text-emerald-400 hover:underline">intel-tip</Link>.
        </p>
      </header>

      {/* Filter pills */}
      <div className="mb-4 space-y-2">
        <nav className="flex flex-wrap gap-2 text-xs">
          <FilterPill label={`All kinds (${events.length})`} href={`/calendar${stateFilter ? `?state=${stateFilter}` : ""}`} active={!kindFilter} />
          {Object.entries(counts).map(([k, n]) => n > 0 && (
            <FilterPill
              key={k}
              label={`${KIND_BADGE[k].emoji} ${KIND_BADGE[k].label} (${n})`}
              href={`/calendar?kind=${k}${stateFilter ? `&state=${stateFilter}` : ""}`}
              active={kindFilter === k}
            />
          ))}
        </nav>
        {stateOptions.length > 0 && (
          <nav className="flex flex-wrap gap-2 text-xs">
            <FilterPill label="All states" href={`/calendar${kindFilter ? `?kind=${kindFilter}` : ""}`} active={!stateFilter} />
            {stateOptions.map((s) => (
              <FilterPill
                key={s}
                label={s}
                href={`/calendar?state=${s}${kindFilter ? `&kind=${kindFilter}` : ""}`}
                active={stateFilter === s}
              />
            ))}
          </nav>
        )}
      </div>

      {/* Day-grouped list */}
      {groups.size === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-10 text-center">
          <p className="text-3xl">📅</p>
          <p className="mt-2 text-sm text-zinc-400">
            No events match the current filter in the next 90 days.
          </p>
          {(stateFilter || kindFilter) && (
            <Link href="/calendar" className="mt-3 inline-block text-xs text-emerald-400 hover:underline">
              Clear filters →
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([day, es]) => {
            const dayDate = new Date(day + "T00:00:00");
            const days = Math.ceil((dayDate.getTime() - now.getTime()) / 86_400_000);
            const isToday = days === 0;
            return (
              <section key={day}>
                <h2 className="mb-2 flex items-baseline gap-3 border-b border-zinc-800 pb-1">
                  <span className="text-base font-bold text-zinc-100">
                    {dayDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {isToday ? "today" : days === 1 ? "tomorrow" : `in ${days}d`}
                  </span>
                </h2>
                <ul className="space-y-2">
                  {es.map((e, i) => {
                    const meta = KIND_BADGE[e.kind];
                    return (
                      <li key={i} className={`rounded-md border p-3 ${
                        e.severity === "critical" ? "border-red-700/50 bg-red-950/10" : "border-zinc-800 bg-zinc-950/40"
                      }`}>
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.cls}`}>
                            {meta.emoji} {meta.label}
                          </span>
                          {e.state && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">{e.state}</span>}
                          <span className="text-[11px] text-zinc-500">
                            {e.date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                          </span>
                          {e.severity === "critical" && <span className="text-[10px] font-bold uppercase text-red-400 animate-pulse">CRITICAL</span>}
                        </div>
                        <h3 className="mt-1 text-sm font-semibold text-zinc-100">{e.title}</h3>
                        {e.body && (
                          <p className="mt-1 line-clamp-3 text-xs text-zinc-400">{e.body}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                          {e.zoom_url && (
                            <a href={e.zoom_url} target="_blank" rel="noopener noreferrer"
                              className="rounded bg-emerald-600 px-2.5 py-1 font-semibold text-zinc-950 hover:bg-emerald-500">
                              📹 Join Zoom
                            </a>
                          )}
                          {e.livestream_url && (
                            <a href={e.livestream_url} target="_blank" rel="noopener noreferrer"
                              className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:border-emerald-500">
                              📺 Livestream
                            </a>
                          )}
                          {e.public_comment_url && (
                            <a href={e.public_comment_url} target="_blank" rel="noopener noreferrer"
                              className="rounded border border-amber-700/60 bg-amber-950/30 px-2.5 py-1 text-amber-200 hover:border-amber-500">
                              🎤 Sign up to speak
                            </a>
                          )}
                          {e.agenda_url && (
                            <a href={e.agenda_url} target="_blank" rel="noopener noreferrer"
                              className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:border-emerald-500">
                              📄 Agenda
                            </a>
                          )}
                          {e.in_person_address && (
                            <span className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-400">
                              📍 {e.in_person_address.slice(0, 80)}
                            </span>
                          )}
                          {e.detail_href && (
                            <Link href={e.detail_href} className="text-emerald-400 hover:underline">
                              detail →
                            </Link>
                          )}
                          {e.source_url && !e.detail_href && (
                            <a href={e.source_url} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400">
                              source ↗
                            </a>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterPill({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded px-3 py-1.5 ${active ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
    >
      {label}
    </Link>
  );
}
