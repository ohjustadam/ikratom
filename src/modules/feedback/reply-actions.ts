"use server";

import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email/router";
import { fanoutPushNotifications } from "@/modules/notifications/push-fanout";
import { siteConfig } from "@/config/site.config";
import {
  REPLY_KIND,
  REPLY_TAG,
  cleanReplyBody,
  deliveryLabel,
  replyEmail,
  replyNotification,
  replyRoute,
} from "./reply";

/**
 * An admin answers a feedback report from /admin/feedback (owner ask
 * 2026-11-10). Signed-in reporter → in-site notification, then the instant
 * push lane (their opt-outs and quiet hours still hold) and the email digest
 * if they get it. Anonymous reporter → one platform email, from the role
 * address with Reply-To support@, and only to an address they gave us.
 * Every reply is stored in feedback_replies with how it went out.
 */
const ID_RE = /^[0-9a-f-]{36}$/i;
const SITE_URL = "https://www.ikratom.org";

export async function replyToFeedback(input: {
  id: string;
  body: string;
  resolve?: boolean;
}): Promise<{ ok: true; delivered: boolean; label: string; detail: string | null } | { error: string }> {
  const ctx = await getAdminContext({ require: "moderate_feedback" });
  if (!ctx.ok) return { error: "Admins only." };
  if (!ID_RE.test(input.id ?? "")) return { error: "Invalid id." };
  const clean = cleanReplyBody(input.body);
  if ("error" in clean) return clean;
  const body = clean.body;

  if (!(await checkRateLimit(`feedback-reply:${ctx.userId}`, 20, 3600))) {
    return { error: "That's a lot of replies in an hour. Try again in a bit." };
  }

  const sr = createServiceRoleClient();
  const { data: report, error: rErr } = await sr
    .from("feedback_reports")
    .select("id,user_id,message,contact_email,created_at")
    .eq("id", input.id)
    .maybeSingle();
  if (rErr) return { error: rErr.message };
  if (!report) return { error: "That report no longer exists." };

  const route = replyRoute(report);
  if (route.channel === null) return { error: route.why };

  const { data: row, error: insErr } = await sr
    .from("feedback_replies")
    .insert({
      report_id: report.id,
      author_id: ctx.userId,
      body,
      channel: route.channel,
      sent_to: route.channel === "email" ? route.to : null,
      status: "pending",
    })
    .select("id")
    .single();
  if (insErr || !row) return { error: insErr?.message ?? "Couldn't save the reply." };

  let status: "sent" | "failed" = "failed";
  let detail: string | null = null;

  if (route.channel === "site") {
    const { error: nErr } = await sr
      .from("notifications")
      .insert({ user_id: route.userId, ...replyNotification(report.id, body) });
    if (nErr) {
      detail = "the notification wasn't saved";
    } else {
      status = "sent";
      detail = "in their notifications";
      try {
        const push = await fanoutPushNotifications(sr, {
          userIds: [route.userId],
          kinds: [REPLY_KIND],
          instant: true,
        });
        if ((push.sent ?? 0) > 0) detail = "in their notifications + push";
      } catch {
        // The inbox row is in; the regular sweep pushes it later if allowed.
      }
    }
  } else {
    const mail = replyEmail({
      reportMessage: report.message,
      reportDate: report.created_at,
      body,
      siteUrl: SITE_URL,
    });
    const sent = await sendEmail({
      to: route.to,
      subject: mail.subject,
      text: mail.text,
      replyTo: siteConfig.links.support,
      tag: REPLY_TAG,
    });
    if ("skipped" in sent) detail = sent.reason.replace(/_/g, " ");
    else if (sent.ok) {
      status = "sent";
      detail = `via ${sent.provider}`;
    } else detail = `${sent.tried.map((t) => t.provider).join(", ")} failed`.slice(0, 300);
  }

  await sr.from("feedback_replies").update({ status, detail }).eq("id", row.id);

  const resolved = status === "sent" && input.resolve === true;
  if (resolved) {
    await sr
      .from("feedback_reports")
      .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: ctx.userId })
      .eq("id", report.id);
  }

  await recordAdminAction({
    action: "feedback.reply",
    targetId: report.id,
    details: { channel: route.channel, status, resolved, length: body.length },
  });
  revalidatePath("/admin/feedback");
  return {
    ok: true,
    delivered: status === "sent",
    label: deliveryLabel({ channel: route.channel, status, detail }),
    detail,
  };
}
