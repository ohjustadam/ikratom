"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getDistrictsForAddress } from "@/lib/civic";
import { isPasswordPwned } from "@/lib/pwned-passwords";
import { recordSignIn } from "./actions-devices";
import type { AuthResult } from "./types";

/**
 * Look up the most recent active campaign for a state and return its slug.
 * Used by post-signin routing when a `landing_state` cookie is present
 * (set by the proxy when the user arrived via an embed widget or shared
 * state-specific link).
 */
async function findBestCampaignForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stateCode: string,
  userCity: string | null,
  userCounty: string | null,
): Promise<string | null> {
  // FED → no state-specific campaign yet; fall back to /campaigns list
  if (stateCode === "FED") return null;

  // Prefer most-local match: if user has city + the state has an active
  // campaign with target_locality matching that city, route there.
  // Then fall back to county, then state-only.
  const cityKey = userCity ? `${userCity}, ${stateCode}` : null;
  const countyKey = userCounty ? `${userCounty}, ${stateCode}` : null;

  // 1. City-specific
  if (cityKey) {
    const { data } = await supabase
      .from("campaigns")
      .select("slug")
      .eq("active", true)
      .eq("state", stateCode)
      .eq("target_locality", cityKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return (data as { slug: string }).slug;
  }
  // 2. County-specific
  if (countyKey) {
    const { data } = await supabase
      .from("campaigns")
      .select("slug")
      .eq("active", true)
      .eq("state", stateCode)
      .eq("target_locality", countyKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return (data as { slug: string }).slug;
  }
  // 3. State-only (no target_locality)
  const { data } = await supabase
    .from("campaigns")
    .select("slug")
    .eq("active", true)
    .eq("state", stateCode)
    .is("target_locality", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { slug: string } | null)?.slug ?? null;
}

/** Read the landing-state cookie and clear it (one-shot routing). */
async function consumeLandingState(): Promise<string | null> {
  try {
    const c = await cookies();
    const v = c.get("landing_state")?.value;
    if (!v) return null;
    c.delete("landing_state");
    return /^([A-Z]{2}|FED)$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

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
  const honeypot = (formData.get("website_url") as string) ?? "";
  const elapsedMs = Number(formData.get("form_elapsed_ms")) || 0;

  // ── Anti-bot ────────────────────────────────────────────────────────
  // Honeypot: real users never see this field. If it's filled, it's a bot.
  // Return the same shape as success so the bot can't tell it failed.
  if (honeypot.trim().length > 0) {
    console.warn("[signup] honeypot triggered", { ip: await getClientIp() });
    return { success: true };
  }
  // Timing trap: humans take >2s to read+fill+submit. Bots POST instantly.
  // Skip when elapsedMs is 0 (e.g. progressive enhancement / no JS).
  if (elapsedMs > 0 && elapsedMs < 2000) {
    console.warn("[signup] timing trap triggered", { elapsedMs, ip: await getClientIp() });
    return { success: true };
  }

  if (!email || !password) return { error: "Email and password are required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Email is invalid." };
  if (password.length < 10) return { error: "Password must be at least 10 characters." };
  if (password.length > 200) return { error: "Password is too long." };

  // Username — required for new signups. Lowercased on the server so
  // user-typed casing doesn't matter; uniqueness check is case-insensitive.
  const usernameRaw = ((formData.get("username") as string) ?? "").trim().toLowerCase();
  if (!usernameRaw) return { error: "Username is required." };
  if (!/^[a-z0-9_]{3,30}$/.test(usernameRaw)) {
    return {
      error:
        "Username must be 3–30 characters, lowercase letters, digits, and underscore only.",
    };
  }
  // Reserved/abusable usernames — block trivially before the DB rejects.
  const RESERVED = new Set(["admin", "root", "owner", "ikratom", "support", "staff", "moderator", "mod", "system", "official", "anonymous", "anon"]);
  if (RESERVED.has(usernameRaw)) return { error: "That username is reserved." };

  // Rate limit: 5 signups per IP per hour
  const ip = await getClientIp();
  if (!(await checkRateLimit(`signup:ip:${ip}`, 5, 3600))) {
    return { error: "Too many signup attempts from this network. Try again later." };
  }

  // Block passwords that have appeared in known breaches. Plaintext is
  // never sent to HIBP — see src/lib/pwned-passwords.ts. Fails open on
  // network error, so a HIBP outage doesn't lock signups.
  if (await isPasswordPwned(password)) {
    return {
      error:
        "This password has appeared in a known data breach. Please pick a different one — even if you've never used this account before, attackers will try this password first.",
    };
  }

  const supabase = await createClient();

  // Check username uniqueness BEFORE creating the auth user, so we don't
  // end up with an authed account that can't claim its desired handle.
  // Race: two parallel signups for the same username — the unique index
  // is the final guard; whoever lands second gets the friendly error
  // below when the post-signup update fails.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", usernameRaw)
    .maybeSingle();
  if (existing) return { error: "That username is already taken." };

  const { error, data } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };

  // The on_auth_user_created trigger has now inserted a profile row for
  // this user. Stamp the username on it. If the unique index trips
  // (race), surface a clean error.
  if (data.user) {
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ username: usernameRaw })
      .eq("id", data.user.id);
    if (updateErr) {
      // 23505 = unique violation
      if ((updateErr as { code?: string }).code === "23505") {
        return { error: "That username was taken just now. Try another." };
      }
      // Don't roll back the auth user — they can pick a username on
      // first profile save. Surface the error so they know.
      return { error: `Couldn't set username: ${updateErr.message}` };
    }
  }

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
  const { error, data } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Map Supabase's generic error messages to user-friendly explanations.
    // Balance: we want to help legit users (who fat-fingered their password,
    // never confirmed their email, etc.) without enabling email-enumeration
    // attacks where an attacker probes a list of emails to discover which
    // ones exist. The trade-off here: we tell users about the "needs email
    // confirmation" state (which they can verify themselves), but leave
    // "wrong password" vs "no such account" intentionally ambiguous.
    const msg = error.message?.toLowerCase() ?? "";
    let friendly = error.message;
    let hint: string | undefined;

    if (msg.includes("email not confirmed") || msg.includes("not been confirmed")) {
      friendly = "Your email isn't confirmed yet.";
      hint = "Check your inbox (and spam folder) for our confirmation link — or request a new one via the 'Forgot password' link to reset access.";
    } else if (msg.includes("invalid login credentials") || msg.includes("invalid_credentials")) {
      friendly = "Email or password is incorrect.";
      hint = "Double-check your email is typed right and the password matches. If you forgot the password, click 'Forgot password' below to reset it. If you signed up via a leader's invite, use that email exactly.";
    } else if (msg.includes("user not found") || msg.includes("user_not_found")) {
      friendly = "Email or password is incorrect.";
      hint = "We couldn't match that combo. Try 'Forgot password' if you've signed up before, or 'Sign up' if you're new.";
    } else if (msg.includes("rate limit") || msg.includes("too many")) {
      friendly = "Too many attempts. Try again in a few minutes.";
    } else if (msg.includes("captcha")) {
      friendly = "Sign-in is temporarily blocked.";
      hint = "Refresh the page and try again. If it persists, contact support.";
    } else if (msg.includes("banned") || msg.includes("blocked")) {
      friendly = "This account has been suspended.";
      hint = "Contact support if you think this is a mistake.";
    }

    return { error: friendly, hint };
  }

  // Record device + maybe insert new-device notification. Best-effort —
  // never blocks sign-in on failure.
  if (data.user) {
    try { await recordSignIn(data.user.id); } catch (e) {
      console.error("[signIn] recordSignIn failed:", e);
    }
  }

  // First-time signin: if onboarding not done yet, route through /onboarding.
  // Honors explicit redirect param (e.g. ?redirect=/messages) — only swaps dashboard.
  let dest = safeRelative(redirectTo) || "/dashboard";
  if (dest === "/dashboard" && data.user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("onboarded_at")
      .eq("id", data.user.id)
      .single();
    if (!prof?.onboarded_at) dest = "/onboarding";
  }

  // Embed / state-share auto-routing: if the user arrived via an embed
  // widget or a state-specific shared link, the proxy stashed a
  // landing_state cookie. Try to route them into a matched active
  // campaign instead of /dashboard. Onboarding still wins.
  // Prefers city > county > state-level match using the user's profile.
  if (dest === "/dashboard" && data.user) {
    const landingState = await consumeLandingState();
    if (landingState) {
      const { data: locInfo } = await supabase
        .from("profiles")
        .select("city, county")
        .eq("id", data.user.id)
        .single();
      const slug = await findBestCampaignForUser(
        supabase,
        landingState,
        (locInfo as { city: string | null; county: string | null } | null)?.city ?? null,
        (locInfo as { city: string | null; county: string | null } | null)?.county ?? null,
      );
      if (slug) dest = `/campaigns/${slug}`;
    }
  }

  // MFA step-up: if the user has a verified TOTP factor but the current
  // session is only at aal1, force the second factor before they go
  // further — UNLESS this device is in trusted_devices for them. The
  // trusted-device check looks for a signed cookie + matching DB row.
  // Sensitive aal2-required actions still re-prompt (admin mutations,
  // password change, MFA management) — trust only skips the routine
  // sign-in challenge.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal?.currentLevel !== "aal2") {
    const { isCurrentDeviceTrusted } = await import("./actions-trusted-devices");
    const trusted = await isCurrentDeviceTrusted(data.user.id);
    if (!trusted) {
      const params = new URLSearchParams({ redirect: dest });
      redirect(`/login/mfa?${params.toString()}`);
    }
  }

  redirect(dest);
}

