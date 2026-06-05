"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email/router";

/**
 * Feedback / error-report widget server actions.
 *
 * submitFeedback() is the only user-facing entry point — it's called from
 * the floating FeedbackWidget on every page. Works signed-in OR anonymous:
 * the row is inserted via service-role so there's no client INSERT RLS to
 * satisfy, and the rate limit falls back to IP when there's no user.
 *
 * Delivery is two-channel: (1) GUARANTEED in-site admin notification
 * (notifications table, kind feedback_report — mirrors local_rep_request),
 * and (2) BEST-EFFORT email to OWNER_EMAIL via the free-tier transactional
 * router (Brevo/Mailjet first; silently skips if no provider configured).
 *
 * Screenshots: client sends only the MIME type; we mint a signed upload URL
 * and the client uploads the blob directly to the private bucket. That
 * sidesteps the server-action body-size limit and works for anonymous users.
 */

const BUCKET = "feedback-screenshots";
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function submitFeedback(input: {
  message: string;
  pageUrl?: string;
  userAgent?: string;
  screenshotMime?: string | null;
}): Promise<
  | { ok: true; signedUpload?: { path: string; token: string; bucket: string } }
  | { error: string }
> {
  const message = (input.message ?? "").trim();
  if (message.length < 1) return { error: "Please enter a message." };
  if (message.length > 5000) return { error: "Message is too long (5000 character max)." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Rate limit: 5 reports/hour per user, or per IP when anonymous.
  const ip = await getClientIp();
  if (!(await checkRateLimit(`feedback:${user?.id ?? ip}`, 5, 3600))) {
    return { error: "You've sent several reports recently — please try again in a bit." };
  }

  // Optional screenshot: validate MIME → known extension, build a path.
  let screenshotPath: string | null = null;
  const mime = input.screenshotMime ?? null;
  if (mime) {
    const ext = EXT_BY_MIME[mime];
    if (!ext) return { error: "Screenshot must be a PNG, JPEG, or WebP image." };
    screenshotPath = `${user?.id ?? "anon"}/${crypto.randomUUID()}.${ext}`;
  }

  const pageUrl = (input.pageUrl ?? "").slice(0, 1000) || null;
  const userAgent = (input.userAgent ?? "").slice(0, 500) || null;

  const sr = createServiceRoleClient();
  const { error } = await sr.from("feedback_reports").insert({
    user_id: user?.id ?? null,
    message,
    page_url: pageUrl,
    user_agent: userAgent,
    screenshot_path: screenshotPath,
    status: "open",
  });
  if (error) return { error: error.message };

  // (1) GUARANTEED: in-site admin notification (mirrors local_rep_request).
  try {
    const { data: admins } = await sr
      .from("profiles")
      .select("id")
      .or("is_admin.eq.true,is_owner.eq.true");
    const adminIds = (admins ?? []).map((a: { id: string }) => a.id);
    if (adminIds.length > 0) {
      const preview = message.length > 140 ? `${message.slice(0, 140)}…` : message;
      await sr.from("notifications").insert(
        adminIds.map((uid) => ({
          user_id: uid,
          kind: "feedback_report",
          title: "New feedback report",
          body: preview,
          link: "/admin/feedback",
        })),
      );
    }
  } catch {
    // non-fatal — the row is saved and visible at /admin/feedback regardless
  }

  // (2) BEST-EFFORT: email the owner. OWNER_EMAIL read from env (no PII in
  // repo). Router prefers free Brevo/Mailjet; no-ops if nothing configured.
  const ownerEmail = process.env.OWNER_EMAIL;
  if (ownerEmail) {
    try {
      await sendEmail({
        to: ownerEmail,
        subject: "iKratom — new feedback report",
        text:
          `New feedback${user ? "" : " (anonymous)"}:\n\n${message}\n\n` +
          `Page: ${pageUrl ?? "n/a"}\n` +
          `Review + screenshot: /admin/feedback`,
        tag: "feedback_report",
      });
    } catch {
      // non-fatal
    }
  }

  // Mint a signed upload URL so the client can upload the screenshot blob
  // directly (sidesteps server-action body limits; works for anon users).
  if (screenshotPath) {
    const { data: signed, error: upErr } = await sr.storage
      .from(BUCKET)
      .createSignedUploadUrl(screenshotPath);
    if (!upErr && signed) {
      return { ok: true, signedUpload: { path: signed.path, token: signed.token, bucket: BUCKET } };
    }
  }
  return { ok: true };
}

export type FeedbackRow = {
  id: string;
  user_id: string | null;
  message: string;
  page_url: string | null;
  user_agent: string | null;
  screenshot_path: string | null;
  screenshotUrl: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
};

export async function listFeedback(
  status: "open" | "resolved" | "all" = "open",
): Promise<{ ok: true; rows: FeedbackRow[] } | { error: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const supabase = await createClient();
  let q = supabase
    .from("feedback_reports")
    .select("id,user_id,message,page_url,user_agent,screenshot_path,status,created_at,resolved_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return { error: error.message };

  // Mint short-lived signed read URLs for screenshots (service-role).
  const sr = createServiceRoleClient();
  const rows: FeedbackRow[] = [];
  for (const r of (data ?? []) as Omit<FeedbackRow, "screenshotUrl">[]) {
    let screenshotUrl: string | null = null;
    if (r.screenshot_path) {
      const { data: signed } = await sr.storage
        .from(BUCKET)
        .createSignedUrl(r.screenshot_path, 3600);
      screenshotUrl = signed?.signedUrl ?? null;
    }
    rows.push({ ...r, screenshotUrl });
  }
  return { ok: true, rows };
}

export async function setFeedbackStatus(
  id: string,
  status: "open" | "resolved",
): Promise<{ ok: true } | { error: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid id." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("feedback_reports")
    .update({
      status,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
      resolved_by: status === "resolved" ? ctx.userId : null,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: `feedback.${status === "resolved" ? "resolve" : "reopen"}`,
    targetId: id,
    details: { status },
  });
  revalidatePath("/admin/feedback");
  return { ok: true };
}
