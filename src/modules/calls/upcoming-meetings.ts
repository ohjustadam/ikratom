import { createClient } from "@/lib/supabase/server";

export type UpcomingMeeting = {
  id: string;
  state: string;
  locality: string | null;
  body_name: string | null;
  meeting_at: string;
  format: string;
  zoom_url: string | null;
  livestream_url: string | null;
  agenda_url: string | null;
  agenda_text: string | null;
  in_person_address: string | null;
  public_comment_signup_url: string | null;
};

/**
 * Upcoming approved meetings in the given state within the next N days.
 * Surfaces on /calls so users can see "meeting in 4 days, here's the
 * Zoom link" alongside their phone-call targets.
 */
export async function listUpcomingMeetingsForState(state: string | null, days = 14): Promise<UpcomingMeeting[]> {
  if (!state) return [];
  const sb = await createClient();
  const cutoff = new Date(Date.now() + days * 86_400_000).toISOString();
  const { data } = await sb
    .from("municipal_meetings")
    .select("id, state, locality, body_name, meeting_at, format, zoom_url, livestream_url, agenda_url, agenda_text, in_person_address, public_comment_signup_url")
    .eq("state", state)
    .eq("moderation_status", "approved")
    .gte("meeting_at", new Date().toISOString())
    .lte("meeting_at", cutoff)
    .order("meeting_at", { ascending: true });
  return (data ?? []) as UpcomingMeeting[];
}