/** Sign out and return to home. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

/** Send a password-reset email via Supabase. */
export async function requestPasswordReset(formData: FormData): Promise<AuthResult> {
  const email = (formData.get("email") as string)?.trim().slice(0, 254);
  if (!email) return { error: "Email is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Email is invalid." };

  // Rate limit: 3 reset emails per IP per hour
  const ip = await getClientIp();
  if (!(await checkRateLimit(`pwreset:ip:${ip}`, 3, 3600))) {
    return { error: "Too many reset requests. Try again later." };
  }
  if (!(await checkRateLimit(`pwreset:email:${email.toLowerCase()}`, 3, 3600))) {
    return { error: "Too many reset requests for this email. Try again later." };
  }

  const supabase = await createClient();
  const appUrl = process.env.APP_URL ?? "http://localhost:3001";
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/auth/callback?next=/reset-password`,
  });

  // We always return success to prevent email enumeration. The user will get
  // the email if their account exists; otherwise nothing happens.
  if (error) {
    console.error("[pwreset]", error.message);
  }
  return { success: true };
}

/** Set a new password for the currently-authenticated session. */
export async function setNewPassword(formData: FormData): Promise<AuthResult> {
  const password = formData.get("password") as string;
  const confirm = formData.get("confirm") as string;

  if (!password || password.length < 10) {
    return { error: "Password must be at least 10 characters." };
  }
  if (password.length > 200) return { error: "Password is too long." };
  if (password !== confirm) return { error: "Passwords don't match." };

  if (await isPasswordPwned(password)) {
    return {
      error:
        "This password has appeared in a known data breach. Please pick a different one.",
    };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in. The reset link may have expired." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  return { success: true };
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

  const usernameRaw = ((formData.get("username") as string) ?? "").trim().toLowerCase();
  const fullName = cap((formData.get("full_name") as string) || "", 120);
  const phone = cap((formData.get("phone") as string) || "", 30);
  const street = cap((formData.get("street") as string) || "", 200);
  const city = cap((formData.get("city") as string) || "", 80);
  const stateRaw = ((formData.get("state") as string) || "").trim().toUpperCase().slice(0, 2);
  const zip = cap((formData.get("zip") as string) || "", 10);
  const isShopOwner = formData.get("is_shop_owner") === "on";
  const shopName = cap((formData.get("shop_name") as string) || "", 120);
  const isMedical = formData.get("is_medical_professional") === "on";

  // Username is required (3–30 chars, lowercase letters/digits/_).
  // Existing users without one get this on first profile save.
  if (!usernameRaw) return { error: "Username is required." };
  if (!/^[a-z0-9_]{3,30}$/.test(usernameRaw)) {
    return { error: "Username must be 3–30 chars, lowercase letters, digits, underscore only." };
  }
  const RESERVED = new Set(["admin", "root", "owner", "ikratom", "support", "staff", "moderator", "mod", "system", "official", "anonymous", "anon"]);
  if (RESERVED.has(usernameRaw)) return { error: "That username is reserved." };

  // Uniqueness pre-check (the unique index is the final guard).
  const { data: clash } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", usernameRaw)
    .neq("id", user.id)
    .maybeSingle();
  if (clash) return { error: "That username is already taken." };

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
      username: usernameRaw,
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

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "That username was taken just now. Try another." };
    }
    return { error: error.message };
  }
  return { success: true };
}
