import Link from "@/components/Link";
import { createClient } from "@/lib/supabase/server";
import {
  EVENT_COLUMNS, EVENT_KIND_LABEL, eventDateChip, eventPath, formatEventWhen, type GroupEvent,
} from "@/modules/coalitions/events";
import { NewEventForm, RsvpButtons, type RsvpStatus } from "./EventsClient";

/**
 * The group's upcoming events (migration 0283). Members only (RLS). Shows
 * going/maybe COUNTS and the viewer's own RSVP, never who else is coming.
 */
export async function Events({ coalitionId, slug, isAdmin, limit = 5, openForm = false }: {
  coalitionId: string; slug: string; isAdmin: boolean; limit?: number; openForm?: boolean;
}) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const [{ data: evRows }, { data: counts }, { data: group }] = await Promise.all([
    sb.from("coalition_events").select(EVENT_COLUMNS)
      .eq("coalition_id", coalitionId).is("cancelled_at", null)
      .gte("starts_at", new Date(Date.now() - 2 * 3_600_000).toISOString())
      .order("starts_at").limit(limit),
    sb.rpc("coalition_event_counts", { p_coalition_id: coalitionId }),
    isAdmin
      ? sb.from("coalitions").select("featured_campaign_id").eq("id", coalitionId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const featuredId = (group as { featured_campaign_id: string | null } | null)?.featured_campaign_id ?? null;
  const events = (evRows ?? []) as GroupEvent[];
  const countBy = new Map(((counts ?? []) as { event_id: string; going: number; maybe: number }[]).map((r) => [r.event_id, r]));

  const mine = new Map<string, RsvpStatus>();
  if (user && events.length > 0) {
    const { data } = await sb.from("coalition_event_rsvps").select("event_id, status")
      .eq("user_id", user.id).in("event_id", events.map((e) => e.id));
    for (const r of (data ?? []) as { event_id: string; status: RsvpStatus }[]) mine.set(r.event_id, r.status);
  }

  const { data: featured } = featuredId
    ? await sb.from("campaigns").select("slug, title, active").eq("id", featuredId).maybeSingle()
    : { data: null };

  return (
    <section id="events" className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">📅 Upcoming events</h2>
      </div>
      {events.length === 0 ? (
        <p className="mb-3 text-sm text-zinc-400">
          {isAdmin
            ? "Nothing planned yet. A call-in day is the easiest first event: everyone calls or writes the same office in the same hour."
            : "Nothing planned yet. Your organizers will post call-in days and meetings here."}
        </p>
      ) : (
        <ul className="mb-4 space-y-2">
          {events.map((ev) => {
            const chip = eventDateChip(ev.starts_at, ev.timezone);
            const c = countBy.get(ev.id);
            return (
              <li key={ev.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="flex gap-3">
                  <div className="flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-md bg-zinc-900 leading-none">
                    <span className="text-[10px] font-bold text-red-400">{chip.month}</span>
                    <span className="mt-1 text-xl font-bold text-zinc-100">{chip.day}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={eventPath(slug, ev.id)} className="block font-semibold text-zinc-100 hover:text-emerald-300">
                      {ev.title}
                    </Link>
                    <p className="text-xs text-zinc-400">{EVENT_KIND_LABEL[ev.kind]} · {formatEventWhen(ev.starts_at, ev.timezone)}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {c?.going ?? 0} going{c?.maybe ? ` · ${c.maybe} maybe` : ""}
                    </p>
                  </div>
                </div>
                <RsvpButtons slug={slug} eventId={ev.id} current={mine.get(ev.id) ?? null} compact />
              </li>
            );
          })}
        </ul>
      )}
      {isAdmin && <NewEventForm slug={slug} initialOpen={openForm} featured={featured?.active ? { slug: featured.slug, title: featured.title } : null} />}
    </section>
  );
}
