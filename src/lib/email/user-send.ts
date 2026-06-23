/**
 * Provider-agnostic USER send-on-behalf dispatcher.
 *
 * This is the email-router for "user grants OAuth, we send email from
 * their address". Distinct from `./router.ts` which routes system /
 * transactional emails through Resend / Brevo / Mailjet / MailerSend.
 *
 * Owner directive 2026-05-17: "we need to be able and service all
 * people equally, not just for gmail." This file is the dispatch point
 * for that. Today: Gmail + Outlook. Future: add Yahoo via the same
 * interface (one row per user in email_integrations, PK on user_id).
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { decryptToken } from "@/lib/token-crypto";
import {
  sendViaGmail,
  GmailTokenRevokedError,
  markGmailIntegrationRevoked,
} from "./gmail";
import {
  sendViaOutlook,
  OutlookTokenRevokedError,
  markOutlookIntegrationRevoked,
} from "./outlook";

export type UserSendProvider = "gmail" | "outlook";

export type EmailIntegrationRow = {
  user_id: string;
  provider: UserSendProvider;
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

/**
 * Returns the user's connected email-integration row regardless of
 * provider. `email_integrations.user_id` is PK so at most one row per
 * user. Returns null when no provider is connected OR the token was
 * blanked after revocation.
 */
export async function getEmailIntegration(userId: string): Promise<EmailIntegrationRow | null> {
  const admin = serviceClient();
  const { data } = await admin
    .from("email_integrations")
    .select("user_id, provider, account_email, refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  data.refresh_token = decryptToken(data.refresh_token); // at-rest decrypt (oauth-02)
  if (!data.refresh_token) return null;
  if (data.provider !== "gmail" && data.provider !== "outlook") return null;
  return data as EmailIntegrationRow;
}

/**
 * Thrown when either provider's refresh token has been revoked.
 * Callers catch this (instead of GmailTokenRevokedError /
 * OutlookTokenRevokedError individually) and treat it uniformly:
 * mark integration stale, stop the batch, prompt reconnect.
 */
export class EmailTokenRevokedError extends Error {
  constructor(public provider: UserSendProvider) {
    super(`${provider} token revoked`);
    this.name = "EmailTokenRevokedError";
  }
}

/** Send one email via the user's connected provider. */
export async function sendOnUserBehalf(input: {
  integration: EmailIntegrationRow;
  fromName: string | null;
  to: string;
  subject: string;
  body: string;
}): Promise<{ messageId: string }> {
  try {
    if (input.integration.provider === "gmail") {
      return await sendViaGmail({
        refreshToken: input.integration.refresh_token,
        fromName: input.fromName,
        fromEmail: input.integration.account_email,
        to: input.to,
        subject: input.subject,
        body: input.body,
      });
    }
    return await sendViaOutlook({
      refreshToken: input.integration.refresh_token,
      fromName: input.fromName,
      fromEmail: input.integration.account_email,
      to: input.to,
      subject: input.subject,
      body: input.body,
    });
  } catch (e) {
    if (e instanceof GmailTokenRevokedError) throw new EmailTokenRevokedError("gmail");
    if (e instanceof OutlookTokenRevokedError) throw new EmailTokenRevokedError("outlook");
    throw e;
  }
}

/** Mark a user's integration stale after a revoked token. */
export async function markEmailIntegrationRevoked(
  userId: string,
  provider: UserSendProvider,
): Promise<void> {
  if (provider === "gmail") await markGmailIntegrationRevoked(userId);
  else await markOutlookIntegrationRevoked(userId);
}
