"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isValidLocale, type Locale } from "@/i18n/messages";

const LOCALE_COOKIE = "locale";
const LOCALE_TTL_DAYS = 365;

export async function setLocale(locale: string) {
  if (!isValidLocale(locale)) return { error: "Unsupported locale." };
  const c = await cookies();
  c.set(LOCALE_COOKIE, locale, {
    maxAge: LOCALE_TTL_DAYS * 24 * 60 * 60,
    path: "/",
    sameSite: "lax",
  });
  // Persist on the user's profile if signed in (so it follows them across devices)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from("profiles").update({ locale }).eq("id", user.id);
  }
  return { ok: true };
}

/** Read the current locale: query param > cookie > profile > default. */
export async function readLocale(searchLang?: string | null): Promise<Locale> {
  if (searchLang && isValidLocale(searchLang)) return searchLang;
  const c = await cookies();
  const fromCookie = c.get(LOCALE_COOKIE)?.value;
  if (isValidLocale(fromCookie)) return fromCookie;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data } = await supabase.from("profiles").select("locale").eq("id", user.id).single();
    const fromProfile = (data as { locale: string | null } | null)?.locale;
    if (isValidLocale(fromProfile)) return fromProfile;
  }
  return "en";
}
