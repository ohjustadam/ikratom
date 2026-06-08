import { listUpcomingEvents, listUpcomingMeetings } from "@/modules/events/actions";
import { EVENT_TYPE_LABELS } from "@/modules/events/labels";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Town halls + hearings" };
export const dynamic = "force-dynamic";

type LegRow = {
  id: string;
  state: string;
  locality: string | null;
  title: string;
  description: string | null;
  event_type: string;
  starts_at: string;
  venue: string | null;
  source_url: string | null;
  legislators:
    | { full_name: string; role: string | null; party: string | null }[]
    | { full_name: string; role: string | null; party: string | null }
    | null;
};

type MeetingRow = {
  id: string;
  state: string;
  locality: string | null;
  body_name: string | null;
  meeting_at: string;
  format: string | null;
  zoom_url: string | null;
  livestream_url: string | null;
  agenda_url: string | null;
  agenda_text: string | null;
  in_person_address: string | null;
  public_comment_signup_url: string | null;
  source_url: string | null;
};

/** Unified shape both sources normalize into for one date-sorted list. */
type EventItem = {
  id: string;
  source: "legislator" | "meeting";
  state: string;
  locality: string | null;
  title: string;
  description: string | null;
  typeLabel: string;
  typeCls: string;
  startsAt: string;
  host: string | null;
  venue: string | null;
  zoomUrl: string | null;
  livestreamUrl: string | null;
  agendaUrl: string | null;
  publicCommentUrl: string | null;
  sourceUrl: string | null;
};

