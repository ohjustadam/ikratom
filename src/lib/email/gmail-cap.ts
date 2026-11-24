/**
 * Google's 100-person cap on the unverified Gmail app.
 *
 * WHY (2026-11-18): gmail.send is a sensitive scope. Until Google verifies the
 * app, only 100 different Google accounts can ever grant it, and person 101
 * lands on a Google error page with no way back to iKratom. We stop offering
 * "Connect Gmail" at 90 so nobody meets that page. Anyone who granted before
 * may reconnect, because Google counts people, not grants. Own-mailbox SMTP
 * and "open in your email app" have no cap and stay on offer.
 *
 * Set GMAIL_APP_VERIFIED=1 once Google approves the app (the owner's step).
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const GMAIL_UNVERIFIED_CAP = 100;
export const GMAIL_CONNECT_STOP_AT = 90;

/** Pure decision. An unknown count keeps today's behaviour (offer it). */
export function gmailConnectOpen(o: {
  verified: boolean;
  grantedBefore: boolean;
  grants: number | null;
}): boolean {
  if (o.verified || o.grantedBefore) return true;
  if (o.grants === null) return true;
  return o.grants < GMAIL_CONNECT_STOP_AT;
}

/**
 * Everyone who ever finished a Gmail grant. Disconnecting deletes the
 * email_integrations row, so the auth event log is the lifetime record; live
 * integrations are added in case an old event is missing.
 */
export async function gmailGrantedUserIds(): Promise<Set<string> | null> {
  try {
    const admin = createServiceRoleClient();
    const [events, live] = await Promise.all([
      admin.from("auth_events").select("user_id")
        .eq("kind", "gmail_connect").eq("status", "ok").not("user_id", "is", null).limit(1000),
      admin.from("email_integrations").select("user_id").eq("provider", "gmail").limit(1000),
    ]);
    if (events.error || live.error) return null;
    return new Set([...(events.data ?? []), ...(live.data ?? [])].map((r) => r.user_id as string));
  } catch {
    return null;
  }
}

export async function gmailConnectOpenFor(userId: string): Promise<boolean> {
  if (process.env.GMAIL_APP_VERIFIED === "1") return true;
  const ids = await gmailGrantedUserIds();
  return gmailConnectOpen({
    verified: false,
    grantedBefore: !!ids?.has(userId),
    grants: ids ? ids.size : null,
  });
}
