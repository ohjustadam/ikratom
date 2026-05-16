/**
 * Gmail send-on-behalf adapter.
 * Server-only — uses refresh tokens stored in email_integrations.
 *
 * Flow:
 *   1. Read refresh_token from DB (scoped to authenticated user)
 *   2. Mint a short-lived access_token from Google
 *   3. Build a base64url-encoded RFC 2822 message
 *   4. POST to gmail.users.messages.send
 *
 * Each call sends one personalized email — for batch sends, the caller iterates.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";

export type GmailIntegration = {
  user_id: string;
  account_email: string;
  refresh_token: string;
};

export async function getGmailIntegration(userId: string): Promise<GmailIntegration | null> {
  const admin = serviceClient();
  const { data } = await admin
    .from("email_integrations")
    .select("user_id, account_email, refresh_token")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .maybeSingle();
  return data;
}

export async function disconnectGmail(userId: string): Promise<void> {
  const admin = serviceClient();
  await admin.from("email_integrations").delete().eq("user_id", userId).eq("provider", "gmail");
}

/** Thrown when Google returns invalid_grant — refresh token has been
 *  revoked by the user (or expired after 6 months of inactivity).
 *  Caller should mark the row stale + prompt the user to reconnect. */
export class GmailTokenRevokedError extends Error {
  constructor() { super("Gmail token revoked"); this.name = "GmailTokenRevokedError"; }
}

async function mintAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    // Read body to distinguish revocation from transient outage. Google
    // returns 400 + { error: "invalid_grant" } when the user has clicked
    // "Remove access" in their Google account or the refresh token has
    // gone stale (Google expires unused tokens after ~6 months).
    let body: { error?: string } = {};
    try { body = await res.json(); } catch { /* not JSON — leave empty */ }
    if (res.status === 400 && body.error === "invalid_grant") {
      throw new GmailTokenRevokedError();
    }
    throw new Error(`Gmail token refresh failed: ${res.status}`);
  }
  const data = await res.json();
  return data.access_token;
}

/**
 * Mark a user's Gmail integration as stale after a revoked token.
 * Sets last_error + clears refresh_token so the next page render
 * shows the "Connect Gmail" CTA again. Best-effort — never throws.
 */
export async function markGmailIntegrationRevoked(userId: string): Promise<void> {
  try {
    const admin = serviceClient();
    await admin
      .from("email_integrations")
      .update({
        refresh_token: "",
        last_error: `invalid_grant @ ${new Date().toISOString()}`,
      })
      .eq("user_id", userId)
      .eq("provider", "gmail");
  } catch (e) {
    console.error("[gmail] markGmailIntegrationRevoked failed:", e);
  }
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildRfc2822({
  fromName,
  fromEmail,
  to,
  subject,
  body,
}: {
  fromName: string | null;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
}): string {
  const fromHeader = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  // RFC-2822 plain text. Subject is RFC 2047 encoded for safety with non-ASCII.
  const subjectEncoded = `=?utf-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
  const lines = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subjectEncoded}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    body,
  ];
  return lines.join("\r\n");
}

/**
 * Send one email through the user's Gmail account.
 * Throws on failure.
 */
export async function sendViaGmail(input: {
  refreshToken: string;
  fromName: string | null;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ messageId: string }> {
  const accessToken = await mintAccessToken(input.refreshToken);

  const rfc = buildRfc2822({
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    to: input.to,
    subject: input.subject,
    body: input.body,
  });
  const raw = base64UrlEncode(rfc);

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail send failed: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return { messageId: data.id };
}

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
