"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Friend connections (RPCs in migration 0287). The database decides every
 * outcome: request_connection says 'unavailable' for a member who blocked you,
 * hides their profile from you, or doesn't exist, so a forged call learns
 * nothing. 30 requests a day per member; responding and removing are free.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = { ok: true; state: string } | { error: string };

async function signedIn() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

function refresh(otherId: string) {
  revalidatePath(`/profile/${otherId}`);
  revalidatePath("/account/connections");
}

export async function requestConnection(targetId: string): Promise<Result> {
  if (!UUID_RE.test(targetId)) return { error: "Unknown member." };
  const { supabase, user } = await signedIn();
  if (!user) return { error: "Sign in to connect." };
  if (!(await checkRateLimit(`connection-request:${user.id}`, 30, 86_400))) {
    return { error: "You've sent a lot of requests today. Try again tomorrow." };
  }
  const { data, error } = await supabase.rpc("request_connection", { p_target: targetId });
  if (error) return { error: "Could not send that request." };
  if (data === "unavailable") return { error: "You can't connect with this member." };
  refresh(targetId);
  return { ok: true, state: String(data) };
}

export async function respondConnection(requesterId: string, accept: boolean): Promise<Result> {
  if (!UUID_RE.test(requesterId)) return { error: "Unknown member." };
  const { supabase, user } = await signedIn();
  if (!user) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("respond_connection", { p_requester: requesterId, p_accept: accept });
  if (error) return { error: "Could not answer that request." };
  refresh(requesterId);
  return { ok: true, state: String(data) };
}

/** Unfriend, or cancel a request you sent. */
export async function removeConnection(otherId: string): Promise<Result> {
  if (!UUID_RE.test(otherId)) return { error: "Unknown member." };
  const { supabase, user } = await signedIn();
  if (!user) return { error: "Sign in first." };
  const { error } = await supabase.rpc("remove_connection", { p_other: otherId });
  if (error) return { error: "Could not remove that connection." };
  refresh(otherId);
  return { ok: true, state: "none" };
}
