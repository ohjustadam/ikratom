import { headers } from "next/headers";
import { createClient } from "./supabase/server";

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
