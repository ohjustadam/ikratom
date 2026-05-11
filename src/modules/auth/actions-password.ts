"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAdminAction } from "@/lib/audit";
import { isPasswordPwned } from "@/lib/pwned-passwords";
import { sendTransactionalEmail, brandedHtml } from "@/lib/email/transactional";

export type ChangePasswordResult = { ok: true } | { error: string };

/**
 * Change the signed-in user's password.
 *
 * Security model:
 *   1. Re-verify the *current* password via signInWithPassword. This blocks
 *      session-hijack scenarios — an attacker with stolen cookies still has
 *      to know the password to change it.
 *   2. Rate-limit by user id (5/hr) and IP (20/hr) to slow brute force.
 *   3. If the user has MFA enrolled, Supabase Auth itself rejects the
 *      updateUser call from aal1 sessions, so we get aal2 enforcement for
 *      free. We still surface a clean error message.
 *   4. Audit-log the change for privileged accounts.
 */
export async function changePassword(formData: FormData): Promise<ChangePasswordResult> {
  const current = (formData.get("current") as string) ?? "";
  const next = (formData.get("next") as string) ?? "";
  const confirm = (formData.get("confirm") as string) ?? "";

  if (!current) return { error: "Enter your current password." };
  if (!next || next.length < 10) {
    return { error: "New password must be at least 10 characters." };
  }
  if (next.length > 200) return { error: "New password is too long." };
  if (next !== confirm) return { error: "New passwords don't match." };
  if (current === next) {
    return { error: "New password must be different from your current password." };
  }

  if (await isPasswordPwned(next)) {
    return {
      error:
        "This password has appeared in a known data breach. Please pick a different one.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { error: "Not signed in." };

  // Rate limits — distinct keys for IP and user. Either tripping blocks.
  const ip = await getClientIp();
  if (!(await checkRateLimit(`pwchange:user:${user.id}`, 5, 3600))) {
    return { error: "Too many password-change attempts on this account. Try again in an hour." };
  }
  if (!(await checkRateLimit(`pwchange:ip:${ip}`, 20, 3600))) {
    return { error: "Too many password-change attempts from this network. Try again later." };
  }

  // Verify current password by attempting a fresh sign-in. This refreshes
  // the session as a side effect (fine — same user, same browser).
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (verifyErr) {
    return { error: "Current password is incorrect." };
  }

  // Update to the new password.
  const { error: updateErr } = await supabase.auth.updateUser({ password: next });
  if (updateErr) {
    // Common case: user has MFA but is at aal1 → Supabase blocks the update.
    const msg = updateErr.message || "";
    if (/aal2|assurance/i.test(msg)) {
      return {
        error:
          "Two-factor verification required to change password. Visit /login/mfa to enter your code, then try again.",
      };
    }
    return { error: msg || "Could not update password." };
  }

  // Audit-log if this is a privileged account
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader, password_must_change_at")
    .eq("id", user.id)
    .single();
  if (profile?.is_admin || profile?.is_owner || profile?.is_advocate_leader) {
    await recordAdminAction({
      action: "password_changed",
      targetType: "user",
      targetId: user.id,
    });
  }

  // If this user was on a temp password (admin-issued), clear the
  // force-change gate now that they've set a real password.
  if (profile?.password_must_change_at) {
    await supabase
      .from("profiles")
      .update({ password_must_change_at: null })
      .eq("id", user.id);
  }

  // Notify the email on file. This is the "if it wasn't you, click here"
  // safety net so a session-cookie thief who happens to know the password
  // can't silently lock the user out. Best-effort; no-ops cleanly when
  // RESEND_API_KEY isn't set.
  const ipShort = ip.slice(0, 64);
  const when = new Date().toLocaleString("en-US", { timeZone: "UTC" });
  await sendTransactionalEmail({
    to: user.email,
    subject: "Your iKratom password was just changed",
    text:
      `Hi,\n\n` +
      `The password on your iKratom account was just changed.\n\n` +
      `When: ${when} UTC\n` +
      `IP:   ${ipShort}\n\n` +
      `If this was you, you can ignore this email.\n\n` +
      `If this WASN'T you:\n` +
      `  1. Sign in at https://www.ikratom.org/login (you'll need the new password the attacker set, OR use Supabase's "Forgot password?" link to reset it via your email).\n` +
      `  2. Once back in, go to /account/security → enable two-factor authentication if you haven't.\n` +
      `  3. Reply to this email — we'll help.\n\n` +
      `— iKratom`,
    html: brandedHtml({
      headline: "Your password was just changed",
      body:
        `<p>The password on your iKratom account was just changed.</p>` +
        `<table style="margin-top:16px;font-size:13px;color:#a1a1aa;"><tr><td style="padding-right:16px;">When</td><td style="color:#e4e4e7;">${escapeForTable(when)} UTC</td></tr><tr><td style="padding-right:16px;">IP</td><td style="color:#e4e4e7;font-family:monospace;">${escapeForTable(ipShort)}</td></tr></table>` +
        `<p style="margin-top:16px;">If this was you, you can ignore this email.</p>` +
        `<p>If it <strong>wasn't</strong> you, sign in to lock things back down — or use the password-reset link to take the account back via your email.</p>`,
      ctaLabel: "Sign in",
      ctaHref: "https://www.ikratom.org/login",
    }),
    tag: "password_changed",
  });

  return { ok: true };
}

function escapeForTable(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
