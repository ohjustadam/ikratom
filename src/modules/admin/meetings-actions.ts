"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { sendPush, isPushConfigured } from "@/lib/push/send";
import { canPushUser, type PushGatePrefs } from "@/lib/notifications/push-gate";
import { flushOpenGraphCache } from "@/lib/og-cache-flush";

const VALID_STATUSES = ["pending_review", "approved", "rejected", "archived"] as const;
type Status = (typeof VALID_STATUSES)[number];

export async function listMeetingsForReview() {
  const ctx = await getAdminContext({ require: "edit_meetings" });
  if (!ctx.ok) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("municipal_meetings")
    .select("id, state, locality, body_name, meeting_at, format, zoom_url, livestream_url, agenda_url, agenda_text, source_url, ai_confidence, discovered_via, moderation_status, created_at, broadcast_at, broadcast_recipient_count")
    .in("moderation_status", ["pending_review", "approved"])
    .gte("meeting_at", new Date().toISOString())
    .order("meeting_at", { ascending: true })
    .limit(200);
  return data ?? [];
}

// ── Auto-approval policy (site_config singleton) ───────────────────────
// Lets admins make AI-extracted meetings hit the calendar without a
// manual click, gated by a confidence threshold + source requirement.
// scripts/auto-approve-meetings.mjs reads these values hourly.
export type MeetingAutoApprovePolicy = {
  enabled: boolean;
  minConfidence: number;
  requireSource: boolean;
};

export async function getMeetingAutoApprovePolicy(): Promise<MeetingAutoApprovePolicy> {
  const sb = await createClient();
  const { data } = await sb
    .from("site_config")
    .select("meeting_auto_approve_enabled, meeting_auto_approve_min_confidence, meeting_auto_approve_require_source")
    .eq("id", true)
    .maybeSingle();
  const row = (data as {
    meeting_auto_approve_enabled: boolean | null;
    meeting_auto_approve_min_confidence: number | null;
    meeting_auto_approve_require_source: boolean | null;
  } | null);
  return {
    enabled: row?.meeting_auto_approve_enabled ?? true,
    minConfidence: Number(row?.meeting_auto_approve_min_confidence ?? 0.85),
    requireSource: row?.meeting_auto_approve_require_source ?? true,
  };
}

export async function setMeetingAutoApprovePolicy(input: {
  enabled: boolean;
  minConfidence: number;
  requireSource: boolean;
}) {
  const ctx = await getAdminContext({ require: "edit_meetings" });
  if (!ctx.ok) return { error: "Admin only." };

  // Clamp confidence to a sane band so a fat-fingered value can't either
  // auto-approve everything (0) or nothing (>1).
  const conf = Math.max(0.5, Math.min(1, Number(input.minConfidence) || 0.85));

  const sb = await createClient();
  const { error } = await sb
    .from("site_config")
    .update({
      meeting_auto_approve_enabled: !!input.enabled,
      meeting_auto_approve_min_confidence: conf,
      meeting_auto_approve_require_source: !!input.requireSource,
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    })
    .eq("id", true);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "meeting_auto_approve_policy_updated",
    targetType: "user",
    targetId: ctx.userId,
    details: { enabled: !!input.enabled, minConfidence: conf, requireSource: !!input.requireSource },
  });

  revalidatePath("/admin/meetings");
  return { ok: true };
}

/**
 * Broadcast a meeting NOW — fires push notifications to all users in
 * the meeting's state + creates a critical-severity policy_alert that
 * surfaces on /pulse with the Zoom link.
 *
 * Marks the meeting as broadcast_at NOW so the admin UI shows
 * "📢 already broadcast to N users" instead of re-firing.
 *
 * Idempotent — if already broadcast, returns the previous counts.
 */
