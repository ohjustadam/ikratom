import { listUpcomingEvents } from "@/modules/events/actions";
import { EVENT_TYPE_LABELS } from "@/modules/events/labels";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Town halls + hearings" };
export const dynamic = "force-dynamic";

type EventRow = {
  id: string;
  legislator_id: string | null;
  state: string;
  locality: string | null;
  title: string;
  description: string | null;
  event_type: string;
  starts_at: string;
  ends_at: string | null;
  venue: string | null;
  source_url: string | null;
  legislators:
    | { full_name: string; role: string | null; party: string | null }[]
    | { full_name: string; role: string | null; party: string | null }
    | null;
};

const TYPE_COLORS: Record<string, string> = {
  town_hall: "bg-emerald-950/40 text-emerald-300",
  public_hearing: "bg-amber-950/40 text-amber-300",
  listening_session: "bg-blue-950/40 text-blue-300",
  committee_hearing: "bg-purple-950/40 text-purple-300",
  floor_vote: "bg-red-950/40 text-red-300",
  other: "bg-zinc-900 text-zinc-300",
};

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const sp = await searchParams;
  const events = (await listUpcomingEvents({
    state: sp.state?.toUpperCase(),
    limit: 100,
  })) as unknown as EventRow[];

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

  // Group by date
  const groups = new Map<string, EventRow[]>();
  for (const e of events) {
    const day = e.starts_at.slice(0, 10);
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
          Town halls + public hearings
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-400">
          The fastest way to make a legislator move on kratom is to show up
          where they expect a different audience. Verified events from advocates
          + admins; not exhaustive (no free API covers town halls nationwide).
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
            Know about a town hall? Email{" "}
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
                {new Date(day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </h2>
              <ul className="space-y-3">
                {dayEvents.map((e) => {
                  const leg = Array.isArray(e.legislators) ? e.legislators[0] : e.legislators;
                  const typeStyle = TYPE_COLORS[e.event_type] ?? TYPE_COLORS.other;
                  return (
                    <li
                      key={e.id}
                      className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className={`rounded px-1.5 py-0.5 capitalize ${typeStyle}`}>
                          {EVENT_TYPE_LABELS[e.event_type] ?? e.event_type}
                        </span>
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                          {e.state}
                        </span>
                        {e.locality && (
                          <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
                            📍 {e.locality}
                          </span>
                        )}
                        <span className="ml-auto font-mono text-zinc-400">
                          {new Date(e.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <h3 className="mt-2 text-lg font-semibold">{e.title}</h3>
                      {leg && (
                        <p className="mt-1 text-sm text-zinc-400">
                          Hosted by{" "}
                          <span className="text-zinc-200">{leg.full_name}</span>
                          {leg.party && <span className="ml-1 text-zinc-500">({leg.party})</span>}
                        </p>
                      )}
                      {e.description && (
                        <p className="mt-2 whitespace-pre-line text-sm text-zinc-300">
                          {e.description}
                        </p>
                      )}
                      {e.venue && (
                        <p className="mt-2 text-sm text-zinc-400">
                          <span className="text-zinc-500">Venue: </span>
                          {e.venue}
                        </p>
                      )}
                      {e.source_url && (
                        <a
                          href={e.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-block text-xs text-emerald-400 hover:underline"
                        >
                          Official details ↗
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