const TYPE_COLORS: Record<string, string> = {
  town_hall: "bg-emerald-950/40 text-emerald-300",
  public_hearing: "bg-amber-950/40 text-amber-300",
  listening_session: "bg-blue-950/40 text-blue-300",
  committee_hearing: "bg-purple-950/40 text-purple-300",
  floor_vote: "bg-red-950/40 text-red-300",
  meeting: "bg-amber-950/40 text-amber-300",
  other: "bg-zinc-900 text-zinc-300",
};

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const sp = await searchParams;
  const state = sp.state?.toUpperCase();

  const [legRaw, meetingRaw] = await Promise.all([
    listUpcomingEvents({ state, limit: 100 }) as unknown as Promise<LegRow[]>,
    listUpcomingMeetings({ state, limit: 100 }) as unknown as Promise<MeetingRow[]>,
  ]);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let userState: string | null = null;
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("state")
      .eq("id", user.id)
      .single();
    userState = (prof as { state: string | null } | null)?.state ?? null;
  }

  // Normalize both sources into one list.
  const legItems: EventItem[] = (legRaw ?? []).map((e) => {
    const leg = Array.isArray(e.legislators) ? e.legislators[0] : e.legislators;
    return {
      id: `leg-${e.id}`,
      source: "legislator",
      state: e.state,
      locality: e.locality,
      title: e.title,
      description: e.description,
      typeLabel: EVENT_TYPE_LABELS[e.event_type] ?? e.event_type,
      typeCls: TYPE_COLORS[e.event_type] ?? TYPE_COLORS.other,
      startsAt: e.starts_at,
      host: leg ? `${leg.full_name}${leg.party ? ` (${leg.party})` : ""}` : null,
      venue: e.venue,
      zoomUrl: null,
      livestreamUrl: null,
      agendaUrl: null,
      publicCommentUrl: null,
      sourceUrl: e.source_url,
    };
  });

  const meetingItems: EventItem[] = (meetingRaw ?? []).map((m) => ({
    id: `mtg-${m.id}`,
    source: "meeting",
    state: m.state,
    locality: m.locality,
    title: [m.locality, m.body_name].filter(Boolean).join(" · ") || "Public meeting",
    description: m.agenda_text,
    typeLabel: "City/county meeting",
    typeCls: TYPE_COLORS.meeting,
    startsAt: m.meeting_at,
    host: null,
    venue: m.in_person_address,
    zoomUrl: m.zoom_url,
    livestreamUrl: m.livestream_url,
    agendaUrl: m.agenda_url,
    publicCommentUrl: m.public_comment_signup_url,
    sourceUrl: m.source_url ?? m.agenda_url,
  }));

  const events = [...legItems, ...meetingItems].sort((a, b) =>
    a.startsAt < b.startsAt ? -1 : 1,
  );

  // Group by date
  const groups = new Map<string, EventItem[]>();
  for (const e of events) {
    const day = e.startsAt.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(e);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Show up
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Town halls, hearings + meetings
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-400">
          The fastest way to move a legislator on kratom is to show up where they
          expect a different audience. Hand-verified legislator events plus
          auto-discovered city/county meetings where kratom is on the agenda. For
          the full picture (bill actions, sessions, alerts) see the{" "}
          <a href="/calendar" className="text-emerald-400 hover:underline">calendar</a>.
        </p>
      </header>

      {/* State filter */}
      <div className="mb-6 flex flex-wrap gap-2 text-xs">
        <a
          href="/events"
          className={`rounded-full px-3 py-1 transition ${
            !sp.state
              ? "bg-emerald-500 font-semibold text-zinc-950"
              : "border border-zinc-800 text-zinc-400 hover:border-emerald-500"
          }`}
        >
          All states
        </a>
        {userState && (
          <a
            href={`/events?state=${userState}`}
            className={`rounded-full px-3 py-1 transition ${
              sp.state?.toUpperCase() === userState
                ? "bg-emerald-500 font-semibold text-zinc-950"
                : "border border-zinc-800 text-zinc-400 hover:border-emerald-500"
            }`}
          >
            Your state ({userState})
          </a>
        )}
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
          <p className="text-3xl">📅</p>
          <h2 className="mt-3 text-lg font-semibold">No upcoming events posted</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Nothing scheduled{sp.state ? ` in ${sp.state}` : ""} yet. Check the{" "}
            <a href="/calendar" className="text-emerald-400 hover:underline">full calendar</a>, or know
            about a town hall? Email{" "}
            <a href="mailto:support@ikratom.org" className="text-emerald-400 hover:underline">
              support@ikratom.org
            </a>{" "}
            with the details.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {Array.from(groups.entries()).map(([day, dayEvents]) => (
            <section key={day}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {new Date(day + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </h2>
              <ul className="space-y-3">
                {dayEvents.map((e) => (
                  <li key={e.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 ${e.typeCls}`}>
                        {e.typeLabel}
                      </span>
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                        {e.state}
                      </span>
                      {e.locality && e.source === "legislator" && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
                          📍 {e.locality}
                        </span>
                      )}
                      <span className="ml-auto font-mono text-zinc-400">
                        {new Date(e.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <h3 className="mt-2 text-lg font-semibold">{e.title}</h3>
                    {e.host && (
                      <p className="mt-1 text-sm text-zinc-400">
                        Hosted by <span className="text-zinc-200">{e.host}</span>
                      </p>
                    )}
                    {e.description && (
                      <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-zinc-300">
                        {e.description}
                      </p>
                    )}
                    {e.venue && (
                      <p className="mt-2 text-sm text-zinc-400">
                        <span className="text-zinc-500">Venue: </span>
                        {e.venue}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {e.zoomUrl && (
                        <a href={e.zoomUrl} target="_blank" rel="noopener noreferrer"
                          className="rounded bg-emerald-600 px-2.5 py-1 font-semibold text-zinc-950 hover:bg-emerald-500">
                          📹 Join Zoom
                        </a>
                      )}
                      {e.livestreamUrl && (
                        <a href={e.livestreamUrl} target="_blank" rel="noopener noreferrer"
                          className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:border-emerald-500">
                          📺 Livestream
                        </a>
                      )}
                      {e.publicCommentUrl && (
                        <a href={e.publicCommentUrl} target="_blank" rel="noopener noreferrer"
                          className="rounded border border-amber-700/60 bg-amber-950/30 px-2.5 py-1 text-amber-200 hover:border-amber-500">
                          🎤 Sign up to speak
                        </a>
                      )}
                      {e.agendaUrl && (
                        <a href={e.agendaUrl} target="_blank" rel="noopener noreferrer"
                          className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:border-emerald-500">
                          📄 Agenda
                        </a>
                      )}
                      {e.sourceUrl && !e.agendaUrl && (
                        <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer"
                          className="text-emerald-400 hover:underline">
                          Official details ↗
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
