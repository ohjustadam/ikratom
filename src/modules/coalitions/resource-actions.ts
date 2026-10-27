"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertNotReadOnly } from "@/lib/read-only-mode";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateResource, type ResourceInput } from "./resources";

/**
 * Pinned resources + testimony templates (migration 0293, B4 h). Organizers
 * pin links and letter templates; members open a template in the shared
 * composer. Writes go through the USER's client, so RLS is what proves the
 * organizer role; the checks here only return a readable error.
 */

type Result = { ok: true; id?: string } | { ok: false; error: string };
const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function pinGroupResource(coalitionId: string, slug: string, input: ResourceInput): Promise<Result> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  if (!UUID_RE.test(coalitionId)) return { ok: false, error: "Group not found." };
  const v = validateResource(input);
  if (!v.ok) return v;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!(await checkRateLimit(`coalition:resource:${user.id}`, 20, 3600))) {
    return { ok: false, error: "You've pinned a lot this hour. Try again a little later." };
  }
  const { data, error } = await supabase.from("coalition_resources")
    .insert({ coalition_id: coalitionId, created_by: user.id, ...v.row })
    .select("id").single();
  if (error || !data) {
    return { ok: false, error: /30 resources/.test(error?.message ?? "") ? "A group can pin up to 30. Remove one first." : "Only the group's organizers can pin resources." };
  }
  revalidatePath(`/coalitions/${slug}`);
  return { ok: true, id: data.id as string };
}

export async function removeGroupResource(id: string, slug: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Not found." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  // RLS makes a delete you may not make a silent no-op, so count the rows.
  const { data, error } = await supabase.from("coalition_resources").delete().eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, error: "Only the group's organizers can remove that." };
  revalidatePath(`/coalitions/${slug}`);
  return { ok: true };
}
