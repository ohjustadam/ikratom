import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  EVENT_COLUMNS, EVENT_KIND_LABEL, formatEventWhen, googleCalendarUrl, type GroupEvent,
} from "@/modules/coalitions/events";
import { ReportButton } from "@/modules/reports/components/ReportButton";
import { CancelEventButton, RsvpButtons, type RsvpStatus } from "../../EventsClient";

/**
 * One group event (migration 0283). RLS returns it only to the group's
 * members (and site admins), so anyone else gets a 404, not a hint it exists.
 */
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

type Params = Promise<{ slug: string; eventId: string }>;

export default async function GroupEventPage({ params }: { params: Params }) {
  const { slug, eventId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) notFound();

  const { data: c } = await sb.from("coalitions").select("id, slug, name").eq("slug", slug).maybeSingle();
  if (!c) notFound();
  const [{ data: evRow }, { data: me }, { data: mine }, { data: counts }] = await Promise.all([
    sb.from("coalition_events").select(`${EVENT_COLUMNS}, created_by`).eq("id", eventId).eq("coalition_id", c.id).maybeSingle(),
    sb.from("coalition_members").select("role").eq("coalition_id", c.id).eq("user_id", user.id).maybeSingle(),
    sb.from("coalition_event_rsvps").select("status").eq("event_id", eventId).eq("user_id", user.id).maybeSingle(),
    sb.rpc("coalition_event_counts", { p_coalition_id: c.id }),
  ]);
  if (!evRow || !me) notFound();
  const ev = evRow as GroupEvent & { created_by: string | null };
  const isOrganizer = me.role === "owner" || me.role === "admin";
  const count = ((counts ?? []) as { event_id: string; going: number; maybe: number }[]).find((r) => r.event_id === ev.id);
  const { data: campaign } = ev.campaign_id
    ? await sb.from("campaigns").select("slug, title, active").eq("id", ev.campaign_id).maybeSingle()
    : { data: null };
  const past = new Date(ev.ends_at ?? ev.starts_at).getTime() < Date.now();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link href={`/coalitions/${c.slug}#events`} className="text-xs text-zinc-500 hover:text-emerald-400">← {c.name}</Link>

      <article className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 sm:p-5">
        <p className="text-xs font-semibold text-emerald-300">{EVENT_KIND_LABEL[ev.kind]}</p>
        <h1 className="mt-1 text-2xl font-bold text-zinc-100">{ev.title}</h1>
        {ev.cancelled_at && <p className="mt-2 rounded bg-red-950/40 px-2 py-1 text-sm text-red-300">This event was cancelled.</p>}

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex gap-2"><dt aria-label="When">🕒</dt><dd className="text-zinc-200">{formatEventWhen(ev.starts_at, ev.timezone)}</dd></div>
          {ev.location && <div className="flex gap-2"><dt aria-label="Where">📍</dt><dd className="text-zinc-200">{ev.location}</dd></div>}
          {ev.link_url && (
            <div className="flex gap-2"><dt aria-label="Link">🔗</dt>
              <dd className="min-w-0"><a href={ev.link_url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-emerald-400 hover:underline">{ev.link_url}</a></dd>
            </div>
          )}
          <div className="flex gap-2"><dt aria-label="RSVPs">🙋</dt><dd className="text-zinc-400">{count?.going ?? 0} going{count?.maybe ? ` · ${count.maybe} maybe` : ""}</dd></div>
        </dl>

        {ev.details && <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-300">{ev.details}</p>}

        {campaign?.active && (
          <Link href={`/campaigns/${campaign.slug}`}
            className="mt-4 flex min-h-12 items-center justify-between gap-2 rounded-lg border-2 border-emerald-600/60 bg-emerald-950/30 px-3 py-2 text-sm font-semibold text-emerald-200 hover:border-emerald-400">
            <span>⚡ Take the action: {campaign.title}</span><span aria-hidden>→</span>
          </Link>
        )}

        {!ev.cancelled_at && !past && <RsvpButtons slug={c.slug} eventId={ev.id} current={(mine?.status as RsvpStatus | undefined) ?? null} />}

        {!ev.cancelled_at && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <a href={`/coalitions/${c.slug}/events/${ev.id}/event.ics`}
              className="flex min-h-11 items-center justify-center rounded-md border border-zinc-700 px-3 text-sm text-zinc-200 hover:border-emerald-500">
              📆 Apple / Outlook
            </a>
            <a href={googleCalendarUrl(ev, c.slug)} target="_blank" rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-center rounded-md border border-zinc-700 px-3 text-sm text-zinc-200 hover:border-emerald-500">
              📆 Google Calendar
            </a>
          </div>
        )}
        <p className="mt-3 text-[11px] text-zinc-500">Only members see this event. Nobody sees who RSVP&apos;d, only the counts.</p>

        {isOrganizer && !ev.cancelled_at && <div className="mt-4 border-t border-zinc-800 pt-3"><CancelEventButton slug={c.slug} eventId={ev.id} /></div>}
        {ev.created_by !== user.id && (
          <div className="mt-3 text-right"><ReportButton targetType="group_event" targetId={ev.id} className="text-[11px] text-zinc-500 hover:text-amber-300" /></div>
        )}
      </article>
    </div>
  );
}
