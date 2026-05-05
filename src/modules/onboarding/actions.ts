"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDistrictsForAddress } from "@/lib/civic";

const cap = (s: string, n: number) => s.slice(0, n).trim() || null;

/**
 * Save address step — runs Census lookup to get districts + city/county.
 * Same logic as updateProfile in auth/actions but tighter (only address fields).
 */
export async function saveAddressStep(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const fullName = cap(String(formData.get("full_name") ?? ""), 120);
  const street = cap(String(formData.get("street") ?? ""), 200);
  const city = cap(String(formData.get("city") ?? ""), 80);
  const stateRaw = String(formData.get("state") ?? "").trim().toUpperCase().slice(0, 2);
  const zip = cap(String(formData.get("zip") ?? ""), 10);

  const state = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null;
  if (stateRaw && !state) return { error: "State must be a 2-letter code." };
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) return { error: "ZIP must be 5 or 9 digits." };

  let districts = {
    congressional_district: null as string | null,
    state_senate_district: null as string | null,
    state_house_district: null as string | null,
    city: null as string | null,
    county: null as string | null,
  };
  if (street && city && state) {
    districts = await getDistrictsForAddress({ street, city, state, zip });
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      street,
      city: districts.city ?? city,
      county: districts.county,
      state,
      zip,
      congressional_district: districts.congressional_district,
      state_senate_district: districts.state_senate_district,
      state_house_district: districts.state_house_district,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return { error: error.message };
  return { ok: true };
}

/** Save role tags step. */
export async function saveRolesStep(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const isShopOwner = formData.get("is_shop_owner") === "on";
  const shopName = cap(String(formData.get("shop_name") ?? ""), 120);
  const isMedical = formData.get("is_medical_professional") === "on";

  const { error } = await supabase
    .from("profiles")
    .update({
      is_shop_owner: isShopOwner,
      shop_name: isShopOwner ? shopName : null,
      is_medical_professional: isMedical,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return { error: error.message };
  return { ok: true };
}

/** Save notification preferences. */
export async function saveNotificationsStep(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const update = {
    user_id: user.id,
    notify_state_campaigns: formData.get("notify_state_campaigns") === "on",
    notify_local_campaigns: formData.get("notify_local_campaigns") === "on",
    notify_federal_campaigns: formData.get("notify_federal_campaigns") === "on",
    in_app: true,
    digest: "instant",
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("notification_preferences")
    .upsert(update, { onConflict: "user_id" });
  if (error) return { error: error.message };
  return { ok: true };
}

/** Mark onboarding complete + redirect to dashboard. */
export async function completeOnboarding() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", user.id);

  redirect("/dashboard");
}

/** Skip onboarding — mark complete without saving anything new. */
export async function skipOnboarding() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", user.id);

  redirect("/dashboard");
}
