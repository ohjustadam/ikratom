import Link from "next/link";
import { createClient, getCachedAuthProfile } from "@/lib/supabase/server";
import { SignUpNudge } from "@/components/SignUpNudge";
import { CalendarSyncButton } from "./CalendarSyncButton";
import { EVENT_TYPE_LABELS } from "@/modules/events/labels";

export const metadata = {
  title: "Community Calendar — every public kratom event",
  description: "The kratom community calendar: elections + primaries, town halls + hearings, city/county meetings, bill actions, and legislative sessions in one place. Subscribe to the .ics feed.",
};
export const dynamic = "force-dynamic";

type Event = {
  kind: "municipal" | "alert" | "bill_action" | "state_session" | "election" | "townhall" | "bill_effective";
  date: Date;
  end_date?: Date | null;
  allDay?: boolean;
  scope?: string | null;
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
  detail_href?: string | null;       // primary internal link (this event's own page)
  bill_href?: string | null;         // secondary cross-link to the related bill
  severity?: string | null;
};

const KIND_BADGE: Record<string, { emoji: string; label: string; cls: string }> = {
  municipal: { emoji: "🏛️", label: "City/county", cls: "bg-amber-950/30 text-amber-300 border-amber-700/40" },
  alert: { emoji: "🚨", label: "Policy alert", cls: "bg-red-950/30 text-red-300 border-red-700/40" },
  bill_action: { emoji: "📜", label: "Bill action", cls: "bg-blue-950/30 text-blue-300 border-blue-700/40" },
  state_session: { emoji: "🏛️", label: "State session", cls: "bg-emerald-950/30 text-emerald-300 border-emerald-700/40" },
  election: { emoji: "🗳️", label: "Election", cls: "bg-violet-950/30 text-violet-300 border-violet-700/40" },
  townhall: { emoji: "🎤", label: "Town hall", cls: "bg-teal-950/30 text-teal-300 border-teal-700/40" },
  bill_effective: { emoji: "⚖️", label: "Takes effect", cls: "bg-rose-950/30 text-rose-300 border-rose-700/40" },
};

// Eastern calendar day for an instant (NOT UTC). A 9pm-ET event must land on the
// right day for US users — see memory civic-dates-anchor-eastern.
const etYmd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD

