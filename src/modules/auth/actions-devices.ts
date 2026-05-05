"use server";

import { createHash } from "crypto";
import { headers } from "next/headers";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getClientIp } from "@/lib/rate-limit";

/**
 * Login-device tracking.
 *
 * Called from the signIn action right after a successful password
 * verification. Computes a fingerprint hash from (UA + IP) and upserts
 * into login_devices. If this is the first sighting of this fingerprint
 * for this user, we insert a 'new_device' notification.
 *
 * Email alerts will follow once a transactional email provider is wired
 * (currently we only have Gmail OAuth which sends from the user's own
 * mailbox). The in-app notification appears immediately on /notifications.
 *
 * Why service role: the user's Supabase session may not be fully attached
 * to the cookie at the moment we call this from signIn (the session is
 * being established). Service role bypasses RLS for the write.
 */

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function fingerprint(ua: string, ip: string): string {
  // Trim UA to first 120 chars (defangs novelty UA bombs) and lowercase.
  // IP is used raw; mobile carriers rotate IPs so this fingerprint is
  // best-effort, not absolute.
  const norm = ua.slice(0, 120).toLowerCase() + "|" + ip;
  return createHash("sha256").update(norm).digest("hex");
}

export type RecordSignInResult = {
  isNewDevice: boolean;
};

export async function recordSignIn(userId: string): Promise<RecordSignInResult> {
  if (!userId) return { isNewDevice: false };

  const h = await headers();
  const ua = h.get("user-agent") ?? "";
  const ip = await getClientIp();

  const fpHash = fingerprint(ua, ip || "unknown");
  const admin = service();

  // Look up existing row
  const { data: existing } = await admin
    .from("login_devices")
    .select("id, sign_in_count")
    .eq("user_id", userId)
    .eq("fingerprint_hash", fpHash)
    .maybeSingle();

  const now = new Date().toISOString();

  if (existing) {
    // Known device — bump
    await admin
      .from("login_devices")
      .update({
        last_seen_at: now,
        sign_in_count: (existing.sign_in_count ?? 0) + 1,
        // Refresh in case IP rotated
        ip,
        user_agent: ua.slice(0, 500),
      })
      .eq("id", existing.id);
    return { isNewDevice: false };
  }

  // First time we've seen this fingerprint for this user
  await admin.from("login_devices").insert({
    user_id: userId,
    fingerprint_hash: fpHash,
    ip,
    user_agent: ua.slice(0, 500),
    first_seen_at: now,
    last_seen_at: now,
    sign_in_count: 1,
  });

  // But only NOTIFY if the user has prior devices on file. The very first
  // sign-in for a brand-new account shouldn't trigger a "new device" alert
  // since every device is by definition new at that point.
  const { count } = await admin
    .from("login_devices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if ((count ?? 0) > 1) {
    const browser = describeBrowser(ua);
    await admin.from("notifications").insert({
      user_id: userId,
      kind: "new_device",
      title: "New device signed in to your account",
      body: `${browser} from ${ip || "unknown IP"}. If this wasn't you, change your password immediately and sign out other devices at /account/security.`,
      link: "/account/security",
    });
  }

  return { isNewDevice: (count ?? 0) > 1 };
}

function describeBrowser(ua: string): string {
  const lc = ua.toLowerCase();
  let browser = "A browser";
  if (lc.includes("firefox")) browser = "Firefox";
  else if (lc.includes("edg/")) browser = "Edge";
  else if (lc.includes("chrome")) browser = "Chrome";
  else if (lc.includes("safari")) browser = "Safari";
  let os = "an unknown OS";
  if (lc.includes("windows")) os = "Windows";
  else if (lc.includes("mac os") || lc.includes("macintosh")) os = "macOS";
  else if (lc.includes("iphone")) os = "iPhone";
  else if (lc.includes("ipad")) os = "iPad";
  else if (lc.includes("android")) os = "Android";
  else if (lc.includes("linux")) os = "Linux";
  return `${browser} on ${os}`;
}
