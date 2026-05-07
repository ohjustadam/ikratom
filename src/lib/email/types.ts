/**
 * Shared types for the multi-provider email router.
 * Keeping these here (not inline in providers.ts) so consumers can import
 * the type without pulling in the provider HTTP wrappers.
 */

export type EmailProvider = "resend" | "brevo" | "mailjet" | "mailersend";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
  fromEmail?: string;
  tag?: string;
};

export type EmailSendResult =
  | { ok: true; provider: EmailProvider; id: string }
  | {
      ok: false;
      provider: EmailProvider;
      reason: "no_api_key" | "no_from_address" | "invalid_to" | "api_error" | "network" | "quota_exhausted";
      error?: string;
    };
