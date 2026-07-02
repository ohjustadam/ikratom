"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAdminContext } from "./actions";
import { recordAdminAction } from "@/lib/audit";

/**
 * Admin-only moderation tools for the Lounge chat.
 *
 * RLS already lets owner/admin delete any chat row + read all profiles, but
 * we centralize moderation here so:
 *   1. Every action is audit-logged (`mod.chat_*`)
 *   2. We can reject non-admins with a clear error before doing the work
 *   3. The /admin/lounge UI can call typed actions instead of building
 *      Supabase queries client-side
 */

const MAX_BULK = 200;
const MAX_HOURS = 24 * 365 * 5; // five-year hard cap on a single mute

type ListedMessage = {
  id: string;
  user_id: string;
  room: string;
  body: string;
  created_at: string;
  author_name: string | null;
  author_is_muted: boolean;
};

export async function listRecentChatMessages(opts: {
  room?: string;
  limit?: number;
  beforeIso?: string;
} = {}): Promise<{ ok: true; rows: ListedMessage[] } | { error: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const supabase = await createClient();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const room = opts.room?.trim() || "lounge";

  let query = supabase
    .from("chat_messages")
    .select("id, user_id, room, body, created_at")
    .eq("room", room)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (opts.beforeIso) query = query.lt("created_at", opts.beforeIso);

  const { data: msgs, error } = await query;
  if (error) return { error: error.message };

  const ids = Array.from(new Set((msgs ?? []).map((m) => m.user_id)));
  const { data: profiles } = ids.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, chat_muted_until")
        .in("id", ids)
    : { data: [] as { id: string; full_name: string | null; chat_muted_until: string | null }[] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const now = Date.now();
  const rows: ListedMessage[] = (msgs ?? []).map((m) => {
    const prof = byId.get(m.user_id);
    const muted = !!(prof?.chat_muted_until && new Date(prof.chat_muted_until).getTime() > now);
    return {
      id: m.id,
      user_id: m.user_id,
      room: m.room,
      body: m.body,
      created_at: m.created_at,
      author_name: prof?.full_name ?? null,
      author_is_muted: muted,
    };
  });
  return { ok: true, rows };
}

export async function bulkDeleteChatMessages(ids: string[]) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Nothing selected." };
  if (ids.length > MAX_BULK) return { error: `Bulk delete capped at ${MAX_BULK} per call.` };
  // UUID hygiene — refuse anything that isn't a UUID
  const ok = ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (!ok) return { error: "Invalid id in selection." };

  const supabase = await createClient();
  const { error } = await supabase.from("chat_messages").delete().in("id", ids);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "mod.chat_bulk_delete",
    details: { count: ids.length },
  });
  revalidatePath("/admin/lounge");
  revalidatePath("/forum");
  return { ok: true, deleted: ids.length };
}

/**
 * Mute a user from the lounge for `hours` hours, or "forever" (= 5 years).
 * Calling with `hours=0` is treated as unmute (clear).
 */
export async function muteUserFromChat(input: {
  userId: string;
  hours: number | "forever";
  reason?: string;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const userId = (input.userId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { error: "Invalid user id." };

  let until: string | null;
  let durationHours: number | null;
  if (input.hours === "forever") {
    until = new Date(Date.now() + MAX_HOURS * 3600_000).toISOString();
    durationHours = MAX_HOURS;
  } else if (input.hours === 0) {
    until = null;
    durationHours = null;
  } else {
    const h = Number(input.hours);
    if (!Number.isFinite(h) || h <= 0 || h > MAX_HOURS) {
      return { error: `Hours must be between 1 and ${MAX_HOURS}.` };
    }
    until = new Date(Date.now() + h * 3600_000).toISOString();
    durationHours = h;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ chat_muted_until: until })
    .eq("id", userId);
  if (error) return { error: error.message };

  // Log mute event so we can compute cumulative mute time → ban-review.
  // Unmutes (durationHours=null) don't add a row — the trail is only of
  // restrictive actions, not their reversal.
  if (durationHours !== null) {
    await supabase.from("chat_mute_history").insert({
      user_id: userId,
      muted_by: ctx.userId,
      duration_hours: durationHours,
      reason: input.reason ?? null,
    });
  }

  await recordAdminAction({
    action: until ? "mod.chat_mute" : "mod.chat_unmute",
    targetType: "user",
    targetId: userId,
    details: until ? { until, reason: input.reason ?? null } : { reason: input.reason ?? null },
  });
  revalidatePath("/admin/lounge");
  return { ok: true, until };
}

export async function unmuteUserFromChat(userId: string) {
  return muteUserFromChat({ userId, hours: 0 });
}

/**
 * Drop everything in the lounge older than `hoursOld` hours. Defaults to
 * 24 — handy for the "fresh start every morning" workflow without wiping
 * recent context. Pass 0 to clear the entire room.
 */
export async function clearOldLoungeMessages(hoursOld = 24, room = "lounge") {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const supabase = await createClient();
  const cutoff = hoursOld > 0
    ? new Date(Date.now() - hoursOld * 3600_000).toISOString()
    : new Date().toISOString();

  let query = supabase.from("chat_messages").delete().eq("room", room);
  if (hoursOld > 0) query = query.lt("created_at", cutoff);
  // .select() after delete returns the rows that were deleted; we just
  // count them locally. Supabase-js doesn't support the count: option on
  // a chained delete().select().
  const { error, data } = await query.select("id");
  if (error) return { error: error.message };
  const deleted = (data ?? []).length;

  await recordAdminAction({
    action: "mod.chat_clear",
    details: { hoursOld, room, deleted },
  });
  revalidatePath("/admin/lounge");
  revalidatePath("/forum");
  return { ok: true, deleted };
}

export async function listMutedChatUsers() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_muted_users")
    .select("id, full_name, chat_muted_until")
    .order("chat_muted_until", { ascending: false });
  if (error) return { error: error.message };
  return { ok: true, rows: data ?? [] };
}

