"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Vendor account flow — Option A from docs/VENDOR_ACCOUNTS.md.
 *
 * One profile, one human. A profile can have a "verified vendor" status
 * that lets them send campaign emails *as* a business in addition to
 * *as* themselves. Verification is admin-approved; nothing changes for
 * regular users until they apply + are approved.
 *
 * Re-application policy:
 *   - status='pending'  → cannot apply again
 *   - status='approved' → cannot apply again (would clear approval)
 *   - status='rejected' AND <30 days since application → blocked
 *   - status='rejected' AND ≥30 days OR status='none' → ok
 */

const APPLY_COOLDOWN_DAYS = 30;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const STATE_RE = /^[A-Z]{2}$/;

export type VendorApplication = {
  shopName: string;
  role: string;
  city: string;
  state: string;
  website?: string;
};

export async function applyForVendorStatus(input: VendorApplication) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to apply." };

  // Rate limit: anti-abuse on the apply path
  if (!(await checkRateLimit(`vendor_apply:${user.id}`, 3, 86400))) {
    return { error: "Too many application attempts today." };
  }

  // Validate inputs
  const shopName = input.shopName?.trim();
  const role = input.role?.trim();
  const city = input.city?.trim();
  const state = input.state?.trim().toUpperCase();
  const website = input.website?.trim();

  if (!shopName || shopName.length > 120) return { error: "Business name is required (≤ 120 chars)." };
  if (!role || role.length > 80) return { error: "Your role is required (≤ 80 chars)." };
  if (!city || city.length > 80) return { error: "City is required." };
  if (!state || !STATE_RE.test(state)) return { error: "State must be a 2-letter code (e.g. OK)." };
  if (website && !URL_RE.test(website)) return { error: "Website must start with http:// or https://" };

  // Cooldown check
  const { data: profile } = await supabase
    .from("profiles")
    .select("vendor_status, vendor_application_at")
    .eq("id", user.id)
    .single();

  const status = profile?.vendor_status ?? "none";
  if (status === "pending") return { error: "Your application is already under review." };
  if (status === "approved") return { error: "You're already a verified vendor." };
  if (status === "rejected" && profile?.vendor_application_at) {
    const last = new Date(profile.vendor_application_at).getTime();
    const cooldownEnds = last + APPLY_COOLDOWN_DAYS * 86400_000;
    if (Date.now() < cooldownEnds) {
      const days = Math.ceil((cooldownEnds - Date.now()) / 86400_000);
      return { error: `You can re-apply in ${days} day${days === 1 ? "" : "s"}.` };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      vendor_status: "pending",
      vendor_business_name: shopName,
      vendor_business_role: role,
      vendor_business_city: city,
      vendor_business_state: state,
      vendor_business_website: website || null,
      vendor_application_at: new Date().toISOString(),
      vendor_approved_at: null,
      vendor_approved_by: null,
      vendor_rejection_reason: null,
    })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/account/vendor");
  return { ok: true };
}

export async function getMyVendorState() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "vendor_status, vendor_business_name, vendor_business_role, vendor_business_city, vendor_business_state, vendor_business_website, vendor_application_at, vendor_approved_at, vendor_rejection_reason",
    )
    .eq("id", user.id)
    .single();
  if (error) return { error: error.message };
  return { ok: true, vendor: data };
}

// ─── Admin-side approval queue ────────────────────────────────────

export async function listPendingVendorApplications() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, vendor_status, vendor_business_name, vendor_business_role, vendor_business_city, vendor_business_state, vendor_business_website, vendor_application_at, vendor_rejection_reason",
    )
    .eq("vendor_status", "pending")
    .order("vendor_application_at", { ascending: true });
  if (error) return { error: error.message };
  return { ok: true, rows: data ?? [] };
}

export async function approveVendor(userId: string) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { error: "Invalid user id." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      vendor_status: "approved",
      vendor_approved_at: new Date().toISOString(),
      vendor_approved_by: ctx.userId,
      vendor_rejection_reason: null,
    })
    .eq("id", userId)
    .eq("vendor_status", "pending"); // can't approve already-approved or rejected without a re-apply
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "vendor.approve",
    targetType: "user",
    targetId: userId,
  });
  revalidatePath("/admin/vendor-applications");
  return { ok: true };
}

export async function rejectVendor(input: { userId: string; reason: string }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[0-9a-f-]{36}$/i.test(input.userId)) return { error: "Invalid user id." };
  const reason = input.reason?.trim();
  if (!reason || reason.length > 500) {
    return { error: "Rejection reason is required (≤ 500 chars)." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      vendor_status: "rejected",
      vendor_rejection_reason: reason,
      vendor_approved_at: null,
      vendor_approved_by: null,
    })
    .eq("id", input.userId)
    .eq("vendor_status", "pending");
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "vendor.reject",
    targetType: "user",
    targetId: input.userId,
    details: { reason },
  });
  revalidatePath("/admin/vendor-applications");
  return { ok: true };
}

/**
 * Hard revoke — sets status back to 'none', wipes business fields. Use
 * when a previously-approved vendor sells the shop / closes / requests
 * removal. Different from rejection (which is a one-time "no").
 */
export async function revokeVendor(userId: string) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { error: "Invalid user id." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      vendor_status: "none",
      vendor_business_name: null,
      vendor_business_role: null,
      vendor_business_city: null,
      vendor_business_state: null,
      vendor_business_website: null,
      vendor_application_at: null,
      vendor_approved_at: null,
      vendor_approved_by: null,
      vendor_rejection_reason: null,
    })
    .eq("id", userId);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "vendor.revoke",
    targetType: "user",
    targetId: userId,
  });
  revalidatePath("/admin/vendor-applications");
  return { ok: true };
}
