"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAdminContext } from "./actions";
import { requireMfaForMutation } from "./mfa";
import { verifyUserForPromotion } from "@/modules/auth/trust-tier";

/**
 * Set a user's role flags. Owner-only — `manage_roles` is owner-reserved.
 *
 * Why role changes stopped being an admin power: `is_admin` was
 * admin-grantable, so the admin tier self-replicated with no owner
 * involvement (an admin could promote an alt account) and one admin could
 * unilaterally demote every other admin. Admin carries master-edit, the AI
 * editor, cron triggers, and support tooling — that boundary belongs to the
 * owner alone.
 *
 * Note this also means admins no longer promote Advocate Leaders. That is
 * deliberate: role assignment is now one owner decision, and the granular
 * matrix (/admin/users/[id]/permissions) is how capability gets delegated
 * without handing over a role.
 */
export async function setUserRoles(input: {
  userId: string;
  isAdmin: boolean;
  isLeader: boolean;
  isOwner?: boolean; // owner-only — ignored for non-owner callers
}) {
  const ctx = await getAdminContext({ require: "manage_roles" });
  if (!ctx.ok) {
    return { error: "Owner only — role changes are not delegable. Use the permissions matrix to grant a specific capability instead." };
  }
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };
  if (!input.userId) return { error: "Missing user id." };
  if (input.userId === ctx.userId && !input.isAdmin && !input.isOwner) {
    return { error: "You cannot demote yourself. Ask another owner/admin." };
  }

  const updates: Record<string, boolean> = {
    is_admin: !!input.isAdmin,
    is_advocate_leader: !!input.isLeader,
  };
  if (ctx.isOwner && typeof input.isOwner === "boolean") {
    updates.is_owner = input.isOwner;
  }

  const supabase = await createClient();

  // Read CURRENT role state so we can detect transitions (false → true)
  // and fire the appropriate notification + tutorial flag exactly once
  // per promotion. Without this we'd re-notify on every role-toggle save.
  const { data: prev } = await supabase
    .from("profiles")
    .select("is_advocate_leader, is_admin, is_owner")
    .eq("id", input.userId)
    .single();

  // Belt-and-braces on the trust boundary. `manage_roles` is owner-reserved so
  // ctx.isOwner is necessarily true here — but this is the single mutation that
  // can mint another admin, and it costs one comparison to make that
  // independent of the catalog staying correct.
  if (!ctx.isOwner && !!input.isAdmin !== !!prev?.is_admin) {
    return { error: "Only the owner can grant or revoke the Admin role." };
  }

  // Set leader_tour_pending = true ONLY when leader transitions to true.
  // The tutorial component on /dashboard reads + clears this flag.
  const newlyLeader = !!input.isLeader && !prev?.is_advocate_leader;
  const newlyAdmin = !!input.isAdmin && !prev?.is_admin;
  const newlyOwner = ctx.isOwner && input.isOwner === true && !prev?.is_owner;

  // Anti-infiltration gate (PR4): don't hand the campaign-authoring +
  // wave-amplification keys to a thin/unvetted account. Promotion to
  // Advocate Leader requires the target to be a "verified" user first
  // (confirmed email + complete profile + 2FA enrolled + account >= 48h).
  // Admin/owner grants are owner-driven trust and aren't gated here.
  if (newlyLeader) {
    const v = await verifyUserForPromotion(input.userId);
    if (!v.ok) {
      return { error: `Can't promote to leader yet — this user must first complete: ${v.missing.join(", ")}.` };
    }
  }

  const fullUpdate: Record<string, unknown> = { ...updates };
  if (newlyLeader) fullUpdate.leader_tour_pending = true;

  const { error } = await supabase.from("profiles").update(fullUpdate).eq("id", input.userId);
  if (error) return { error: error.message };

  // Fire role-promotion notifications via service-role client (we're
  // writing to another user's notifications row). Best-effort — never
  // blocks the role change. Realtime publication on `notifications`
  // means the user's bell icon updates within seconds.
  if (newlyLeader || newlyAdmin || newlyOwner) {
    try {
      const sr = createServiceRoleClient();
      const rows: Array<{ user_id: string; kind: string; title: string; body: string; link: string }> = [];
      if (newlyLeader) {
        rows.push({
          user_id: input.userId,
          kind: "role_granted_leader",
          title: "🎖 You're now an Advocate Leader",
          body:
            "You can author campaigns, moderate the forum, and access the leader workshop. " +
            "Your dashboard will walk you through what's new on your next visit.",
          link: "/dashboard",
        });
      }
      if (newlyAdmin) {
        rows.push({
          user_id: input.userId,
          kind: "role_granted_admin",
          title: "🛠 You're now an Admin",
          body: "Full moderation + sync + user-management access. Visit /admin to see the control room.",
          link: "/admin",
        });
      }
      if (newlyOwner) {
        rows.push({
          user_id: input.userId,
          kind: "role_granted_owner",
          title: "👑 You're now an Owner",
          body: "Highest-privilege role — only one owner at a time. Hand-off complete.",
          link: "/admin",
        });
      }
      if (rows.length > 0) await sr.from("notifications").insert(rows);
    } catch {
      // non-fatal
    }
  }

  await recordAdminAction({
    action: "role_change",
    targetType: "user",
    targetId: input.userId,
    details: { ...fullUpdate, newly_leader: newlyLeader, newly_admin: newlyAdmin, newly_owner: newlyOwner },
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

// ============================================================
// Customer-support actions (admin + owner)
// ============================================================

/**
 * Admin-triggered password reset. Sends a reset link to the user's
 * email via Supabase's recovery flow. Audit-logged.
 *
 * Use case: user forgot password, can't access their inbox-confirmation
 * email, or hit a flow that left them locked out. Admin clicks
 * "Send password reset" on /admin/users and the email goes out.
 */
export async function sendPasswordResetForUser(input: { userId: string }) {
  const ctx = await getAdminContext({ require: "send_password_reset" });
  if (!ctx.ok) return { error: "Admin only." };
  if (!input.userId) return { error: "Missing user id." };

  // Per-admin rate limit: 15 reset-emails per admin per hour. A
  // compromised admin account could otherwise spam every user with
  // password-reset emails. Legitimate support work rarely needs more
  // than a few per hour.
  if (!(await checkRateLimit(`admin:pwreset:${ctx.userId}`, 15, 3600))) {
    return { error: "You've sent a lot of password resets this hour. Try again later." };
  }

  // Look up the target user's email
  const sr = createServiceRoleClient();
  const { data: targetUser, error: lookupErr } = await sr.auth.admin.getUserById(input.userId);
  if (lookupErr || !targetUser?.user?.email) {
    return { error: "Could not find user email." };
  }

  const email = targetUser.user.email;
  const APP_URL = process.env.APP_URL ?? "https://www.ikratom.org";

  // Generate the recovery link
  const { data: linkData, error: linkErr } = await sr.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      redirectTo: `${APP_URL}/reset-password`,
    },
  });
  if (linkErr) return { error: `Recovery link generation failed: ${linkErr.message}` };

  // Email a token-hash link to /auth/confirm (verifyOtp), NOT the raw action_link.
  // action_link routes through Supabase /auth/v1/verify → the session comes back in
  // the URL #fragment and never reaches /reset-password with a session, so the page
  // dead-ended at /forgot?expired=1. /auth/confirm exchanges the token_hash
  // server-side and stamps the pw_recovery cookie setNewPassword requires.
  const tokenHash = linkData?.properties?.hashed_token;
  const verifyType = linkData?.properties?.verification_type ?? "recovery";
  const link = tokenHash
    ? `${APP_URL}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(verifyType)}&next=${encodeURIComponent("/reset-password")}`
    : linkData?.properties?.action_link;
  if (!link) return { error: "No recovery link returned by Supabase." };

  // Send via Resend with custom copy (Supabase's default template
  // also works if Resend isn't wired)
  if (process.env.RESEND_API_KEY) {
    try {
      const fromEmail = process.env.RESEND_FROM_EMAIL ?? "no-reply@ikratom.org";
      const fromName = process.env.RESEND_FROM_NAME ?? "iKratom";
      const adminLabel = ctx.isOwner ? "Owner" : "Admin";
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: email,
          subject: "Password reset link for your iKratom account",
          html: `
<p>Hi,</p>
<p>An ${adminLabel.toLowerCase()} of iKratom just sent you a password reset link, likely in response to you asking for help signing in.</p>
<p>Click below to set a new password. The link is valid for 1 hour.</p>
<p style="text-align:center;margin:32px 0">
  <a href="${link}" style="display:inline-block;background:#10b981;color:#0a0a0a;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Reset password →</a>
</p>
<p style="color:#666;font-size:12px">If you didn't request this, just ignore the email — the link expires and your account stays unchanged.</p>
<p style="color:#666;font-size:12px">Sent from iKratom · <a href="${APP_URL}/privacy">${APP_URL}/privacy</a></p>
`.trim(),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      console.error("[sendPasswordResetForUser] resend failed:", e);
      // Non-fatal — Supabase default email may still send
    }
  }

  await recordAdminAction({
    action: "password_reset_triggered",
    targetType: "user",
    targetId: input.userId,
    details: { email_redacted: email.replace(/(.{2}).*(@.*)/, "$1***$2") },
  });

  return { ok: true };
}

