"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkHandleShape } from "@/lib/placeholder-handle";

const RESERVED = new Set(["admin", "root", "owner", "ikratom", "support", "staff", "moderator", "mod", "system", "official", "anonymous", "anon"]);

/**
 * Change the caller's @handle, and nothing else (the profile form needs every
 * field filled in). Used by the "pick your handle" card that members on the
 * automatic member_… handle see. Writes through the member's own session, so
 * profiles RLS and the reserved-handle trigger (0308) both apply.
 */
export async function chooseHandle(raw: string): Promise<{ ok: true; handle: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to change your handle." };

  const shape = checkHandleShape(typeof raw === "string" ? raw.slice(0, 64) : "");
  if (!shape.ok) return { error: shape.error };
  const handle = shape.handle;
  if (RESERVED.has(handle)) return { error: "That handle is reserved." };

  if (!(await checkRateLimit(`handle-change:${user.id}`, 5, 3600))) {
    return { error: "You've tried a lot of handles this hour. Try again later." };
  }
  const { data: reserved } = await supabase.rpc("is_reserved_username", { p: handle });
  if (reserved === true) return { error: "That handle is reserved." };

  const { data: rows, error } = await supabase
    .from("profiles")
    .update({ username: handle, username_chosen: true, updated_at: new Date().toISOString() })
    .eq("id", user.id)
    .select("id");
  if (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Someone already has that handle. Try another." };
    if (/reserved/i.test(error.message)) return { error: "That handle is reserved." };
    return { error: "Couldn't save your handle. Please try again." };
  }
  if (!rows?.length) return { error: "Couldn't save your handle. Please sign in again." };
  return { ok: true, handle };
}
