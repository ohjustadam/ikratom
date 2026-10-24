"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertNotReadOnly } from "@/lib/read-only-mode";
import { checkRateLimit } from "@/lib/rate-limit";
import { EVENT_KINDS, type EventKind, eventPath, formatEventWhen, safeTimeZone } from "./events";

/**
 * Group events (migration 0283, owner pick B15a 2026-10-24). Writes go through
 * the USER's client, so RLS proves the role (organizers post, members RSVP);
 * the checks here exist to return a readable error. Notifications use the
 * service role and carry only the event's title and time, never who RSVP'd.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;
const DAY_MS = 86_400_000;

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function groupContext(slug: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." } as const;
  const { data: c } = await supabase.from("coalitions").select("id, slug, name").eq("slug", slug).maybeSingle();
  if (!c) return { error: "Group not found." } as const;
  const { data: m } = await supabase
    .from("coalition_members").select("role").eq("coalition_id", c.id).eq("user_id", user.id).maybeSingle();
  if (!m) return { error: "Only members of this group can do that." } as const;
  return { supabase, user, coalition: c, isOrganizer: m.role === "owner" || m.role === "admin" } as const;
}

async function notify(userIds: string[], title: string, body: string, link: string) {
  if (userIds.length === 0) return;
  const admin = createServiceRoleClient();
  await admin.from("notifications").insert(
    userIds.map((user_id) => ({ user_id, kind: "coalition_event", title, body, link })),
  ).then(() => {}, () => {}); // a missed notice must never fail the event
}

export type NewEventInput = {
  kind: string;
  title: string;
  details?: string;
  startsAt: string;      // ISO instant, computed in the organizer's browser
  durationMinutes?: number;
  timezone?: string;     // the organizer's IANA zone
  location?: string;
  linkUrl?: string;
  campaignSlug?: string | null;
};

export async function createGroupEvent(slug: string, input: NewEventInput): Promise<Ok<{ id: string }>> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };

  const kind = (EVENT_KINDS as readonly string[]).includes(input.kind) ? (input.kind as EventKind) : "other";
  const title = String(input.title ?? "").trim();
  if (title.length < 3 || title.length > 120) return { ok: false, error: "Give it a title of 3–120 characters." };
  const details = String(input.details ?? "").trim().slice(0, 2000) || null;
  const location = String(input.location ?? "").trim().slice(0, 300) || null;
  const linkUrl = String(input.linkUrl ?? "").trim() || null;
  if (linkUrl && (!/^https:\/\/\S+$/i.test(linkUrl) || linkUrl.length > 500)) {
    return { ok: false, error: "The link must start with https://" };
  }
  const start = new Date(String(input.startsAt ?? ""));
  if (Number.isNaN(start.getTime())) return { ok: false, error: "Pick a date and time." };
  if (start.getTime() < Date.now() - 3_600_000) return { ok: false, error: "That time has already passed." };
  if (start.getTime() > Date.now() + 365 * DAY_MS) return { ok: false, error: "Pick a date within the next year." };
  const minutes = Math.min(Math.max(Math.round(Number(input.durationMinutes) || 60), 15), 12 * 60);
  const timezone = safeTimeZone(input.timezone);

  const ctx = await groupContext(slug);
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Not allowed." };
  if (!ctx.isOrganizer) return { ok: false, error: "Only the group's organizers can post events." };
  if (!(await checkRateLimit(`coalition:event:${ctx.user.id}`, 10, 86_400))) {
    return { ok: false, error: "You've posted several events today. Try again tomorrow." };
  }

  let campaignId: string | null = null;
  if (input.campaignSlug) {
    const { data: camp } = await ctx.supabase.from("campaigns").select("id, active").eq("slug", input.campaignSlug).maybeSingle();
    if (camp?.active) campaignId = camp.id;
  }

  // Posted less than a day out: the "new event" notice is the day-before reminder.
  const soon = start.getTime() - Date.now() < 26 * 3_600_000;
  const { data, error } = await ctx.supabase.from("coalition_events").insert({
    coalition_id: ctx.coalition.id, created_by: ctx.user.id, kind, title, details,
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
    timezone, location, link_url: linkUrl, campaign_id: campaignId,
    reminder_day_sent_at: soon ? new Date().toISOString() : null,
  }).select("id").single();
  if (error || !data) return { ok: false, error: "Couldn't save the event. Try again." };

  const { data: others } = await ctx.supabase
    .from("coalition_members").select("user_id").eq("coalition_id", ctx.coalition.id).neq("user_id", ctx.user.id);
  await notify(
    (others ?? []).map((o) => o.user_id),
    `New event in ${ctx.coalition.name}: ${title}`,
    `${formatEventWhen(start.toISOString(), timezone)}. Tap to RSVP.`,
    eventPath(ctx.coalition.slug, data.id),
  );

  revalidatePath(`/coalitions/${slug}`);
  return { ok: true, id: data.id };
}

export async function rsvpGroupEvent(slug: string, eventId: string, status: "going" | "maybe" | "no" | null): Promise<Ok> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  if (!UUID_RE.test(eventId)) return { ok: false, error: "Event not found." };
  const ctx = await groupContext(slug);
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Not allowed." };
  if (!(await checkRateLimit(`coalition:rsvp:${ctx.user.id}`, 60, 3600))) {
    return { ok: false, error: "That's a lot of RSVPs. Give it a minute." };
  }

  const { data: ev } = await ctx.supabase
    .from("coalition_events").select("id").eq("id", eventId).eq("coalition_id", ctx.coalition.id).is("cancelled_at", null).maybeSingle();
  if (!ev) return { ok: false, error: "This event isn't open for RSVPs." };

  const rsvps = ctx.supabase.from("coalition_event_rsvps");
  const { error } = status === null
    ? await rsvps.delete().eq("event_id", eventId).eq("user_id", ctx.user.id)
    : await rsvps.upsert({ event_id: eventId, user_id: ctx.user.id, status, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "Couldn't save your RSVP. Try again." };

  revalidatePath(eventPath(slug, eventId));
  revalidatePath(`/coalitions/${slug}`);
  return { ok: true };
}

export async function cancelGroupEvent(slug: string, eventId: string): Promise<Ok> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  if (!UUID_RE.test(eventId)) return { ok: false, error: "Event not found." };
  const ctx = await groupContext(slug);
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Not allowed." };
  if (!ctx.isOrganizer) return { ok: false, error: "Only the group's organizers can cancel events." };

  const { data, error } = await ctx.supabase.from("coalition_events")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", eventId).eq("coalition_id", ctx.coalition.id).is("cancelled_at", null)
    .select("title, starts_at, timezone");
  // RLS turns "not allowed" into zero rows, not an error.
  if (error || !data || data.length === 0) return { ok: false, error: "Couldn't cancel that event." };

  // Tell the people who said they'd come. RSVP rows are own-row-only, so read them as the service role.
  const admin = createServiceRoleClient();
  const { data: rsvps } = await admin
    .from("coalition_event_rsvps").select("user_id").eq("event_id", eventId).in("status", ["going", "maybe"]).neq("user_id", ctx.user.id);
  await notify(
    (rsvps ?? []).map((r) => r.user_id),
    `Cancelled: ${data[0].title}`,
    `${ctx.coalition.name} cancelled the event on ${formatEventWhen(data[0].starts_at, data[0].timezone)}.`,
    `/coalitions/${ctx.coalition.slug}#events`,
  );

  revalidatePath(eventPath(slug, eventId));
  revalidatePath(`/coalitions/${slug}`);
  return { ok: true };
}
