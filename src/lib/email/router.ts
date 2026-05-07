/**
 * Multi-provider email router.
 *
 * Picks providers in priority order and tries each in turn until one
 * succeeds or all are exhausted. Tracks per-provider per-day send count
 * in `email_quota_log` so we don't hammer a provider that's already at
 * its free-tier cap.
 *
 * Priority order (first available wins):
 *   1. Brevo (highest free daily cap, 300/day)
 *   2. Mailjet (200/day)
 *   3. Resend (100/day, but already proven; reliable)
 *   4. MailerSend (100/day)
 *
 * Why Brevo first vs Resend: combined-cap utilization. If we always
 * tried Resend first, we'd hit its 100/day cap by lunchtime on a busy
 * day, then start using fallbacks. Putting Brevo first means we use
 * the LARGEST cap first — Resend's 100 stays held in reserve for the
 * tail of the day.
 *
 * Service-role write to email_quota_log: uses the server-side client
 * with service-role key (no RLS dance for cron context).
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { emailProviders, isProviderConfigured, DAILY_CAP } from "./providers";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./types";

const PRIORITY: EmailProvider[] = ["brevo", "mailjet", "resend", "mailersend"];

export type RouterResult =
  | { ok: true; provider: EmailProvider; id: string }
  | { ok: false; tried: { provider: EmailProvider; error: string }[] }
  | { skipped: true; reason: string };

/**
 * Send an email via the first available provider with quota remaining.
 * No-ops cleanly if no provider is configured (returns `{ skipped }`).
 */
export async function sendEmail(msg: EmailMessage): Promise<RouterResult> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.to)) {
    return { skipped: true, reason: "invalid_to" };
  }

  const supabase = createServiceRoleClient();
  const today = new Date().toISOString().slice(0, 10);

  // Pull today's per-provider counts in one query
  const { data: counts } = await supabase
    .from("email_quota_log")
    .select("provider, sent_count")
    .eq("day", today);
  const usedByProvider: Partial<Record<EmailProvider, number>> = {};
  for (const r of (counts ?? []) as { provider: EmailProvider; sent_count: number }[]) {
    usedByProvider[r.provider] = r.sent_count;
  }

  const tried: { provider: EmailProvider; error: string }[] = [];

  for (const provider of PRIORITY) {
    if (!isProviderConfigured(provider)) continue;
    const used = usedByProvider[provider] ?? 0;
    if (used >= DAILY_CAP[provider]) {
      tried.push({ provider, error: `quota_exhausted (${used}/${DAILY_CAP[provider]})` });
      continue;
    }

    const result = await emailProviders[provider](msg);
    if (result.ok) {
      await bumpQuota(supabase, provider, today, "sent");
      return { ok: true, provider: result.provider, id: result.id };
    }
    await bumpQuota(supabase, provider, today, "failed");
    tried.push({ provider, error: result.reason + (result.error ? `: ${result.error}` : "") });
    // Continue to next provider
  }

  if (tried.length === 0) {
    return { skipped: true, reason: "no_providers_configured" };
  }
  return { ok: false, tried };
}

async function bumpQuota(
  supabase: ReturnType<typeof createServiceRoleClient>,
  provider: EmailProvider,
  day: string,
  kind: "sent" | "failed",
) {
  // Upsert pattern: insert if missing, increment if present.
  const colSent = kind === "sent" ? 1 : 0;
  const colFailed = kind === "failed" ? 1 : 0;

  const { error: insertErr } = await supabase
    .from("email_quota_log")
    .insert({ provider, day, sent_count: colSent, failed_count: colFailed, last_send_at: new Date().toISOString() });

  if (insertErr) {
    // Already exists; increment instead.
    const { data: existing } = await supabase
      .from("email_quota_log")
      .select("sent_count, failed_count")
      .eq("provider", provider)
      .eq("day", day)
      .single();
    if (existing) {
      const next = {
        sent_count: (existing.sent_count ?? 0) + colSent,
        failed_count: (existing.failed_count ?? 0) + colFailed,
        last_send_at: new Date().toISOString(),
      };
      await supabase.from("email_quota_log").update(next).eq("provider", provider).eq("day", day);
    }
  }
}

/**
 * Get today's quota status across all providers — used by /admin/ai-control
 * (and possibly an /admin/email-status page) to show remaining headroom.
 */
export async function getTodayQuotaStatus() {
  const supabase = createServiceRoleClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("email_quota_log")
    .select("provider, sent_count, failed_count, last_send_at")
    .eq("day", today);

  const result: Record<EmailProvider, { sent: number; failed: number; cap: number; configured: boolean; lastAt: string | null }> = {
    resend: { sent: 0, failed: 0, cap: DAILY_CAP.resend, configured: isProviderConfigured("resend"), lastAt: null },
    brevo: { sent: 0, failed: 0, cap: DAILY_CAP.brevo, configured: isProviderConfigured("brevo"), lastAt: null },
    mailjet: { sent: 0, failed: 0, cap: DAILY_CAP.mailjet, configured: isProviderConfigured("mailjet"), lastAt: null },
    mailersend: { sent: 0, failed: 0, cap: DAILY_CAP.mailersend, configured: isProviderConfigured("mailersend"), lastAt: null },
  };
  for (const r of (data ?? []) as { provider: EmailProvider; sent_count: number; failed_count: number; last_send_at: string | null }[]) {
    result[r.provider] = {
      ...result[r.provider],
      sent: r.sent_count,
      failed: r.failed_count,
      lastAt: r.last_send_at,
    };
  }
  return result;
}

// Re-export the legacy single-provider sender so existing callers don't
// have to change today. New callers should import sendEmail from this file.
export { sendTransactionalEmail, brandedHtml } from "./transactional";