export default async function CalendarPage({ searchParams }: {
  searchParams?: Promise<{ state?: string; kind?: string; view?: string; month?: string; day?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const stateFilter = sp.state?.toUpperCase() ?? null;
  const kindFilter = sp.kind ?? null;
  const view: "list" | "month" = sp.view === "month" ? "month" : "list";

  const sb = await createClient();
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * 86_400_000);  // next 90 days
  // Elections look further out than meetings — the general election + many
  // primaries sit months ahead — so election rows use a 1-year horizon.
  const electionHorizon = new Date(now.getTime() + 365 * 86_400_000);

  // Geofence elections to the viewer's state: an explicit ?state= wins, else
  // the signed-in user's profile state. national-scope elections show to all;
  // state elections only when they match (anon/stateless → national only).
  const { userId } = await getCachedAuthProfile();
  let userState: string | null = null;
  if (userId) {
    const { data: prof } = await sb.from("profiles").select("state").eq("id", userId).maybeSingle();
    userState = prof?.state ? String(prof.state).toUpperCase() : null;
  }
  const viewerState = stateFilter ?? userState;

  // Pull from multiple sources in parallel
  const [meetings, alerts, billActions, sessions, elections, townhalls, billsEffective] = await Promise.all([
    sb.from("municipal_meetings")
      .select("id, state, locality, body_name, meeting_at, format, zoom_url, livestream_url, agenda_url, agenda_text, in_person_address, public_comment_signup_url, source_url")
      .eq("moderation_status", "approved")
      .gte("meeting_at", now.toISOString())
      .lte("meeting_at", horizon.toISOString())
      .order("meeting_at", { ascending: true }),
    sb.from("policy_alerts")
      .select("id, kind, severity, title, body, locality, source_url, occurs_at, bill_id")
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
    sb.from("election_dates")
      .select("scope, state, locality, election_type, title, election_date, registration_deadline, source_url")
      .eq("moderation_status", "approved")
      .gte("election_date", now.toISOString().slice(0, 10))
      .lte("election_date", electionHorizon.toISOString().slice(0, 10))
      .order("election_date", { ascending: true }),
    sb.from("legislator_events")
      .select("id, state, locality, title, description, event_type, starts_at, venue, source_url, legislator_id")
      .eq("active", true)
      .gte("starts_at", now.toISOString())
      .lte("starts_at", horizon.toISOString())
      .order("starts_at", { ascending: true }),
    // Upcoming "takes effect" dates for tracked bills — the most-asked
    // question ("when does this hit me?"). effective_date is a date column
    // (0029); look 1yr out like elections since laws are dated months ahead.
    sb.from("bills")
      .select("id, state, bill_number, title, effective_date, kratom_relevance")
      .in("kratom_relevance", ["anti", "pro"])
      .not("effective_date", "is", null)
      .gte("effective_date", now.toISOString().slice(0, 10))
      .lte("effective_date", electionHorizon.toISOString().slice(0, 10))
      .order("effective_date", { ascending: true }),
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
      detail_href: `/meetings/${m.id}`,
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
      detail_href: `/alerts/${a.id}`,                       // the specific alert, not generic /pulse
      bill_href: a.bill_id ? `/bills/${a.bill_id}` : null,  // cross-link to the bill the alert is about
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
          detail_href: `/states/${s.state}`,
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
          detail_href: `/states/${s.state}`,
        });
      }
    }
  }

  // Legislator town halls + hearings (hand-verified). Folded in from the old
  // /events page, which now redirects here — this is the one community calendar.
  for (const t of townhalls.data ?? []) {
    const typeLabel = EVENT_TYPE_LABELS[t.event_type] ?? t.event_type;
    events.push({
      kind: "townhall",
      date: new Date(t.starts_at),
      title: t.title,
      body: [typeLabel, t.description?.split("\n")[0]].filter(Boolean).join(" · "),
      state: t.state,
      locality: t.locality,
      in_person_address: t.venue,
      source_url: t.source_url,
      detail_href: t.legislator_id ? `/legislators/${t.legislator_id}` : null,
    });
  }

  // Elections — geofenced. national-scope rows show to everyone; state rows
  // only when they match the viewer's state. Rendered as all-day events.
  for (const el of elections.data ?? []) {
    const national = el.scope === "national";
    if (!national && (!viewerState || el.state !== viewerState)) continue;
    // Parse the DATE at noon UTC so it lands on the same calendar day in every
    // US timezone (midnight UTC would shift the date west of the Atlantic).
    const regNote = el.registration_deadline
      ? `Register to vote by ${new Date(el.registration_deadline + "T12:00:00Z").toLocaleDateString(undefined, { month: "long", day: "numeric" })}.`
      : null;
    events.push({
      kind: "election",
      date: new Date(el.election_date + "T12:00:00Z"),
      allDay: true,
      scope: el.scope,
      title: el.title,
      body: regNote,
      state: national ? null : el.state,
      source_url: el.source_url,
    });
  }

  // "Takes effect" dates for tracked bills — when a passed/signed law actually
  // hits. All-day, links to the bill. Answers "when does this affect me?".
  for (const b of billsEffective.data ?? []) {
    if (!b.effective_date) continue;
    events.push({
      kind: "bill_effective",
      date: new Date(b.effective_date + "T12:00:00Z"),
      allDay: true,
      title: `${b.state} ${b.bill_number} takes effect`,
      body: b.title ? b.title.slice(0, 200) : null,
      state: b.state,
      detail_href: `/bills/${b.id}`,
    });
  }

  // Whether state-scoped elections exist but are hidden because the viewer has
  // no resolved state — drives the "set your state" nudge below.
  const hasHiddenStateElections =
    !viewerState && (elections.data ?? []).some((el) => el.scope !== "national");

  // Apply filters + sort by date. Elections are pre-geofenced above; keep
  // national elections (state === null) visible even under a ?state= filter.
  let filtered = events;
  if (stateFilter) {
    filtered = filtered.filter((e) =>
      e.kind === "election" ? e.state === null || e.state === stateFilter : e.state === stateFilter,
    );
  }
  if (kindFilter) filtered = filtered.filter((e) => e.kind === kindFilter);
  filtered.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Bucket by Eastern calendar day — drives both the list groups and the month
  // grid cells (same source of truth so the two views always agree).
  const groups = new Map<string, Event[]>();
  for (const e of filtered) {
    const k = etYmd(e.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }

  // Month-view state: displayed month (?month=YYYY-MM) + selected day (?day=).
  const todayYmd = etYmd(now);
  const displayMonth = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : todayYmd.slice(0, 7);
  const selectedDay =
    /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") && sp.day!.startsWith(displayMonth) ? sp.day! :
    todayYmd.startsWith(displayMonth) ? todayYmd : `${displayMonth}-01`;
  const monthBuckets = new Map<string, Event[]>();
  for (const [k, es] of groups) if (k.startsWith(displayMonth)) monthBuckets.set(k, es);

  // Counts for filter pills
  const stateOptions = [...new Set(events.map((e) => e.state).filter(Boolean) as string[])].sort();
  const counts = {
    election: events.filter((e) => e.kind === "election").length,
    townhall: events.filter((e) => e.kind === "townhall").length,
    municipal: events.filter((e) => e.kind === "municipal").length,
    alert: events.filter((e) => e.kind === "alert").length,
    bill_action: events.filter((e) => e.kind === "bill_action").length,
    bill_effective: events.filter((e) => e.kind === "bill_effective").length,
    state_session: events.filter((e) => e.kind === "state_session").length,
  };

  // Feed (.ics) subscribe URLs — the current state/kind filter carries through
  // so a user subscribes to exactly the slice they're viewing.
  const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";
  const feedQs = new URLSearchParams();
  if (viewerState) feedQs.set("state", viewerState);
  if (kindFilter) feedQs.set("kind", kindFilter);
  const feedSuffix = feedQs.toString() ? `?${feedQs.toString()}` : "";
  const feedHttps = `${SITE}/calendar/feed.ics${feedSuffix}`;
  const feedWebcal = feedHttps.replace(/^https?:/, "webcal:");
  const feedGoogle = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedHttps)}`;
  const feedScope = [viewerState, kindFilter ? kindFilter.replace("_", " ") : null]
    .filter(Boolean).join(" · ") || "every event";

  // Build a /calendar href preserving the current state/kind/view/month, with
  // per-call overrides. Pass null to clear a param (e.g. view:null → list).
  const mkHref = (o: { view?: "list" | "month" | null; kind?: string | null; state?: string | null; month?: string | null; day?: string | null } = {}) => {
    const st = o.state !== undefined ? o.state : stateFilter;
    const k = o.kind !== undefined ? o.kind : kindFilter;
    const v = o.view !== undefined ? o.view : (view === "month" ? "month" : null);
    const mo = o.month !== undefined ? o.month : (v === "month" ? displayMonth : null);
    const dy = o.day !== undefined ? o.day : null;
    const p = new URLSearchParams();
    if (st) p.set("state", st);
    if (k) p.set("kind", k);
    if (v) p.set("view", v);
    if (mo) p.set("month", mo);
    if (dy) p.set("day", dy);
    const s = p.toString();
    return `/calendar${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              📅 Community Calendar
            </p>
            <h1 className="mt-2 text-3xl font-bold">Every event we know about</h1>
          </div>
          <CalendarSyncButton httpsUrl={feedHttps} webcalUrl={feedWebcal} googleUrl={feedGoogle} scopeLabel={feedScope} />
        </div>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Elections + primaries · town halls + hearings · city/county meetings ·
          bill action dates · legislative session bookends. One place for every
          public kratom event. Join by Zoom, livestream, in-person, or phone —
          links + addresses below.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Found something we missed? Drop the URL in <Link href="/alerts/submit" className="text-emerald-400 hover:underline">intel-tip</Link>.
        </p>

        {/* Coverage stat — surfaces the breadth of what's being surfaced
            so users immediately see "this platform is actually working." */}
        {events.length > 0 && (
          <p className="mt-2 inline-flex flex-wrap items-baseline gap-1 rounded-md border border-emerald-700/40 bg-emerald-950/15 px-2.5 py-1 text-xs text-emerald-200">
            <span className="font-mono font-bold">{events.length}</span>
            <span>{events.length === 1 ? "event" : "events"} across</span>
            <span className="font-mono font-bold">{[...new Set(events.map((e) => e.state).filter(Boolean))].length}</span>
            <span>{[...new Set(events.map((e) => e.state).filter(Boolean))].length === 1 ? "state" : "states"} · next 90 days</span>
          </p>
        )}

      </header>

      {/* Signup nudge — calendar viewers want push reminders, not just .ics */}
      <SignUpNudge context="calendar" stateCode={stateFilter ?? undefined} className="mb-6" />

      {/* Election geofence nudge — explain why only national elections show
          and point the viewer at the one setting that unlocks their primaries. */}
      {hasHiddenStateElections && (
        <div className="mb-6 rounded-md border border-violet-700/40 bg-violet-950/15 px-3 py-2 text-xs text-violet-200">
          🗳️ You&apos;re seeing national election dates.{" "}
          {userId ? (
            <>Set your state in your <Link href="/account" className="font-semibold underline hover:text-violet-100">account</Link> to see your state&apos;s primary + local elections and get voting reminders.</>
          ) : (
            <>Sign in and set your state to see your primary dates and get voting reminders.</>
          )}
        </div>
      )}

      {/* View toggle + filter pills */}
      <div className="mb-4 space-y-2">
        <nav className="flex flex-wrap items-center gap-2 text-xs" aria-label="Calendar layout">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">View</span>
          <FilterPill label="☰ List" href={mkHref({ view: null, day: null })} active={view === "list"} />
          <FilterPill label="▦ Month" href={mkHref({ view: "month", month: displayMonth, day: null })} active={view === "month"} />
        </nav>
        <nav className="flex flex-wrap gap-2 text-xs">
          <FilterPill label={`All kinds (${events.length})`} href={mkHref({ kind: null })} active={!kindFilter} />
          {Object.entries(counts).map(([k, n]) => n > 0 && (
            <FilterPill
              key={k}
              label={`${KIND_BADGE[k].emoji} ${KIND_BADGE[k].label} (${n})`}
              href={mkHref({ kind: k })}
              active={kindFilter === k}
            />
          ))}
        </nav>
        {stateOptions.length > 0 && (
          <nav className="flex flex-wrap gap-2 text-xs">
            <FilterPill label="All states" href={mkHref({ state: null })} active={!stateFilter} />
            {stateOptions.map((s) => (
              <FilterPill key={s} label={s} href={mkHref({ state: s })} active={stateFilter === s} />
            ))}
          </nav>
        )}
      </div>

      {/* Events — month grid or day-grouped list */}
      {view === "month" ? (
        <MonthGrid
          displayMonth={displayMonth}
          todayYmd={todayYmd}
          selectedDay={selectedDay}
          buckets={monthBuckets}
          mkHref={mkHref}
        />
      ) : groups.size === 0 ? (
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
            const rel = Math.round((Date.parse(day + "T12:00:00Z") - Date.parse(todayYmd + "T12:00:00Z")) / 86_400_000);
            return (
              <section key={day}>
                <h2 className="mb-2 flex items-baseline gap-3 border-b border-zinc-800 pb-1">
                  <span className="text-base font-bold text-zinc-100">
                    {new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {rel === 0 ? "today" : rel === 1 ? "tomorrow" : rel === -1 ? "yesterday" : rel < 0 ? `${Math.abs(rel)}d ago` : `in ${rel}d`}
                  </span>
                </h2>
                <ul className="space-y-2">
                  {es.map((e, i) => <EventCard key={i} e={e} />)}
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
      aria-current={active ? "true" : undefined}
      className={`rounded px-3 py-1.5 ${active ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
    >
      {label}
    </Link>
  );
}

/** One event row — shared by the day-grouped list and the month-view day detail. */
function EventCard({ e }: { e: Event }) {
  const meta = KIND_BADGE[e.kind];
  return (
    <li className={`rounded-md border p-3 ${
      e.severity === "critical" ? "border-red-700/50 bg-red-950/10" : "border-zinc-800 bg-zinc-950/40"
    }`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.cls}`}>
          {meta.emoji} {meta.label}
        </span>
        {e.state && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">{e.state}</span>}
        <span className="text-[11px] text-zinc-500">
          {e.allDay
            ? "All day"
            : e.date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
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
          <Link href={e.detail_href} className="rounded border border-emerald-700/40 bg-emerald-950/20 px-2.5 py-1 font-semibold text-emerald-300 hover:border-emerald-500">
            {e.kind === "bill_action" || e.kind === "bill_effective" ? "📜 View bill" :
             e.kind === "alert" ? "🔗 Open alert" :
             e.kind === "municipal" ? "🏛️ Meeting detail" :
             e.kind === "townhall" ? "👤 Legislator" :
             e.kind === "state_session" ? "📍 State hub" : "detail →"}
          </Link>
        )}
        {e.bill_href && (
          <Link href={e.bill_href} className="rounded border border-blue-700/40 bg-blue-950/20 px-2.5 py-1 font-semibold text-blue-300 hover:border-blue-500">
            📜 Related bill
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
}

type MkHref = (o?: { view?: "list" | "month" | null; month?: string | null; day?: string | null }) => string;

/** Month grid (7-col weeks) + prev/next nav + the selected day's events. */
function MonthGrid({ displayMonth, todayYmd, selectedDay, buckets, mkHref }: {
  displayMonth: string;
  todayYmd: string;
  selectedDay: string;
  buckets: Map<string, Event[]>;
  mkHref: MkHref;
}) {
  const [yy, mm] = displayMonth.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();           // mm is 1-based → day 0 of next month
  const firstWeekday = new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay();        // 0=Sun
  const monthLabel = new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const prevMonth = mm === 1 ? `${yy - 1}-12` : `${yy}-${String(mm - 1).padStart(2, "0")}`;
  const nextMonth = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, "0")}`;
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${displayMonth}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  // Chunk into weeks so the grid has a valid ARIA structure (grid > row > cell).
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <section aria-label={`Month view, ${monthLabel}`}>
      <div className="mb-3 flex items-center justify-between">
        <Link href={mkHref({ view: "month", month: prevMonth, day: null })} aria-label="Previous month"
          className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 text-sm hover:border-emerald-500">←</Link>
        <h2 className="text-base font-bold text-zinc-100">{monthLabel}</h2>
        <Link href={mkHref({ view: "month", month: nextMonth, day: null })} aria-label="Next month"
          className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 text-sm hover:border-emerald-500">→</Link>
      </div>

      <div role="grid" aria-label={`${monthLabel} calendar`} className="grid grid-cols-7 gap-1">
        {/* display:contents rows give a valid grid>row>cell ARIA tree while the
            cells still flow into the parent's CSS grid columns. */}
        <div role="row" className="contents">
          {WEEKDAYS.map((w) => (
            <div key={w} role="columnheader" className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <span className="hidden sm:inline">{w}</span><span className="sm:hidden">{w[0]}</span>
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} role="row" className="contents">
            {week.map((key, i) => {
              if (!key) return <div key={`b${wi}-${i}`} role="gridcell" aria-hidden="true" className="min-h-[3.25rem] rounded bg-zinc-950/20 sm:min-h-[5.5rem]" />;
              const d = Number(key.slice(-2));
              const evs = buckets.get(key) ?? [];
              const isToday = key === todayYmd;
              const isSelected = key === selectedDay;
              return (
                // gridcell wraps the <Link> so the anchor keeps its native link role.
                <div key={key} role="gridcell" aria-current={isSelected ? "date" : undefined}>
                  <Link
                    href={mkHref({ view: "month", month: displayMonth, day: key })}
                    aria-label={`${monthLabel} ${d}${isToday ? ", today" : ""}, ${evs.length} event${evs.length === 1 ? "" : "s"}`}
                    className={`flex h-full min-h-[3.25rem] flex-col overflow-hidden rounded border p-1 text-left transition sm:min-h-[5.5rem] ${
                      isSelected ? "border-emerald-400 bg-emerald-950/40 ring-1 ring-emerald-400"
                      : isToday ? "border-emerald-600/60 bg-emerald-950/15"
                      : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-600/50"
                    }`}
                  >
                    <span className={`text-[11px] font-semibold ${isToday ? "text-emerald-300" : "text-zinc-400"}`}>{d}</span>
                    {/* chips with titles on sm+ */}
                    <span className="mt-0.5 hidden flex-col gap-0.5 sm:flex">
                      {evs.slice(0, 3).map((e, j) => (
                        <span key={j} className={`truncate rounded border px-1 text-[9px] leading-tight ${KIND_BADGE[e.kind].cls}`}>
                          {KIND_BADGE[e.kind].emoji} {e.title}
                        </span>
                      ))}
                      {evs.length > 3 && <span className="text-[9px] text-zinc-500">+{evs.length - 3} more</span>}
                    </span>
                    {/* compact emoji dots on mobile */}
                    {evs.length > 0 && (
                      <span className="mt-auto flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                        {evs.slice(0, 4).map((e, j) => <span key={j} className="text-[9px]">{KIND_BADGE[e.kind].emoji}</span>)}
                        {evs.length > 4 && <span className="text-[8px] text-zinc-500">+{evs.length - 4}</span>}
                      </span>
                    )}
                  </Link>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <DayDetail day={selectedDay} events={buckets.get(selectedDay) ?? []} />
    </section>
  );
}

/** The selected day's events below the month grid. */
function DayDetail({ day, events }: { day: string; events: Event[] }) {
  const label = new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return (
    <section className="mt-5" aria-live="polite">
      <h3 className="mb-2 border-b border-zinc-800 pb-1 text-sm font-bold text-zinc-100">{label}</h3>
      {events.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-center text-xs text-zinc-500">
          No events on this day. Tap another day above, or switch to <span className="text-zinc-400">List</span> to see everything upcoming.
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((e, i) => <EventCard key={i} e={e} />)}
        </ul>
      )}
    </section>
  );
}