/**
 * Send a fresh magic-link sign-in for users who can't remember their
 * password OR who never set one (e.g. field-signup recruits whose
 * original link expired). Less destructive than password reset.
 */
export async function sendMagicLinkForUser(input: { userId: string }) {
  const ctx = await getAdminContext({ require: "send_magic_link" });
  if (!ctx.ok) return { error: "Admin only." };
  if (!input.userId) return { error: "Missing user id." };

  if (!(await checkRateLimit(`admin:magiclink:${ctx.userId}`, 15, 3600))) {
    return { error: "You've sent a lot of magic links this hour. Try again later." };
  }

  const sr = createServiceRoleClient();
  const { data: targetUser, error: lookupErr } = await sr.auth.admin.getUserById(input.userId);
  if (lookupErr || !targetUser?.user?.email) {
    return { error: "Could not find user email." };
  }
  const email = targetUser.user.email;
  const APP_URL = process.env.APP_URL ?? "https://www.ikratom.org";

  const { data: linkData, error: linkErr } = await sr.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${APP_URL}/dashboard` },
  });
  if (linkErr) return { error: `Magic link generation failed: ${linkErr.message}` };

  // Token-hash link to /auth/confirm (verifyOtp), not the raw #fragment action_link
  // (which would dead-end at /login?error=missing_code — same bug as field-signup).
  const tokenHash = linkData?.properties?.hashed_token;
  const verifyType = linkData?.properties?.verification_type ?? "magiclink";
  const link = tokenHash
    ? `${APP_URL}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(verifyType)}&next=${encodeURIComponent("/dashboard")}`
    : linkData?.properties?.action_link;
  if (!link) return { error: "No magic link returned." };

  if (process.env.RESEND_API_KEY) {
    try {
      const fromEmail = process.env.RESEND_FROM_EMAIL ?? "no-reply@ikratom.org";
      const fromName = process.env.RESEND_FROM_NAME ?? "iKratom";
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: email,
          subject: "Sign-in link for iKratom",
          html: `<p>Click below to sign in to iKratom. The link expires in 1 hour.</p><p style="text-align:center;margin:32px 0"><a href="${link}" style="display:inline-block;background:#10b981;color:#0a0a0a;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Sign in →</a></p>`.trim(),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      console.error("[sendMagicLinkForUser] resend failed:", e);
    }
  }

  await recordAdminAction({
    action: "magic_link_triggered",
    targetType: "user",
    targetId: input.userId,
  });

  return { ok: true };
}

