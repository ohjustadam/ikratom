/**
 * One group event as a .ics download (migration 0283). Read with the member's
 * own session, so RLS keeps it members-only, and never cached: unlike
 * /meetings/[id]/event.ics, this is private to the group.
 */
import { createClient } from "@/lib/supabase/server";
import { EVENT_COLUMNS, groupEventIcs, type GroupEvent } from "@/modules/coalitions/events";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; eventId: string }> }) {
  const { slug, eventId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return new Response("Not found", { status: 404 });
  const sb = await createClient();
  const { data: c } = await sb.from("coalitions").select("id, slug, name").eq("slug", slug).maybeSingle();
  if (!c) return new Response("Not found", { status: 404 });
  const { data: ev } = await sb.from("coalition_events").select(EVENT_COLUMNS)
    .eq("id", eventId).eq("coalition_id", c.id).is("cancelled_at", null).maybeSingle();
  if (!ev) return new Response("Not found", { status: 404 });

  return new Response(groupEventIcs(ev as GroupEvent, c), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="ikratom-group-event.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
