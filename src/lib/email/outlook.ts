/**
 * Microsoft Graph / Outlook send-on-behalf adapter.
 * Server-only — uses refresh tokens stored in email_integrations (provider='outlook').
 *
 * Flow mirrors gmail.ts:
 *   1. Read refresh_token from DB (one row per user; PK on user_id)
 *   2. Mint a short-lived access_token from Microsoft Identity Platform
 *   3. POST a message to /me/sendMail via Microsoft Graph
 *
 * Each call sends one personalized email — for batch sends the caller
 * iterates. Microsoft's rate limit is generous (10k msgs/day on consumer
 * Outlook.com, much higher on M365) so sequential sends are fine.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";

export type OutlookIntegration = {
  user_id: string;
  account_email: string;
  refresh_token: string;
};

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function getOutlookIntegration(userId: string): Promise<OutlookIntegration | null> {
  const admin = serviceClient();
  const { data } = await admin
    .from("email_integrations")
    .select("user_id, account_email, refresh_token")
    .eq("user_id", userId)
    .eq("provider", "outlook")
    .maybeSingle();
  return data;
}

export async function disconnectOutlook(userId: string): Promise<void> {
  const admin = serviceClient();
  await admin
    .from("email_integrations")
    .delete()
    .eq("user_id", userId)
    .eq("provider", "outlook");
}

/** Thrown when Microsoft returns invalid_grant — refresh token revoked
 *  (user signed out everywhere, admin pulled their consent, or the
 *  token expired after ~90 days of inactivity). Caller marks the row
 *  stale + prompts reconnect. */
export class OutlookTokenRevokedError extends Error {
  constructor() {
    super("Outlook token revoked");
    this.name = "OutlookTokenRevokedError";
  }
}

async function mintAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_OAUTH_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: "Mail.Send offline_access User.Read",
      }),
    },
  );
  if (!res.ok) {
    let body: { error?: string } = {};
    try { body = await res.json(); } catch { /* not JSON */ }
    if (res.status === 400 && body.error === "invalid_grant") {
      throw new OutlookTokenRevokedError();
    }
    throw new Error(`Outlook token refresh failed: ${res.status}`);
  }
  const data = await res.json();
  return data.access_token;
}

/**
 * Mark an Outlook integration stale after a revoked token. Sets
 * last_error + blanks refresh_token so the next render shows the
 * Connect-Outlook CTA again. Best-effort — never throws.
 */
export async function markOutlookIntegrationRevoked(userId: string): Promise<void> {
  try {
    const admin = serviceClient();
    await admin
      .from("email_integrations")
      .update({
        refresh_token: "",
        last_error: `invalid_grant @ ${new Date().toISOString()}`,
      })
      .eq("user_id", userId)
      .eq("provider", "outlook");
  } catch (e) {
    console.error("[outlook] markOutlookIntegrationRevoked failed:", e);
  }
}

/**
 * Send one email via the user's Outlook account.
 * Microsoft Graph wants a JSON envelope (NOT base64-MIME like Gmail).
 * Throws on failure.
 */
export async function sendViaOutlook(input: {
  refreshToken: string;
  fromName: string | null;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ messageId: string }> {
  const accessToken = await mintAccessToken(input.refreshToken);

  const message = {
    message: {
      subject: input.subject,
      body: {
        contentType: "Text",
        content: input.body,
      },
      toRecipients: [
        {
          emailAddress: { address: input.to },
        },
      ],
      from: {
        emailAddress: {
          address: input.fromEmail,
          ...(input.fromName ? { name: input.fromName } : {}),
        },
      },
    },
    // Save to user's Sent Items — same UX as Gmail's behavior
    saveToSentItems: true,
  };

  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me/sendMail",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(message),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Outlook sendMail failed: ${res.status} ${errText.slice(0, 200)}`);
  }

  // Graph's sendMail returns 202 Accepted with no body and no message id —
  // we synthesize one from headers + timestamp so the audit log has
  // something. (Gmail returns a real Message-ID; Microsoft doesn't.)
  const requestId = res.headers.get("request-id") ?? "";
  return { messageId: `outlook:${requestId || Date.now().toString(36)}` };
}
