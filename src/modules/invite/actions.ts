"use server";

import { createClient } from "@/lib/supabase/server";

export type InviteSummary = {
  invite_code: string;
  total_signups: number;
  total_with_first_action: number;
};

export type InviteeRow = {
  invitee_id: string;
  username: string | null;
  state: string | null;
  signed_up_at: string | null;
  first_action_at: string | null;
};

/**
 * Returns the signed-in user's invite code + funnel counts. Backed by
 * the get_my_invite_summary() RPC (security definer) so RLS doesn't
 * matter; the RPC pins inviter_id = auth.uid() internally.
 */
export async function getMyInviteSummary(): Promise<InviteSummary | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc("get_my_invite_summary");
  if (error || !data) {
    if (error) console.error("[invite] summary RPC failed:", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    invite_code: row.invite_code,
    total_signups: row.total_signups ?? 0,
    total_with_first_action: row.total_with_first_action ?? 0,
  };
}

/**
 * Returns the signed-in user's recent invitees. Joins to profiles for
 * the public-safe username + state fields. RLS on invite_redemptions
 * is "inviter_id = auth.uid()" so we can query directly.
 */
export async function listMyInvitees(limit = 25): Promise<InviteeRow[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("invite_redemptions")
    .select("invitee_id, signed_up_at, first_action_at")
    .eq("inviter_id", user.id)
    .order("signed_up_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error || !data) return [];

  // Fetch invitee public profile fields via the public-safe RPC so we
  // don't reach across into private profile columns.
  const ids = data.map((r) => r.invitee_id);
  if (ids.length === 0) return [];
  const { data: profiles } = await supabase.rpc("get_public_profiles", {
    p_ids: ids,
  });
  const byId = new Map<string, { username: string | null; state: string | null }>();
  for (const p of (profiles ?? []) as Array<{ id: string; username: string | null; state: string | null }>) {
    byId.set(p.id, { username: p.username, state: p.state });
  }

  return data.map((r) => ({
    invitee_id: r.invitee_id,
    username: byId.get(r.invitee_id)?.username ?? null,
    state: byId.get(r.invitee_id)?.state ?? null,
    signed_up_at: r.signed_up_at,
    first_action_at: r.first_action_at,
  }));
}

/**
 * Build the canonical share URL for a code.
 */
export async function buildInviteUrl(code: string): Promise<string> {
  const base = (process.env.APP_URL ?? "https://www.ikratom.org").replace(/\/+$/, "");
  return `${base}/i/${code}`;
}
