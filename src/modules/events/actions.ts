"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";

import { EVENT_TYPE_LABELS } from "./labels";

const VALID_TYPES = Object.keys(EVENT_TYPE_LABELS);

export async function createEvent(formData: FormData) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Admin or leader only." };

  const cap = (s: string, n: number) => s.slice(0, n).trim();
  const stateRaw = cap(String(formData.get("state") ?? ""), 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(stateRaw)) return { error: "State is required (2-letter)." };

  const title = cap(String(formData.get("title") ?? ""), 200);
  if (!title) return { error: "Title is required." };

  const startsAtRaw = cap(String(formData.get("starts_at") ?? ""), 32);
  if (!startsAtRaw) return { error: "Start date/time is required." };
  const startsAt = new Date(startsAtRaw);
  if (Number.isNaN(startsAt.getTime())) return { error: "Invalid start date/time." };

  const endsAtRaw = cap(String(formData.get("ends_at") ?? ""), 32);
  const endsAt = endsAtRaw ? new Date(endsAtRaw) : null;
  if (endsAt && Number.isNaN(endsAt.getTime())) return { error: "Invalid end date/time." };

  const eventType = cap(String(formData.get("event_type") ?? "town_hall"), 30);
  if (!VALID_TYPES.includes(eventType)) return { error: "Invalid event type." };

  const description = cap(String(formData.get("description") ?? ""), 2000) || null;
  const venue = cap(String(formData.get("venue") ?? ""), 300) || null;
  const sourceUrl = cap(String(formData.get("source_url") ?? ""), 1000) || null;
  const locality = cap(String(formData.get("locality") ?? ""), 120) || null;

  const legislatorIdRaw = cap(String(formData.get("legislator_id") ?? ""), 36);
  const legislatorId = /^[0-9a-f-]{36}$/i.test(legislatorIdRaw) ? legislatorIdRaw : null;

  const supabase = await createClient();
  const { error, data: row } = await supabase
    .from("legislator_events")
    .insert({
      legislator_id: legislatorId,
      state: stateRaw,
      locality,
      title,
      description,
      event_type: eventType,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt?.toISOString() ?? null,
      venue,
      source_url: sourceUrl,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "event_created",
    targetType: "user",
    targetId: ctx.userId,
    details: { event_id: row.id, state: stateRaw, title, starts_at: startsAt.toISOString() },
  });
  revalidatePath("/events");
  redirect("/events");
}

export async function cancelEvent(eventId: string) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Admin or leader only." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("legislator_events")
    .update({ active: false })
    .eq("id", eventId);
  if (error) return { error: error.message };
  revalidatePath("/events");
  return { ok: true };
}

export async function listUpcomingEvents(input?: { state?: string; limit?: number }) {
  const supabase = await createClient();
  const now = new Date().toISOString();
  let q = supabase
    .from("legislator_events")
    .select("id, legislator_id, state, locality, title, description, event_type, starts_at, ends_at, venue, source_url, legislators(full_name, role, party)")
    .eq("active", true)
    .gte("starts_at", now);
  if (input?.state && /^[A-Z]{2}$/.test(input.state)) {
    q = q.eq("state", input.state);
  }
  const { data } = await q
    .order("starts_at", { ascending: true })
    .limit(input?.limit ?? 50);
  return data ?? [];
}

/**
 * Upcoming auto-discovered civic meetings (city/county council + board
 * hearings where kratom is on the agenda) from municipal_meetings. Approved +
 * future only; public-readable (RLS allows approved). Merged into /events so
 * the page reflects the meeting tracker, not just hand-added legislator events.
 */
export async function listUpcomingMeetings(input?: { state?: string; limit?: number }) {
  const supabase = await createClient();
  const now = new Date().toISOString();
  let q = supabase
    .from("municipal_meetings")
    .select(
      "id, state, locality, body_name, meeting_at, meeting_end_at, format, zoom_url, livestream_url, agenda_url, agenda_text, in_person_address, public_comment_signup_url, source_url",
    )
    .eq("moderation_status", "approved")
    .gte("meeting_at", now);
  if (input?.state && /^[A-Z]{2}$/.test(input.state)) {
    q = q.eq("state", input.state);
  }
  const { data } = await q
    .order("meeting_at", { ascending: true })
    .limit(input?.limit ?? 100);
  return data ?? [];
}
