/**
 * Per-meeting iCalendar download — one event, ready to add to any
 * native calendar app via the download icon on /meetings/[id].
 *
 * Differs from /calendar/feed.ics (which is a subscription feed
 * spanning every event for the next 90 days): this is a single-event
 * .ics with no refresh expectations — user downloads, opens, taps
 * "Add to calendar", done.
 *
 * Useful for the live-broadcast flow where a push notification
 * delivers a /meetings/[id] link — the user lands and wants to add
 * this specific meeting to their calendar with one tap.
 */
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildIcalDocument } from "@/lib/ical";

export const dynamic = "force-dynamic";
export const revalidate = 300;

const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await createClient();
  const { data: m } = await sb
    .from("municipal_meetings")
    .select("id, state, locality, body_name, meeting_at, zoom_url, livestream_url, agenda_url, agenda_text, in_person_address, public_comment_signup_url, source_url, moderation_status")
    .eq("id", id)
    .maybeSingle();

  if (!m || m.moderation_status !== "approved") return notFound();

  const start = new Date(m.meeting_at);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const locationBits = [
    m.in_person_address || null,
    m.zoom_url ? `Zoom: ${m.zoom_url}` : null,
    m.livestream_url ? `Livestream: ${m.livestream_url}` : null,
  ].filter(Boolean) as string[];
  const descBits = [
    m.agenda_text || null,
    m.zoom_url ? `Zoom: ${m.zoom_url}` : null,
    m.livestream_url ? `Livestream: ${m.livestream_url}` : null,
    m.public_comment_signup_url ? `Sign up to speak: ${m.public_comment_signup_url}` : null,
    m.agenda_url ? `Agenda: ${m.agenda_url}` : null,
    `Detail: ${SITE}/meetings/${m.id}`,
  ].filter(Boolean) as string[];

  const title = `${m.locality ?? m.state ?? "Public meeting"} · ${m.body_name ?? "Meeting"} — kratom on agenda`;
  const body = buildIcalDocument({
    calendarName: title,
    description: `iKratom event — ${title}`,
    url: `${SITE}/meetings/${m.id}`,
    refreshHours: 6,
    events: [
      {
        uid: `municipal-${m.id}@ikratom.org`,
        start,
        end,
        title,
        description: descBits.join("\n\n"),
        location: locationBits[0] ?? "Virtual",
        url: `${SITE}/meetings/${m.id}`,
        categories: ["Kratom", "Municipal meeting"],
      },
    ],
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="ikratom-${id}.ics"`,
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
    },
  });
}