/**
 * Admin-issued temporary password. Generates a strong 16-char temp,
 * sets it on the user's auth.users row via service-role, and stamps
 * profiles.password_must_change_at so the proxy bounces them to the
 * force-change page on next sign-in.
 *
 * Returns the plaintext temp password — caller shows it ONCE in the
 * admin UI (modal with copy button). It is never re-readable.
 *
 * Use case: user calls support unable to access their email, so we
 * can't email a reset link. Admin reads the temp over the phone /
 * Discord DM and the user is forced to set a real password on first
 * sign-in.
 */
export async function generateTempPassword(input: { userId: string }): Promise<
  { ok: true; tempPassword: string; email: string } | { error: string }
> {
  const ctx = await getAdminContext({ require: "issue_temp_password" });
  if (!ctx.ok) return { error: "Admin only." };
  // No MFA-for-mutation gate here. This is a customer-support action
  // used precisely when an admin is helping a locked-out user, often
  // from a session that hasn't re-verified 2FA recently. The gate was
  // blocking legitimate support without adding meaningful safety: this
  // action is still audit-logged, cannot self-issue, cannot cross-
  // owner, and the recipient is emailed every time so a malicious
  // admin can't silently take over.
  if (!input.userId) return { error: "Missing user id." };
  if (input.userId === ctx.userId) {
    return { error: "Use /account/security to change your own password." };
  }

  // Per-admin rate limit. Generating dozens of temp passwords in an
  // hour is suspicious — legitimate support workflows are bursty but
  // small. 10/hr keeps real support workable while making a
  // compromised admin's takeover spree obvious.
  if (!(await checkRateLimit(`admin:temppw:${ctx.userId}`, 10, 3600))) {
    return { error: "You've issued a lot of temp passwords this hour. Try again later." };
  }

  // Refuse to overwrite another PRIVILEGED account's password. This action
  // returns the plaintext temp to the CALLER (unlike reset/magic-link, which
  // only ever email the target), so it is the one true account-takeover path
  // in the admin toolkit. Previously it guarded owners only, which left admins
  // able to seize each other's accounts — and an admin account carries
  // master-edit, the AI editor, and support tooling. Owner-only for any
  // admin/owner target; admins keep it for ordinary locked-out users.
  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("is_owner, is_admin")
    .eq("id", input.userId)
    .single();
  if ((target?.is_owner || target?.is_admin) && !ctx.isOwner) {
    return { error: "Only the owner can issue a temp password to another admin or owner." };
  }

  // Look up the email (so we can echo it back to the admin + audit-log
  // a redacted form). Use service-role since admins may not have read
  // access on every profile email via RLS.
  const sr = createServiceRoleClient();
  const { data: targetUser, error: lookupErr } = await sr.auth.admin.getUserById(input.userId);
  if (lookupErr || !targetUser?.user?.email) {
    return { error: "Could not find user email." };
  }
  const email = targetUser.user.email;

  // Generate a strong 16-char temp using a mix of cases + digits +
  // safe symbols. Avoid ambiguous chars (0/O, 1/l/I) so it's
  // readable over the phone.
  const tempPassword = generateReadableTempPassword(16);

  // Set the password via admin API.
  const { error: setErr } = await sr.auth.admin.updateUserById(input.userId, {
    password: tempPassword,
  });
  if (setErr) return { error: `Failed to set temp password: ${setErr.message}` };

  // Stamp the must-change flag. Service-role so it works regardless of RLS.
  const { error: stampErr } = await sr
    .from("profiles")
    .update({ password_must_change_at: new Date().toISOString() })
    .eq("id", input.userId);
  if (stampErr) {
    // Roll back — we don't want to leave a working temp password with
    // no force-change gate. Best-effort restore via a random scramble
    // the user can't possibly know, forcing them to use reset-email.
    await sr.auth.admin.updateUserById(input.userId, {
      password: generateReadableTempPassword(32),
    });
    return { error: `Failed to flag account: ${stampErr.message}. Password was rolled back.` };
  }

  // Best-effort email the user that an admin set a temp password,
  // so a bad actor with admin access can't quietly take over an
  // account. The user gets a visible alarm in their inbox.
  if (process.env.RESEND_API_KEY) {
    try {
      const fromEmail = process.env.RESEND_FROM_EMAIL ?? "no-reply@ikratom.org";
      const fromName = process.env.RESEND_FROM_NAME ?? "iKratom";
      const APP_URL = process.env.APP_URL ?? "https://www.ikratom.org";
      const adminLabel = ctx.isOwner ? "Owner" : "Admin";
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: email,
          subject: "A temporary password was set on your iKratom account",
          html: `
<p>Hi,</p>
<p>An ${adminLabel.toLowerCase()} of iKratom just set a temporary password on your account, likely because you reached out for help signing in.</p>
<p>The temp password is single-use: as soon as you sign in with it, iKratom will force you to set your own new password before you can do anything else.</p>
<p style="text-align:center;margin:32px 0">
  <a href="${APP_URL}/login" style="display:inline-block;background:#10b981;color:#0a0a0a;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Sign in →</a>
</p>
<p style="color:#666;font-size:12px"><strong>If this wasn't you</strong> — i.e. you did not ask for support — reply to this email immediately. We'll lock the account and investigate.</p>
<p style="color:#666;font-size:12px">Sent from iKratom · <a href="${APP_URL}/privacy">${APP_URL}/privacy</a></p>
`.trim(),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      console.error("[generateTempPassword] resend failed:", e);
      // Non-fatal — admin still has the temp to read to the user.
    }
  }

  await recordAdminAction({
    action: "temp_password_issued",
    targetType: "user",
    targetId: input.userId,
    details: { email_redacted: email.replace(/(.{2}).*(@.*)/, "$1***$2") },
  });

  return { ok: true, tempPassword, email };
}

