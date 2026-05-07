/**
 * Web Push sender — wraps the `web-push` library with our env config.
 *
 * No-ops gracefully when VAPID env vars aren't set, so dev/CI without
 * VAPID configured doesn't break notification creation flows.
 *
 * On 404/410 from the push provider (subscription expired/unsubscribed)
 * we surface { gone: true } so the caller can prune dead rows from
 * `push_subscriptions`.
 */

// Lazy-import so missing VAPID env doesn't crash unrelated code paths.
type WebPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushPayload = {
  title: string;
  body?: string;
  link?: string;
  tag?: string;
};

export type PushSendResult =
  | { ok: true }
  | { ok: false; gone: true; statusCode: number }
  | { ok: false; gone: false; error: string; statusCode?: number };

let configured: boolean | null = null;

function configureOnce() {
  if (configured !== null) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:noreply@ikratom.org";
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webpush = require("web-push");
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export function isPushConfigured(): boolean {
  return configureOnce();
}

export async function sendPush(
  sub: WebPushSubscription,
  payload: PushPayload,
): Promise<PushSendResult> {
  if (!configureOnce()) {
    return { ok: false, gone: false, error: "VAPID not configured" };
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webpush = require("web-push");
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), {
      TTL: 60 * 60 * 24, // drop after 24h if undelivered
    });
    return { ok: true };
  } catch (e) {
    const err = e as { statusCode?: number; body?: string; message?: string };
    const status = err.statusCode ?? 0;
    if (status === 404 || status === 410) {
      return { ok: false, gone: true, statusCode: status };
    }
    return {
      ok: false,
      gone: false,
      error: err.message || err.body || "send failed",
      statusCode: status || undefined,
    };
  }
}
