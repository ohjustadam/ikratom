import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS — use ONLY in server-side
 * cron / route-handler / system contexts where there is no logged-in
 * user but you still need to read/write across tables.
 *
 * NEVER import this into a client component. The service role key is
 * a master key; exposure to the browser is a critical incident.
 *
 * Usage pattern:
 *   import { createServiceRoleClient } from "@/lib/supabase/service-role";
 *   const supabase = createServiceRoleClient();
 *   const { data } = await supabase.from("notifications").select("*");
 *
 * Throws on construction if env vars are missing — fail fast rather than
 * silently masquerading as an anon client.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(url, key, { auth: { persistSession: false } });
}