/**
 * Generates a temp password readable over a phone call. Avoids
 * 0/O, 1/l/I, and symbols that are hard to dictate. ~76 bits of
 * entropy at length 16 — plenty for a single-use gate.
 */
function generateReadableTempPassword(len: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  // Use the crypto module for unbiased random — Math.random is biased and
  // predictable, never appropriate for credentials.
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/**
 * Owner-only: lock a user's account temporarily. Owner can unlock by calling
 * with locked=false.
 *
 * ⚠ ENFORCEMENT MOVED TO THE AUTH LAYER (2026-08-20). This used to set only
 * `profiles.account_locked_at`, "the flag the proxy checks". `src/proxy.ts` was
 * disabled on 2026-07-26 for the Netlify migration (the adapter cannot bundle
 * Next 16 middleware under Turbopack, and re-enabling it means reverting to
 * webpack, which OOMs the remote builder). Nothing replaced it, so for 24+ days
 * locking an account changed a column and NOTHING else: the user kept a valid
 * session and every page still rendered for them. `/locked` existed with no
 * route to it.
 *
 * The flag alone cannot be enforced without a request choke point, and the two
 * available ones are both closed: middleware is unbundleable, and the root
 * layout explicitly forbids reintroducing `getCachedAuthProfile()` because that
 * is what forced all 200+ routes dynamic (see src/app/layout.tsx:104-111).
 *
 * So enforcement now happens where it cannot be bypassed at all: Supabase Auth.
 * Locking bans the auth user, which invalidates their sessions and refuses
 * subsequent sign-in; unlocking lifts the ban. The profile column is retained
 * as the audit/display record and as the source of truth for the admin UI.
 */
export async function setAccountLocked(input: { userId: string; locked: boolean; reason?: string }) {
  const ctx = await getAdminContext({ require: "lock_accounts" });
  if (!ctx.ok) return { error: "Admin only." };
  if (!ctx.isOwner) return { error: "Owner only." };
  if (!input.userId) return { error: "Missing user id." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      account_locked_at: input.locked ? new Date().toISOString() : null,
      account_locked_reason: input.locked ? (input.reason ?? "owner-locked").slice(0, 500) : null,
    })
    .eq("id", input.userId);
  if (error) return { error: error.message };

  // The part that actually stops them. `ban_duration` takes a Go duration
  // string; "none" clears it. 876000h ≈ 100 years = indefinite until unlocked.
  // Failing here must NOT report success — a lock that only wrote a column is
  // exactly the bug this replaces — so surface it and leave the flag for the
  // owner to retry against.
  const admin = createServiceRoleClient();
  const { error: banErr } = await admin.auth.admin.updateUserById(input.userId, {
    ban_duration: input.locked ? "876000h" : "none",
  });
  if (banErr) {
    return { error: `Profile flag saved, but the auth ${input.locked ? "ban" : "unban"} failed: ${banErr.message}. The account is NOT ${input.locked ? "locked" : "unlocked"} — retry.` };
  }

  await recordAdminAction({
    action: input.locked ? "account_locked" : "account_unlocked",
    targetType: "user",
    targetId: input.userId,
    details: { reason: input.reason ?? null },
  });

  return { ok: true };
}

