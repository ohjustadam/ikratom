"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getDistrictsForAddress } from "@/lib/civic";
import type { AuthResult } from "./types";

/** Accepts only same-origin relative paths. Prevents open-redirect. */
function safeRelative(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/[\s\r\n\0]/.test(raw)) return null;
  return raw;
}

/** Sign up a new user with email + password. */
export async function signUp(formData: FormData): Promise<AuthResult> {
  const email = (formData.get("email") as string)?.trim().slice(0, 254);
  const password = formData.get("password") as string;

  if (!email || !password) return { error: "Email and password are required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Email is invalid." };
  if (password.length < 10) return { error: "Password must be at least 10 characters." };
  if (password.length > 200) return { error: "Password is too long." };

  // Rate limit: 5 signups per IP per hour
  const ip = await getClientIp();
  if (!(await checkRateLimit(`signup:ip:${ip}`, 5, 3600))) {
    return { error: "Too many signup attempts from this network. Try again later." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };

  return { success: true };
}

/** Sign in. Redirects on success. */
export async function signIn(formData: FormData): Promise<AuthResult> {
  const email = (formData.get("email") as string)?.trim().slice(0, 254);
  const password = formData.get("password") as string;
  const redirectTo = formData.get("redirect") as string;

  if (!email || !password) return { error: "Email and password are required." };

  // Rate limits: 20 attempts per IP per 5 min, AND 10 per email per 5 min
  const ip = await getClientIp();
  if (!(await checkRateLimit(`signin:ip:${ip}`, 20, 300))) {
    return { error: "Too many sign-in attempts from this network. Try again in a few minutes." };
  }
  if (!(await checkRateLimit(`signin:email:${email.toLowerCase()}`, 10, 300))) {
    return { error: "Too many sign-in attempts for this email. Try again in a few minutes." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  redirect(safeRelative(redirectTo) || "/dashboard");
}

/** Sign out and return to home. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

/** Get the current user + their profile row. */
export async function getProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { profile: null, email: null };

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return { profile: data, email: user.email ?? null };
}

/** Update profile civic info (used to autofill legislator emails). */
export async function updateProfile(formData: FormData): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Trim + cap each string field. Caps prevent DB bloat / abuse.
  const cap = (s: string, n: number) => s.slice(0, n).trim() || null;

  const fullName = cap((formData.get("full_name") as string) || "", 120);
  const phone = cap((formData.get("phone") as string) || "", 30);
  const street = cap((formData.get("street") as string) || "", 200);
  const city = cap((formData.get("city") as string) || "", 80);
  const stateRaw = ((formData.get("state") as string) || "").trim().toUpperCase().slice(0, 2);
  const zip = cap((formData.get("zip") as string) || "", 10);
  const isShopOwner = formData.get("is_shop_owner") === "on";
  const shopName = cap((formData.get("shop_name") as string) || "", 120);
  const isMedical = formData.get("is_medical_professional") === "on";

  const state = stateRaw && /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null;
  if (stateRaw && !state) return { error: "State must be a 2-letter code (e.g. OK)." };
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) return { error: "ZIP must be 5 or 9 digits." };
  if (phone && !/^[\d\s\-+().]{7,30}$/.test(phone)) return { error: "Phone has invalid characters." };

  // Look up districts + city + county via Census Geocoder. Failure is non-fatal.
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

  // Prefer Census-canonical city/county for consistent locality matching.
  // Falls back to user input if Census didn't resolve.
  const canonicalCity = districts.city ?? city;
  const canonicalCounty = districts.county ?? null;

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      phone,
      street,
      city: canonicalCity,
      county: canonicalCounty,
      state,
      zip,
      congressional_district: districts.congressional_district,
      state_senate_district: districts.state_senate_district,
      state_house_district: districts.state_house_district,
      is_shop_owner: isShopOwner,
      shop_name: isShopOwner ? shopName : null,
      is_medical_professional: isMedical,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return { error: error.message };
  return { success: true };
}
