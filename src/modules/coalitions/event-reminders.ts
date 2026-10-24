import type { SupabaseClient } from "@supabase/supabase-js";
import { eventPath, formatEventWhen } from "./events";

/**
 * Group event reminders (migration 0283), run by the hourly fire-waves cron
 * just before the push fan-out, so a reminder reaches the phone in the same
 * tick. Two stages for members who RSVP'd going or maybe:
 *   - "day":  the event starts within 24 h;
 *   - "soon": it starts within 2 h (hourly cadence → 1–2 h of notice).
 * Each stage is claimed with a compare-and-set on reminder_*_sent_at, so an
 * overlapping or repeated run can't send twice. Rows go into `notifications`
 * only; fanoutPushNotifications decides delivery (opt-outs, quiet hours,
 * coalescing), per the platform rule that nothing pushes directly.
 */

type Due = {
  id: string;
  title: string;
  starts_at: string;
  timezone: string;
  reminder_day_sent_at: string | null;
  coalitions: { slug: string; name: string } | { slug: string; name: string }[] | null;
};

export async function sendGroupEventReminders(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<{ events: number; notified: number }> {
  const { data, error } = await supabase
    .from("coalition_events")
    .select("id, title, starts_at, timezone, reminder_day_sent_at, coalitions(slug, name)")
    .is("cancelled_at", null)
    .is("reminder_soon_sent_at", null)
    .gt("starts_at", now.toISOString())
    .lte("starts_at", new Date(now.getTime() + 24 * 3_600_000).toISOString())
    .order("starts_at")
    .limit(200);
  if (error || !data) return { events: 0, notified: 0 };

  let events = 0;
  let notified = 0;
  for (const ev of data as Due[]) {
    const group = Array.isArray(ev.coalitions) ? ev.coalitions[0] : ev.coalitions;
    if (!group) continue;
    const soon = new Date(ev.starts_at).getTime() - now.getTime() <= 2 * 3_600_000;
    if (!soon && ev.reminder_day_sent_at) continue;

    // Claim the stage. "soon" also closes "day", so nobody gets both at once.
    const stamp = now.toISOString();
    const claim = soon
      ? supabase.from("coalition_events")
          .update({ reminder_soon_sent_at: stamp, reminder_day_sent_at: ev.reminder_day_sent_at ?? stamp })
          .eq("id", ev.id).is("reminder_soon_sent_at", null)
      : supabase.from("coalition_events")
          .update({ reminder_day_sent_at: stamp })
          .eq("id", ev.id).is("reminder_day_sent_at", null);
    const { data: claimed } = await claim.select("id");
    if (!claimed || claimed.length === 0) continue;
    events++;

    const { data: rsvps } = await supabase
      .from("coalition_event_rsvps").select("user_id").eq("event_id", ev.id).in("status", ["going", "maybe"]);
    const userIds = (rsvps ?? []).map((r) => r.user_id as string);
    if (userIds.length === 0) continue;

    const when = formatEventWhen(ev.starts_at, ev.timezone);
    const { error: insErr } = await supabase.from("notifications").insert(userIds.map((user_id) => ({
      user_id,
      kind: "coalition_event",
      title: soon ? `Starting soon: ${ev.title}` : `Reminder: ${ev.title}`,
      body: `${group.name} · ${when}`,
      link: eventPath(group.slug, ev.id),
    })));
    if (!insErr) notified += userIds.length;
  }
  return { events, notified };
}
