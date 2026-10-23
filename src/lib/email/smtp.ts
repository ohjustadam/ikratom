import "server-only";
import nodemailer from "nodemailer";

/**
 * Send-on-behalf for providers with no "Sign in with…" permission screen:
 * Yahoo, AOL and iCloud (owner yes, 2026-10-22). The member creates an APP
 * PASSWORD in their provider's security settings — not their real password,
 * mail-only, revocable there at any time — and pastes it into iKratom once.
 * It is stored AES-256-GCM encrypted (token-crypto, the same at-rest
 * encryption as Gmail/Outlook refresh tokens), never shown again, and deleted
 * on disconnect. Proton (no SMTP on free accounts) and Zoho Free (webmail
 * only) cannot be supported this way.
 */

export type SmtpProvider = "yahoo" | "aol" | "icloud";

export const SMTP_PROVIDERS: Record<SmtpProvider, {
  label: string;
  host: string;
  port: number;
  secure: boolean; // true = implicit TLS (465); false = STARTTLS (587)
  domains: string[];
  appPasswordHelp: string;
}> = {
  yahoo: {
    label: "Yahoo Mail",
    host: "smtp.mail.yahoo.com", port: 465, secure: true,
    domains: ["yahoo.com", "ymail.com", "rocketmail.com", "yahoo.co.uk", "yahoo.ca"],
    appPasswordHelp: "https://help.yahoo.com/kb/SLN15241.html",
  },
  aol: {
    label: "AOL Mail",
    host: "smtp.aol.com", port: 465, secure: true,
    domains: ["aol.com", "aim.com"],
    appPasswordHelp: "https://help.aol.com/articles/Create-and-manage-app-password",
  },
  icloud: {
    label: "iCloud Mail",
    host: "smtp.mail.me.com", port: 587, secure: false,
    domains: ["icloud.com", "me.com", "mac.com"],
    appPasswordHelp: "https://support.apple.com/en-us/102654",
  },
};

export const isSmtpProvider = (p: string): p is SmtpProvider => p in SMTP_PROVIDERS;

/** Thrown when the provider refuses the app password (revoked or mistyped). */
export class SmtpAuthError extends Error {
  constructor(public provider: SmtpProvider) {
    super(`${provider} rejected the app password`);
    this.name = "SmtpAuthError";
  }
}

function transport(provider: SmtpProvider, user: string, appPassword: string) {
  const cfg = SMTP_PROVIDERS[provider];
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure,
    auth: { user, pass: appPassword },
    connectionTimeout: 15_000,
    socketTimeout: 20_000,
  });
}

const isAuthFailure = (e: unknown) =>
  /\b535\b|auth(entication)? (failed|unsuccessful)|invalid (login|credentials)|EAUTH/i.test(String((e as { code?: string; message?: string })?.code ?? "") + " " + String((e as Error)?.message ?? ""));

/** Check the app password without sending anything (SMTP AUTH only). */
export async function verifySmtpLogin(provider: SmtpProvider, user: string, appPassword: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await transport(provider, user, appPassword).verify();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: isAuthFailure(e)
        ? `${SMTP_PROVIDERS[provider].label} didn't accept that app password. Make a new one and paste it exactly.`
        : `Couldn't reach ${SMTP_PROVIDERS[provider].label} just now. Try again in a minute.`,
    };
  }
}

/** Send one letter from the member's own address. */
export async function sendViaSmtp(input: {
  provider: SmtpProvider;
  user: string;
  appPassword: string;
  fromName: string | null;
  to: string;
  subject: string;
  body: string;
}): Promise<{ messageId: string }> {
  try {
    const info = await transport(input.provider, input.user, input.appPassword).sendMail({
      from: input.fromName ? { name: input.fromName, address: input.user } : input.user,
      to: input.to,
      subject: input.subject,
      text: input.body,
    });
    return { messageId: String(info.messageId ?? "") };
  } catch (e) {
    if (isAuthFailure(e)) throw new SmtpAuthError(input.provider);
    throw e;
  }
}