/**
 * Called by the dashboard's leader tutorial after the user finishes (or
 * skips) the walkthrough — clears leader_tour_pending so it doesn't
 * re-fire on every dashboard visit.
 */
export async function clearLeaderTourPending() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  const { error } = await supabase
    .from("profiles")
    .update({ leader_tour_pending: false })
    .eq("id", user.id);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Marks the user as having completed the multi-page leader tour
 * AND clicked the required "I acknowledge these rules" checkbox.
 * Until this is set, the layout shows a sticky reminder banner
 * and certain leader-only actions show a soft gate.
 */
export async function acknowledgeLeaderRules() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  const { error } = await supabase
    .from("profiles")
    .update({
      leader_acknowledged_at: new Date().toISOString(),
      leader_tour_pending: false,
    })
    .eq("id", user.id);
  if (error) return { error: error.message };
  // Audit so we have a record the user actually confirmed the rules
  await recordAdminAction({
    action: "leader_rules_acknowledged",
    targetType: "user",
    targetId: user.id,
  });
  return { ok: true };
}

/**
 * Replay the leader tour from any page. Sets leader_tour_pending=true
 * so the next dashboard/page visit re-triggers the multi-page flow.
 * Available to anyone who is currently a leader (admin/owner included).
 */
export async function replayLeaderTour() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  const { data: prof } = await supabase
    .from("profiles")
    .select("is_advocate_leader, is_admin, is_owner")
    .eq("id", user.id)
    .single();
  if (!(prof?.is_advocate_leader || prof?.is_admin || prof?.is_owner)) {
    return { error: "Leader role required." };
  }
  await supabase
    .from("profiles")
    .update({ leader_tour_pending: true })
    .eq("id", user.id);
  return { ok: true };
}
