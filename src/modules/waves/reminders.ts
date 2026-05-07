/**
 * Send reminder emails to wave signups when fire time is 60-120 minutes
 * away. No-ops cleanly if RESEND_API_KEY isn't set (Resend wrapper
 * already handles that). Marks reminder_sent_at on each signup so we
 * never double-send.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTransactionalEmail, brandedHtml } from "@/lib/email/transactional";

const REMIND_WINDOW_MIN_MIN = 30;   // start reminding when fire is ≥ 30min away
const REMIND_WINDOW_MAX_MIN = 120;  // and ≤ 2hr away

type Wave = {
  id: string;
  campaign_id: string;
  title: string;
  scheduled_at: string;
  campaigns: { slug: string; title: string; state: string | null }[] | { slug: string; title: string; state: string | null } | null;
};

export async function sendWaveReminders(supabase: SupabaseClient): Promise<{
  wavesChecked: number;
  remindersSent: number;
  failed: number;
}> {
  const out = { wavesChecked: 0, remindersSent: 0, failed: 0 };
  const now = Date.now();
  const minIso = new Date(now + REMIND_WINDOW_MIN_MIN * 60_000).toISOString();
  const maxIso = new Date(now + REMIND_WINDOW_MAX_MIN * 60_000).toISOString();

  const { data: waves } = await supabase
    .from("campaign_waves")
    .select("id, campaign_id, title, scheduled_at, campaigns(slug, title, state)")
    .eq("active", true)
    .is("fired_at", null)
    .gte("scheduled_at", minIso)
    .lte("scheduled_at", maxIso);

  out.wavesChecked = (waves ?? []).length;
  if (out.wavesChecked === 0) return out;

  for (const wRaw of (waves ?? []) as unknown as Wave[]) {
    const campaign = Array.isArray(wRaw.campaigns) ? wRaw.campaigns[0] : wRaw.campaigns;
    if (!campaign) continue;

    // Pull pending signups that haven't been reminded yet
    const { data: signups } = await supabase
      .from("campaign_wave_signups")
      .select("id, user_id")
      .eq("wave_id", wRaw.id)
      .eq("send_status", "pending")
      .is("reminder_sent_at", null)
      .limit(100);

    if (!signups || signups.length === 0) continue;

    // Pull emails for every signup user in one round-trip
    const userIds = signups.map((s: { user_id: string }) => s.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds);
    const emailById = new Map<string, { email: string | null; name: string | null }>(
      ((profiles ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>).map((p) => [
        p.id, { email: p.email, name: p.full_name },
      ]),
    );

    const fireTime = new Date(wRaw.scheduled_at).toLocaleString();
    const headline = `Wave fires in less than 2 hours: ${campaign.title}`;
    const body = `Reminder: the coalition wave you joined fires at ${fireTime}.

Make sure your Gmail is still connected at https://${process.env.APP_URL ?? "ikratom.org"}/account — that's where the email goes from. If anything looks off, you can pull out anytime before fire time at the campaign page.`;

    for (const s of signups as Array<{ id: string; user_id: string }>) {
      const target = emailById.get(s.user_id);
      if (!target?.email) continue;

      const html = brandedHtml({
        headline,
        body: `<p>${body.replace(/\n/g, "<br>")}</p>`,
        ctaLabel: "Open campaign",
        ctaHref: `${process.env.APP_URL ?? "https://www.ikratom.org"}/campaigns/${campaign.slug}`,
      });
      const r = await sendTransactionalEmail({
        to: target.email,
        subject: headline,
        text: body,
        html,
        tag: "wave_reminder",
      });
      if ("ok" in r && r.ok) {
        out.remindersSent++;
      } else if ("error" in r && r.error) {
        out.failed++;
      }
      // Always mark reminder as attempted to avoid spamming on retry
      await supabase
        .from("campaign_wave_signups")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", s.id);
    }
  }
  return out;
}
