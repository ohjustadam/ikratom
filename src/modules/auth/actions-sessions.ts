"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { recordAdminAction } from "@/lib/audit";

/**
 * Session management — list active sessions and revoke them.
 *
 * Reads `auth.sessions` via service-role client (it's not exposed to
 * normal API roles). Writes go through `supabase.auth.signOut({ scope })`
 * which uses the user's own session and respects Supabase's session
 * lifecycle.
 *
 * "Current session" detection: we match the JTI (session id) from the
 * user's access token against the row's id. Supabase rotates JTI on
 * refresh so the token's parent session id is what we compare.
 */

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export type SessionInfo = {
  id: string;
  createdAt: string;
  updatedAt: string;
  ip: string | null;
  userAgent: string | null;
  /** The session this server action was invoked with. */
  isCurrent: boolean;
  /** AAL of the session — 'aal1' or 'aal2'. */
  aal: string | null;
};

/**
 * Decode a JWT to read its `session_id` claim without verifying the
 * signature. Safe because we only use it to find the row in auth.sessions
 * for display purposes — the session is already authenticated server-side
 * via supabase.auth.getUser().
 */
function decodeSessionId(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return decoded.session_id ?? null;
  } catch {
    return null;
  }
}

export async function listMySessions(): Promise<SessionInfo[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: { session } } = await supabase.auth.getSession();
  const currentSessionId = session?.access_token ? decodeSessionId(session.access_token) : null;

  const admin = service();
  // auth schema isn't exposed to PostgREST by default but service role can
  // read it directly via the admin client's REST proxy. We use a raw SQL
  // call via rpc would also work; sticking with the typed client for now.
  const { data, error } = await admin
    .schema("auth")
    .from("sessions")
    .select("id, created_at, updated_at, ip, user_agent, aal")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[sessions] list failed:", error.message);
    return [];
  }

  return (data ?? []).map((s: { id: string; created_at: string; updated_at: string; ip: string | null; user_agent: string | null; aal: string | null }) => ({
    id: s.id,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    ip: s.ip,
    userAgent: s.user_agent,
    aal: s.aal,
    isCurrent: s.id === currentSessionId,
  }));
}

/**
 * Sign out every device EXCEPT the current one. Useful when a user
 * suspects their account is compromised but doesn't want to be logged
 * out of the device they're using right now.
 */
export async function signOutOtherDevices(): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { error: error.message };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  if (profile?.is_admin || profile?.is_owner || profile?.is_advocate_leader) {
    await recordAdminAction({
      action: "signed_out_other_devices",
      targetType: "user",
      targetId: user.id,
    });
  }

  return { ok: true };
}

/**
 * Sign out everywhere — including the current session. The user will be
 * bounced to /login on the next request.
 */
export async function signOutEverywhere(): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error) return { error: error.message };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  if (profile?.is_admin || profile?.is_owner || profile?.is_advocate_leader) {
    await recordAdminAction({
      action: "signed_out_everywhere",
      targetType: "user",
      targetId: user.id,
    });
  }

  return { ok: true };
}
