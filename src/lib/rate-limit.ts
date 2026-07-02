import { headers } from "next/headers";
import { createClient } from "./supabase/server";
import { createServiceRoleClient } from "./supabase/service-role";

/**
 * Best-effort client IP from forward headers.
 * In dev (no proxy) returns "unknown" — fine, all dev users share one bucket.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().slice(0, 64);
  const real = h.get("x-real-ip");
  if (real) return real.slice(0, 64);
  return "unknown";
}

/**
 * Returns true if allowed, false if over the limit.
 * Backed by Postgres `check_rate_limit` RPC (atomic).
 *
 * Fail-open on error: if the DB is unreachable we don't lock everyone out.
 * The Postgres function rejects pathological inputs (huge counts, long keys).
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key.slice(0, 256),
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error("[rate-limit] error:", error.message);
      return true; // fail open
    }
    return data === true;
  } catch (e) {
    console.error("[rate-limit] exception:", e);
    return true; // fail open
  }
}

/**
 * Best-effort REFUND of reserved rate-limit units after a reserved action
 * failed (e.g. a campaign send that threw, or an INSERT that errored). Decrements
 * the bucket's count, floored at 0.
 *
 * SECURITY: runs via the service-role client ONLY — never expose a decrement to
 * a user-callable RPC, or a user could reset their own `campaign:send:user:*`
 * bucket and bypass the daily cap. Callers must invoke this server-side on a
 * failure path, never from user-controlled input.
 */
export async function releaseRateLimit(key: string, n: number): Promise<void> {
  if (n <= 0) return;
  try {
    const sb = createServiceRoleClient();
    const k = key.slice(0, 256);
    const { data } = await sb.from("rate_limits").select("count").eq("key", k).maybeSingle();
    if (data && typeof data.count === "number") {
      await sb.from("rate_limits").update({ count: Math.max(0, data.count - n) }).eq("key", k);
    }
  } catch {
    /* best-effort — a leaked reservation self-heals when the window rolls over */
  }
}
