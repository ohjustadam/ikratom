"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertNotReadOnly } from "@/lib/read-only-mode";
import { checkRateLimit } from "@/lib/rate-limit";
import { isChamber, isDistrict } from "./districts";

/**
 * District captains (migration 0295). Organizers name one member per
 * district. Writes go through the USER's client, so RLS proves the organizer
 * role and the foreign key proves the captain is a member.
 */

type Result = { ok: true } | { ok: false; error: string };
const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function assignDistrictCaptain(
  coalitionId: string, slug: string, chamber: string, district: string, userId: string,
): Promise<Result> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  if (!UUID_RE.test(coalitionId) || !UUID_RE.test(userId)) return { ok: false, error: "Pick a member." };
  if (!isChamber(chamber) || !isDistrict(district)) return { ok: false, error: "Pick a district." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!(await checkRateLimit(`coalition:captain:${user.id}`, 60, 3600))) {
    return { ok: false, error: "Too many changes this hour. Try again later." };
  }
  const { error } = await supabase.from("coalition_district_captains").upsert(
    { coalition_id: coalitionId, chamber, district: district.trim(), user_id: userId, assigned_by: user.id, assigned_at: new Date().toISOString() },
    { onConflict: "coalition_id,chamber,district" },
  );
  if (error) return { ok: false, error: "Only the group's organizers can name captains, and the captain must be a member." };
  revalidatePath(`/coalitions/${slug}`);
  return { ok: true };
}

export async function removeDistrictCaptain(coalitionId: string, slug: string, chamber: string, district: string): Promise<Result> {
  if (!UUID_RE.test(coalitionId) || !isChamber(chamber) || !isDistrict(district)) return { ok: false, error: "Not found." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  // RLS makes a delete you may not make a silent no-op, so count the rows.
  const { data, error } = await supabase.from("coalition_district_captains").delete()
    .eq("coalition_id", coalitionId).eq("chamber", chamber).eq("district", district).select("district");
  if (error || !data?.length) return { ok: false, error: "Only the group's organizers can do that." };
  revalidatePath(`/coalitions/${slug}`);
  return { ok: true };
}