/**
 * Users whose cumulative mute history (capped at 168h per event) is at
 * or above the 72-hour ban-review threshold. Surfaces in /admin/lounge so
 * the owner can decide: revoke, permaban, or reset history.
 */
export async function listBanReviewQueue() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_ban_review_queue");
  if (error) return { error: error.message };
  return {
    ok: true,
    rows: (data ?? []) as {
      user_id: string;
      full_name: string | null;
      mute_count: number;
      total_capped_hours: number;
      current_mute_until: string | null;
    }[],
  };
}

/**
 * Wipe a user's mute history without unmuting them. Use after reviewing
 * — "warning given, fresh slate" — so a 4th offense isn't compared to
 * historical sins. The current mute (if any) is untouched.
 */
export async function clearMuteHistory(userId: string) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { error: "Invalid user id." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_mute_history")
    .delete()
    .eq("user_id", userId);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "mod.chat_history_clear",
    targetType: "user",
    targetId: userId,
  });
  revalidatePath("/admin/lounge");
  return { ok: true };
}

// ── D4: AI abuse-moderation hold queue ──────────────────────────────────────

export type HeldChatMessage = {
  id: string;
  user_id: string;
  username: string | null; // @handle — public-safe identity, never full_name
  room: string;
  body: string;
  category: string | null;
  reason: string | null;
  ai_confidence: number | null;
  created_at: string;
};

/** Pending held messages, newest first, with the author's @handle. */
export async function listHeldChatMessages(): Promise<
  { ok: true; rows: HeldChatMessage[] } | { error: string }
> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  const admin = createServiceRoleClient();
  const { data: held, error } = await admin
    .from("chat_moderation_queue")
    .select("id, user_id, room, body, category, reason, ai_confidence, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { error: error.message };

  const ids = Array.from(new Set((held ?? []).map((h) => h.user_id)));
  const { data: profiles } = ids.length
    ? await admin.from("profiles").select("id, username").in("id", ids)
    : { data: [] as { id: string; username: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.username]));

  return {
    ok: true,
    rows: (held ?? []).map((h) => ({ ...h, username: nameById.get(h.user_id) ?? null })),
  };
}

/** Approve a held message: post it as the original author, mark released.
 *  Form action → returns void; the page is already admin-gated. */
export async function releaseHeldMessage(formData: FormData): Promise<void> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return;
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;

  const admin = createServiceRoleClient();
  const { data: row } = await admin
    .from("chat_moderation_queue")
    .select("id, user_id, room, body, status")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.status !== "pending") return;

  // Post it (service-role bypasses the insert-own RLS) as the original author.
  const { error: insErr } = await admin
    .from("chat_messages")
    .insert({ user_id: row.user_id, room: row.room, body: row.body });
  if (insErr) {
    console.error("releaseHeldMessage: insert failed", insErr.message);
    return;
  }

  await admin
    .from("chat_moderation_queue")
    .update({ status: "released", reviewed_by: ctx.userId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  await recordAdminAction({ action: "mod.chat_release", details: { held_id: id } });
  revalidatePath("/admin/lounge");
}

/** Reject a held message: mark dismissed, never posts. Form action → void. */
export async function dismissHeldMessage(formData: FormData): Promise<void> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return;
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("chat_moderation_queue")
    .update({ status: "dismissed", reviewed_by: ctx.userId, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) {
    console.error("dismissHeldMessage: update failed", error.message);
    return;
  }
  await recordAdminAction({ action: "mod.chat_dismiss", details: { held_id: id } });
  revalidatePath("/admin/lounge");
}
