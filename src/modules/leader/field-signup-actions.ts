"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAdminAction } from "@/lib/audit";
import { publicHandle } from "@/lib/public-handle";

/**
 * Field signup — a leader collects an email + first name + zip from
 * someone in person (booth, door-to-door, event, shop visit) and
 * sends them a magic-link email. The recruit completes their full
 * profile via the link in their inbox.
 *
 * Privacy posture: sensitive data NEVER lives on the leader's phone.
 * Only the three minimum fields land in the DB plus the magic link
 * is sent server-side. The recruit's address, story, etc. only get
 * filled in by the recruit themselves on /account.
 *
 * Idempotency: if the email already exists as a user, we DON'T
 * create a duplicate — we instead send them a magic-link to their
 * existing account + still credit the referrer if they don't have
 * one yet.
 *
 * Rate limit: 30 signups per hour per leader IP, 60 per day per
 * leader id. Stops a malicious leader from spamming sign-ups.
 */

export async function createFieldSignup(input: {
  email: string;
  firstName: string;
  zip: string;
  state?: string | null;
  consent: boolean;
}) {
  // Server-side: confirm caller is a leader
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };

  const { data: leader } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader, username, state, leader_acknowledged_at")
    .eq("id", user.id)
    .single();
  if (!(leader?.is_admin || leader?.is_owner || leader?.is_advocate_leader)) {
    return { error: "Leader role required." };
  }
  // Block leaders who haven't acknowledged the rules
  if (leader?.is_advocate_leader && !leader.is_admin && !leader.is_owner) {
    if (!leader.leader_acknowledged_at) {
      return { error: "Complete the leader walkthrough + acknowledgment first (banner at top of page)." };
    }
  }

  // Validate inputs
  const email = input.email.trim().toLowerCase().slice(0, 254);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Valid email required." };
  }
  const firstName = input.firstName.trim().slice(0, 60);
  if (!firstName || firstName.length < 1) return { error: "First name required." };
  const zip = input.zip.trim().slice(0, 10);
  if (!/^\d{5}(-\d{4})?$/.test(zip)) return { error: "ZIP must be 5 or 9 digits." };
  const stateRaw = (input.state ?? "").trim().toUpperCase().slice(0, 2);
  const state = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null;
  if (!input.consent) {
    return { error: "Recruit must verbally consent to receiving the magic-link email." };
  }

  // Rate limits
  const ipOk = await checkRateLimit(`field-signup:ip:${await getClientIp()}`, 30, 3_600);
  if (!ipOk) return { error: "Too many signups from this network in the last hour. Slow down." };
  const userOk = await checkRateLimit(`field-signup:user:${user.id}`, 60, 86_400);
  if (!userOk) return { error: "You've onboarded 60 recruits in 24 hours. Take a break and resume tomorrow." };

  // Service-role for auth admin + writing to another user's profile row
  const sr = createServiceRoleClient();

  // Idempotency: does this email already have an account? Look it up in
  // profiles by email (service-role, RLS-bypassed) — the signup trigger
  // populates profiles.email. The old auth.admin.listUsers({ perPage: 1 })
  // path only ever inspected the FIRST user, so it never matched an existing
  // recruit; the profile lookup is the reliable primary.
  let existingUserId: string | null = null;
  try {
    const { data: profByEmail } = await sr
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (profByEmail) existingUserId = profByEmail.id;
  } catch { /* best-effort */ }

  const wasExisting = !!existingUserId;
  let targetUserId = existingUserId;

  // If user is brand new, create the auth row
  if (!targetUserId) {
    const { data: created, error: createErr } = await sr.auth.admin.createUser({
      email,
      email_confirm: false, // they confirm via the magic link
      user_metadata: {
        first_name: firstName,
        referrer_id: user.id,
        signup_source: "field_leader",
        signup_at: new Date().toISOString(),
      },
    });
    if (createErr) {
      // If duplicate, fall through to magic-link path
      if (createErr.message?.toLowerCase().includes("already")) {
        // Race condition — someone created the account between our
        // check and our insert. Re-find them.
        try {
          const { data: refetch } = await sr
            .from("profiles")
            .select("id")
            .eq("email", email)
            .maybeSingle();
          targetUserId = refetch?.id ?? null;
        } catch { /* best-effort */ }
      } else {
        return { error: `Could not create user: ${createErr.message}` };
      }
    } else {
      targetUserId = created.user?.id ?? null;
    }
  }

  if (!targetUserId) return { error: "Could not resolve user id after creation." };

  // Upsert profile fields. We DON'T overwrite an existing user's
  // full_name or address. We DO stamp referrer_id if it's null.
  const profilePatch: Record<string, unknown> = {
    id: targetUserId,
    email,
  };
  if (!wasExisting) {
    profilePatch.full_name = firstName; // they can edit later
    profilePatch.zip = zip;
    if (state) profilePatch.state = state;
    profilePatch.referrer_id = user.id;
  } else {
    // For existing users, just stamp referrer_id IF null (don't overwrite)
    const { data: existingProf } = await sr
      .from("profiles")
      .select("referrer_id, zip, state")
      .eq("id", targetUserId)
      .single();
    if (existingProf && existingProf.referrer_id === null) {
      profilePatch.referrer_id = user.id;
    }
    if (existingProf && !existingProf.zip) profilePatch.zip = zip;
    if (existingProf && !existingProf.state && state) profilePatch.state = state;
  }

  const { error: upsertErr } = await sr
    .from("profiles")
    .upsert(profilePatch, { onConflict: "id" });
  if (upsertErr) {
    return { error: `Profile write failed: ${upsertErr.message}` };
  }

  // Generate the magic link. Supabase admin API gives us back the
  // action_link which we then send via Resend so we control the
  // copy. If RESEND isn't wired, Supabase's own templating sends
  // the default email.
  const APP_URL = process.env.APP_URL ?? "https://www.ikratom.org";
  const { data: linkData, error: linkErr } = await sr.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${APP_URL}/account?welcome=1`,
    },
  });
  if (linkErr) {
    // Non-fatal — profile exists, just couldn't email. Tell the leader.
    console.error("[field-signup] generateLink failed:", linkErr.message);
    return {
      error: `Profile created but couldn't send magic link: ${linkErr.message}. Recruit can sign in manually via ${APP_URL}/login with their email.`,
    };
  }

  // Build a token-hash link to /auth/confirm (verifyOtp) — NOT the raw
  // action_link. action_link points at Supabase's /auth/v1/verify, which
  // (implicit flow) returns the session in the URL #fragment — unreadable
  // by a server route, so it died on /auth/callback with ?error=missing_code.
  // hashed_token + verification_type let /auth/confirm exchange it
  // server-side with no code_verifier. See src/app/auth/confirm/route.ts.
  const tokenHash = linkData?.properties?.hashed_token;
  const verifyType = linkData?.properties?.verification_type ?? "magiclink";
  const confirmLink = tokenHash
    ? `${APP_URL}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(verifyType)}&next=${encodeURIComponent("/account?welcome=1")}`
    : linkData?.properties?.action_link;
  if (confirmLink && process.env.RESEND_API_KEY) {
    // Send via Resend with our custom copy
    try {
      const fromEmail = process.env.RESEND_FROM_EMAIL ?? "no-reply@ikratom.org";
      const fromName = process.env.RESEND_FROM_NAME ?? "iKratom";
      // Public anonymity: recruits see the leader's @handle, never their
      // real name. publicHandle() → "@username" (or "Advocate from {ST}" /
      // "Member" fallbacks). full_name stays for private uses only.
      const leaderName = publicHandle({
        username: leader?.username,
        state: leader?.state,
      });
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: email,
          subject: `${leaderName} signed you up for iKratom — finish your profile`,
          html: `
<p>Hi ${escapeHtml(firstName)},</p>
<p>${escapeHtml(leaderName)} signed you up for <strong>iKratom</strong> just now — the nonpartisan kratom advocacy toolbelt. You consented to this in person.</p>
<p>Click the link below to sign in and complete your profile (your full address so we can match you to your reps, your kratom story for legislator letters, etc.). Takes 90 seconds.</p>
<p style="text-align:center;margin:32px 0">
  <a href="${confirmLink}" style="display:inline-block;background:#10b981;color:#0a0a0a;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Sign in to iKratom →</a>
</p>
<p style="color:#666;font-size:12px">If you didn't expect this email, you can ignore it — the link expires in 1 hour and your account stays inactive.</p>
<p style="color:#666;font-size:12px">Sent on behalf of ${escapeHtml(leaderName)} via iKratom. Privacy: <a href="${APP_URL}/privacy">${APP_URL}/privacy</a></p>
`.trim(),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      console.error("[field-signup] resend send failed:", e);
      // Magic link was generated — user can still get the supabase email
    }
  }

  // Audit log
  await recordAdminAction({
    action: "field_signup",
    targetType: "user",
    targetId: targetUserId,
    details: {
      email,
      first_name: firstName,
      was_existing: wasExisting,
    },
  });

  return {
    ok: true,
    wasExisting,
    recruitFirstName: firstName,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
