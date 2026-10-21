"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertNotReadOnly } from "@/lib/read-only-mode";
import { checkRateLimit } from "@/lib/rate-limit";
import { renderQrSvg } from "@/modules/partners/qr";

/**
 * Group growth (migration 0274, owner pick 2026-10-21): a reusable group link
 * with QR + referral credit, join requests for public groups, and "this
 * week's group action". Roles are re-checked server-side on every call; the
 * service role is used only AFTER the caller is proven to be a group
 * owner/admin, because coalitions' UPDATE policy is owner-only.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;
const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function code(len = 12) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

/** The caller's role in a group, or null. Read through the user's own client (RLS). */
async function groupRole(coalitionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !UUID_RE.test(coalitionId)) return { supabase, user: null, role: null } as const;
  const { data } = await supabase
    .from("coalition_members").select("role")
    .eq("coalition_id", coalitionId).eq("user_id", user.id).maybeSingle();
  return { supabase, user, role: (data?.role as "owner" | "admin" | "member" | undefined) ?? null } as const;
}
const isGroupAdmin = (role: string | null) => role === "owner" || role === "admin";

/**
 * The group's one reusable link + QR. Anyone with it can join; a new person
 * signs up first, and `?via=` credits the sharer as their referrer (the
 * site-wide AttributionCapture reads it).
 */
export async function getGroupLink(coalitionId: string): Promise<{ ok: true; url: string; qrSvg: string } | { ok: false; error: string }> {
  const { user, role } = await groupRole(coalitionId);
  if (!user) return { ok: false, error: "Sign in first." };
  if (!role) return { ok: false, error: "Only members can share the group link." };

  const admin = createServiceRoleClient();
  let { data: link } = await admin
    .from("coalition_invites").select("code")
    .eq("coalition_id", coalitionId).eq("reusable", true)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!link) {
    // Only owners/admins mint the link; members can then share it.
    if (!isGroupAdmin(role)) return { ok: false, error: "Ask the group's organizer to turn on the group link." };
    const { data: created, error } = await admin.from("coalition_invites").insert({
      coalition_id: coalitionId, code: code(), created_by: user.id, reusable: true,
      max_uses: 100000, expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    }).select("code").single();
    if (error || !created) return { ok: false, error: "Couldn't make the link. Try again." };
    link = created;
  }

  const { data: me } = await admin.from("profiles").select("invite_code").eq("id", user.id).maybeSingle();
  const via = me?.invite_code ? `?via=${encodeURIComponent(me.invite_code)}` : "";
  const url = `${SITE}/coalitions/join/${link.code}${via}`;
  return { ok: true, url, qrSvg: await renderQrSvg(url, { size: 240 }) };
}

/** Make the group public (landing page + "Request to join") or private again. */
export async function setGroupVisibility(coalitionId: string, isPublic: boolean): Promise<{ ok: boolean; error?: string }> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  const { role } = await groupRole(coalitionId);
  if (!isGroupAdmin(role)) return { ok: false, error: "Only the group's organizers can change this." };
  const admin = createServiceRoleClient();
  const { data, error } = await admin.from("coalitions").update({ is_public: !!isPublic }).eq("id", coalitionId).select("slug").single();
  if (error || !data) return { ok: false, error: "Couldn't save that." };
  revalidatePath(`/coalitions/${data.slug}`);
  return { ok: true };
}

/** A signed-in non-member asks to join a PUBLIC group (RLS enforces both). */
export async function requestToJoin(coalitionId: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  const { supabase, user, role } = await groupRole(coalitionId);
  if (!user) return { ok: false, error: "Sign in to ask to join." };
  if (role) return { ok: false, error: "You're already a member." };
  if (!(await checkRateLimit(`coalition:join-request:${user.id}`, 5, 3600))) {
    return { ok: false, error: "You've sent several requests this hour. Try again later." };
  }
  const msg = String(message ?? "").trim().slice(0, 500) || null;
  const { error } = await supabase.from("coalition_join_requests")
    .insert({ coalition_id: coalitionId, user_id: user.id, message: msg });
  if (error) {
    return { ok: false, error: error.code === "23505" ? "Your request is already waiting for the organizer." : "This group isn't taking requests." };
  }
  // Tell the organizers. Title only; the requester shows as a request, not a name.
  const admin = createServiceRoleClient();
  const { data: c } = await admin.from("coalitions").select("name, slug").eq("id", coalitionId).single();
  const { data: admins } = await admin.from("coalition_members").select("user_id").eq("coalition_id", coalitionId).in("role", ["owner", "admin"]);
  if (c && admins?.length) {
    await admin.from("notifications").insert(admins.map((a) => ({
      user_id: a.user_id, kind: "coalition_join_request",
      title: `Someone asked to join ${c.name}`, body: "Review it on your group page.", link: `/coalitions/${c.slug}#join-requests`,
    }))).then(() => {}, () => {});
  }
  return { ok: true };
}

/** Approve or decline a join request (decide_coalition_join_request checks the role). */
export async function decideJoinRequest(requestId: string, approve: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!UUID_RE.test(requestId)) return { ok: false, error: "Not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_coalition_join_request", { p_request_id: requestId, p_approve: !!approve });
  if (error) return { ok: false, error: "Only the group's organizers can do that." };
  if (data === "not_pending") return { ok: false, error: "Already handled." };
  const admin = createServiceRoleClient();
  const { data: req } = await admin.from("coalition_join_requests").select("user_id, coalition_id").eq("id", requestId).single();
  const { data: c } = req ? await admin.from("coalitions").select("name, slug").eq("id", req.coalition_id).single() : { data: null };
  if (req && c && approve) {
    await admin.from("notifications").insert({
      user_id: req.user_id, kind: "coalition_join_request",
      title: `You're in: ${c.name}`, body: "Your request to join was approved.", link: `/coalitions/${c.slug}`,
    }).then(() => {}, () => {});
  }
  if (c) revalidatePath(`/coalitions/${c.slug}`);
  return { ok: true };
}

/** Feature one live campaign as "this week's group action" (or clear it). */
export async function setGroupAction(coalitionId: string, campaignSlug: string | null, note: string): Promise<{ ok: boolean; error?: string }> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  const { user, role } = await groupRole(coalitionId);
  if (!user || !isGroupAdmin(role)) return { ok: false, error: "Only the group's organizers can pick the group action." };
  const admin = createServiceRoleClient();
  let campaignId: string | null = null;
  if (campaignSlug) {
    const { data: camp } = await admin.from("campaigns").select("id, active").eq("slug", campaignSlug).maybeSingle();
    if (!camp?.active) return { ok: false, error: "That campaign isn't live." };
    campaignId = camp.id;
  }
  const { data, error } = await admin.from("coalitions").update({
    featured_campaign_id: campaignId,
    featured_note: String(note ?? "").trim().slice(0, 200) || null,
    featured_set_at: campaignId ? new Date().toISOString() : null,
  }).eq("id", coalitionId).select("slug, name").single();
  if (error || !data) return { ok: false, error: "Couldn't save that." };

  if (campaignId) {
    const { data: members } = await admin.from("coalition_members").select("user_id").eq("coalition_id", coalitionId).neq("user_id", user.id);
    if (members?.length) {
      await admin.from("notifications").insert(members.map((m) => ({
        user_id: m.user_id, kind: "coalition_action",
        title: `New group action in ${data.name}`, body: "Your group picked this week's action. It takes a minute.",
        link: `/coalitions/${data.slug}#group-action`,
      }))).then(() => {}, () => {});
    }
  }
  revalidatePath(`/coalitions/${data.slug}`);
  return { ok: true };
}