export async function broadcastMeeting(input: { id: string; force?: boolean }) {
  const ctx = await getAdminContext({ require: "edit_meetings" });
  if (!ctx.ok) return { error: "Admin only." };

  const sb = await createClient();
  const { data: meeting, error: readErr } = await sb
    .from("municipal_meetings")
    .select("*")
    .eq("id", input.id)
    .single();
  if (readErr || !meeting) return { error: readErr?.message ?? "Meeting not found." };
  if (meeting.broadcast_at && !input.force) {
    return {
      ok: true,
      already: true,
      broadcast_at: meeting.broadcast_at,
      recipient_count: meeting.broadcast_recipient_count ?? 0,
    };
  }
  if (meeting.moderation_status !== "approved") {
    return { error: "Meeting must be approved before broadcasting." };
  }

  // Use service-role client for the user-fanout reads (RLS-bypass on profiles).
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Find all in-state users + (as fallback for tiny user counts) FED-locality.
  const { data: targetUsers } = await admin
    .from("profiles")
    .select("id")
    .eq("state", meeting.state)
    .limit(50_000);
  const userIds = (targetUsers ?? []).map((u: { id: string }) => u.id);

  // Compose the notification payload
  const when = new Date(meeting.meeting_at);
  const title = `🚨 LIVE NOW: ${meeting.locality ?? meeting.state} ${meeting.body_name ?? "meeting"}`;
  const body = meeting.zoom_url
    ? `Kratom is on the agenda. Join the Zoom now or watch the livestream.`
    : `Kratom is on the agenda. Tap for the link.`;
  const link = `/calendar?state=${meeting.state}`;
  // Captured before we insert the meeting_live rows so the pushed_at stamp
  // below can be scoped to ONLY this broadcast's rows.
  const broadcastStartedAt = new Date().toISOString();

  // 1. In-app notifications inserted for every target user
  if (userIds.length > 0) {
    const rows = userIds.map((uid) => ({
      user_id: uid,
      kind: "meeting_live",
      title,
      body,
      link,
    }));
    // Chunk inserts to stay under the row-size limit
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await admin.from("notifications").insert(chunk);
    }
  }

  // 2. Web push fanout to all subscriptions for these users. LIVE-NOW stays
  // INSTANT (unlike the day-ahead reminders, which route through the fan-out),
  // but it now (a) honors the global push opt-out + the notify_meetings category
  // mute, and (b) stamps pushed_at on the rows it delivers so the hourly fan-out
  // does NOT re-buzz them (the double-buzz fix). DND/quiet-hours users are left
  // UNstamped so the fan-out delivers once their quiet window clears.
  let pushSent = 0;
  let pushHeld = 0;
  let pushSuppressed = 0;
  const pushGone: string[] = [];
  const pushedUserIds = new Set<string>();
  if (isPushConfigured() && userIds.length > 0) {
    type BroadcastPrefs = PushGatePrefs & {
      in_app?: boolean | null;
      digest?: string | null;
      notify_meetings?: boolean | null;
    };
    const { data: prefsRows } = await admin
      .from("notification_preferences")
      .select("user_id, dnd_enabled, quiet_hours_start, quiet_hours_end, timezone, in_app, digest, notify_meetings")
      .in("user_id", userIds);
    const prefsByUser = new Map<string, BroadcastPrefs>();
    for (const p of (prefsRows ?? []) as Array<BroadcastPrefs & { user_id: string }>) {
      prefsByUser.set(p.user_id, p);
    }
    const nowMs = Date.now();
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", userIds)
      .limit(10_000);
    const payload = { title, body, link, tag: `meeting-${meeting.id}` };
    for (const s of (subs ?? []) as Array<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }>) {
      const prefs = prefsByUser.get(s.user_id);
      // Global push opt-out or notify_meetings mute → never buzz. The fan-out
      // marks the in-app row delivered (in_app=false/digest='off') or the
      // insert trigger already dropped it (notify_meetings=false).
      if (prefs && (prefs.in_app === false || prefs.digest === "off" || prefs.notify_meetings === false)) { pushSuppressed++; continue; }
      // DND / quiet-hours → HOLD: leave the row for the fan-out to deliver later.
      if (!canPushUser(prefs, nowMs)) { pushHeld++; continue; }
      const r = await sendPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      if (r.ok) { pushSent++; pushedUserIds.add(s.user_id); }
      else if ("gone" in r && r.gone) pushGone.push(s.id);
    }
    // Prune dead subscriptions
    if (pushGone.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", pushGone);
    }
    if (pushedUserIds.size > 0) {
      const pushedList = [...pushedUserIds];
      // Stamp last_push_at so the fan-out cron's rate-cap accounts for this buzz.
      await admin
        .from("notification_preferences")
        .update({ last_push_at: new Date().toISOString() })
        .in("user_id", pushedList);
      // Stamp pushed_at on the meeting_live rows we just delivered so the hourly
      // fan-out doesn't re-buzz them. Scoped to THIS broadcast's rows.
      await admin
        .from("notifications")
        .update({ pushed_at: new Date().toISOString() })
        .in("user_id", pushedList)
        .eq("kind", "meeting_live")
        .is("pushed_at", null)
        .gte("created_at", broadcastStartedAt);
    }
  }

  // 3. Create a critical policy_alert that surfaces on /pulse with the Zoom link
  const alertBody =
    `Live meeting in ${meeting.locality ?? meeting.state}: kratom is on the agenda right now.\n\n` +
    (meeting.zoom_url ? `**Join Zoom:** ${meeting.zoom_url}\n\n` : "") +
    (meeting.livestream_url ? `**Livestream:** ${meeting.livestream_url}\n\n` : "") +
    (meeting.agenda_url ? `**Agenda:** ${meeting.agenda_url}\n\n` : "") +
    (meeting.in_person_address ? `**In person:** ${meeting.in_person_address}\n\n` : "") +
    (meeting.public_comment_signup_url ? `**Sign up to speak:** ${meeting.public_comment_signup_url}\n\n` : "") +
    (meeting.agenda_text ? `\n_Agenda excerpt:_\n${meeting.agenda_text.slice(0, 500)}` : "");

  await admin.from("policy_alerts").insert({
    kind: "bop_hearing", // closest existing kind for a public-meeting alert
    severity: "critical",
    title: `🚨 LIVE: ${meeting.locality ?? meeting.state} ${meeting.body_name ?? "meeting"} — kratom on agenda`,
    body: alertBody,
    locality: meeting.state,
    source_url: meeting.agenda_url ?? meeting.source_url,
    occurs_at: when.toISOString(),
    expires_at: new Date(when.getTime() + 6 * 60 * 60 * 1000).toISOString(), // 6h
    action_required: true,
    moderation_status: "approved",
    // Pre-stamp so push-critical-alerts.mjs (which fans out approved alerts with
    // auto_pushed_at IS NULL) does NOT re-push this to the same in-state users —
    // they already got the LIVE-NOW meeting_live buzz above. This alert exists
    // for /pulse visibility, not a third notification (the triple-touch fix).
    auto_pushed_at: new Date().toISOString(),
  });

  // 4. Mark broadcast complete
  await admin.from("municipal_meetings").update({
    broadcast_at: new Date().toISOString(),
    broadcast_recipient_count: userIds.length,
    broadcast_by: ctx.userId,
  }).eq("id", input.id);

  // 5. Flush OG cache so the share URL preview is fresh on FB / Messenger.
  // Fire-and-forget — never blocks the broadcast on cache-flush.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";
  flushOpenGraphCache(`${appUrl}/meetings/${input.id}`).catch((e) => {
    console.error("[og-flush] meeting", input.id, e);
  });

  await recordAdminAction({
    action: "municipal_meeting_broadcast",
    targetType: "policy_alert",
    targetId: input.id,
    details: {
      state: meeting.state,
      locality: meeting.locality,
      user_count: userIds.length,
      push_sent: pushSent,
      push_held: pushHeld,
      push_suppressed: pushSuppressed,
      push_pruned: pushGone.length,
      zoom_url: meeting.zoom_url ?? null,
    },
  });

  revalidatePath("/admin/meetings");
  revalidatePath("/calendar");
  revalidatePath("/pulse");
  revalidatePath("/calls");
  return {
    ok: true,
    user_count: userIds.length,
    push_sent: pushSent,
    push_pruned: pushGone.length,
  };
}

export async function setMeetingStatus(input: { id: string; status: string; note?: string }) {
  const ctx = await getAdminContext({ require: "edit_meetings" });
  if (!ctx.ok) return { error: "Admin only." };
  if (!VALID_STATUSES.includes(input.status as Status)) return { error: "Invalid status." };

  const sb = await createClient();
  const { error } = await sb
    .from("municipal_meetings")
    .update({
      moderation_status: input.status,
      moderation_reviewed_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "municipal_meeting_moderated",
    targetType: "policy_alert",
    targetId: input.id,
    details: { status: input.status, note: input.note ?? null },
  });

  revalidatePath("/admin/meetings");
  revalidatePath("/calls");
  return { ok: true };
}
