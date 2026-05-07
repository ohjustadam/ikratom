"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";

/**
 * Partner shop CRUD — admin-only.
 *
 * The slug is the URL fragment that shows up in QR codes printed on the
 * partner's counter materials. Once set, it should NOT change — printed
 * QR codes in the wild encode the old slug forever. We expose an
 * updatePartner() that lets admins edit metadata (name, contact, etc.)
 * but deliberately omit slug from its allowed fields.
 *
 * Slugify rules (auto-generated from shop_name on create):
 *   - lowercase
 *   - non-alphanumeric → "-"
 *   - collapse repeated "-"
 *   - trim leading/trailing "-"
 *   - if collision, append "-2", "-3", ...
 */

const SLUG_RE = /^[a-z0-9-]{1,80}$/;

export type Partner = {
  id: string;
  slug: string;
  shop_name: string;
  city: string | null;
  state: string | null;
  tagline: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
};

function slugifyBase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function uniqueSlug(supabase: Awaited<ReturnType<typeof createClient>>, base: string): Promise<string> {
  const cleanBase = base || "partner";
  let candidate = cleanBase;
  let n = 2;
  // Cap at 50 attempts so a freaky data corruption doesn't loop forever.
  while (n < 50) {
    const { data } = await supabase.from("partners").select("id").eq("slug", candidate).limit(1);
    if (!data || data.length === 0) return candidate;
    candidate = `${cleanBase}-${n}`.slice(0, 80);
    n++;
  }
  return `${cleanBase}-${Date.now()}`.slice(0, 80);
}

export async function createPartner(input: {
  shopName: string;
  city?: string;
  state?: string;
  tagline?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const shop_name = (input.shopName ?? "").trim();
  if (shop_name.length < 1 || shop_name.length > 120) {
    return { error: "Shop name must be 1–120 characters." };
  }

  const state = input.state?.trim().toUpperCase() || null;
  if (state && !/^[A-Z]{2}$/.test(state)) return { error: "State must be a 2-letter code." };

  const supabase = await createClient();
  const slug = await uniqueSlug(supabase, slugifyBase(shop_name));

  const { error, data } = await supabase
    .from("partners")
    .insert({
      slug,
      shop_name,
      city: input.city?.trim() || null,
      state,
      tagline: input.tagline?.trim() || null,
      contact_name: input.contactName?.trim() || null,
      contact_email: input.contactEmail?.trim() || null,
      contact_phone: input.contactPhone?.trim() || null,
      notes: input.notes?.trim() || null,
      created_by: ctx.userId,
    })
    .select("*")
    .single();
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "partner.create",
    targetId: data.id,
    details: { slug, shop_name },
  });
  revalidatePath("/admin/partners");
  return { ok: true, partner: data as Partner };
}

export async function listPartners() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("partners")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };
  return { ok: true, rows: (data ?? []) as Partner[] };
}

export async function getPartnerBySlug(slug: string) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!SLUG_RE.test(slug)) return { error: "Invalid slug." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("partners").select("*").eq("slug", slug).single();
  if (error) return { error: error.message };
  return { ok: true, partner: data as Partner };
}

export async function updatePartner(input: {
  id: string;
  shopName?: string;
  city?: string;
  state?: string;
  tagline?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { error: "Invalid id." };

  // Slug deliberately omitted — QR codes already in the wild encode it.
  const update: Record<string, unknown> = {};
  if (input.shopName !== undefined) {
    const v = input.shopName.trim();
    if (v.length < 1 || v.length > 120) return { error: "Shop name must be 1–120 chars." };
    update.shop_name = v;
  }
  if (input.city !== undefined) update.city = input.city.trim() || null;
  if (input.state !== undefined) {
    const v = input.state.trim().toUpperCase();
    if (v && !/^[A-Z]{2}$/.test(v)) return { error: "State must be 2-letter code." };
    update.state = v || null;
  }
  if (input.tagline !== undefined) update.tagline = input.tagline.trim() || null;
  if (input.contactName !== undefined) update.contact_name = input.contactName.trim() || null;
  if (input.contactEmail !== undefined) update.contact_email = input.contactEmail.trim() || null;
  if (input.contactPhone !== undefined) update.contact_phone = input.contactPhone.trim() || null;
  if (input.notes !== undefined) update.notes = input.notes.trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("partners").update(update).eq("id", input.id);
  if (error) return { error: error.message };
  await recordAdminAction({ action: "partner.update", targetId: input.id });
  revalidatePath("/admin/partners");
  return { ok: true };
}

export async function deletePartner(id: string) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid id." };
  const supabase = await createClient();
  const { error } = await supabase.from("partners").delete().eq("id", id);
  if (error) return { error: error.message };
  await recordAdminAction({ action: "partner.delete", targetId: id });
  revalidatePath("/admin/partners");
  return { ok: true };
}
