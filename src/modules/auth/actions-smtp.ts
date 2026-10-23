"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { encryptToken } from "@/lib/token-crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import { SMTP_PROVIDERS, isSmtpProvider, verifySmtpLogin, type SmtpProvider } from "@/lib/email/smtp";

/**
 * Connect Yahoo / AOL / iCloud for one-click sending with an app password
 * (owner yes 2026-10-22). The password is checked with the provider first
 * (SMTP login only, nothing is sent), then stored AES-256-GCM encrypted and
 * never returned to the browser. One connection per member (the table's key
 * is user_id), so connecting here replaces a Gmail/Outlook connection.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function connectSmtpEmail(input: { provider: string; email: string; appPassword: string }): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!isSmtpProvider(input.provider)) return { ok: false, error: "Pick Yahoo, AOL or iCloud." };
  const provider = input.provider as SmtpProvider;
  const cfg = SMTP_PROVIDERS[provider];

  const email = String(input.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: "That doesn't look like an email address." };
  if (!cfg.domains.includes(email.split("@")[1])) {
    return { ok: false, error: `That isn't a ${cfg.label} address (${cfg.domains.map((d) => `@${d}`).join(", ")}).` };
  }
  // App passwords are shown with spaces or dashes; providers accept them without spaces.
  const appPassword = String(input.appPassword ?? "").replace(/\s+/g, "");
  if (appPassword.length < 8 || appPassword.length > 64) return { ok: false, error: "Paste the app password exactly as your provider shows it." };

  // Slows down anyone trying passwords against a provider through us.
  if (!(await checkRateLimit(`smtp:connect:${user.id}`, 5, 3600))) {
    return { ok: false, error: "Too many tries this hour. Make a fresh app password and try again later." };
  }

  const check = await verifySmtpLogin(provider, email, appPassword);
  if (!check.ok) return { ok: false, error: check.error };

  const admin = createServiceRoleClient();
  const { error } = await admin.from("email_integrations").upsert({
    user_id: user.id,
    provider,
    account_email: email,
    refresh_token: encryptToken(appPassword),
    scopes: "smtp-app-password",
    connected_at: new Date().toISOString(),
    last_used_at: null,
    last_error: null,
  }, { onConflict: "user_id" });
  if (error) return { ok: false, error: "Couldn't save the connection. Try again." };

  revalidatePath("/account");
  return { ok: true };
}

export async function disconnectSmtpEmail(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const admin = createServiceRoleClient();
  // Delete the row outright: nothing of the app password is kept.
  await admin.from("email_integrations").delete().eq("user_id", user.id).in("provider", Object.keys(SMTP_PROVIDERS));
  revalidatePath("/account");
  return { ok: true };
}
