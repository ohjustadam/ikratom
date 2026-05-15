import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * "Add a paper" CTA on /research. Renders only for advocate leaders +
 * admins. Anonymous users see nothing (keeps the page calm).
 */
export async function ResearchSubmitCta() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: profile } = await sb
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .maybeSingle();
  const isPrivileged = !!(profile?.is_admin || profile?.is_owner || profile?.is_advocate_leader);
  if (!isPrivileged) return null;

  return (
    <Link
      href="/research/submit"
      className="mt-4 inline-flex items-center gap-2 rounded-md border border-emerald-700/40 bg-emerald-950/15 px-4 py-2 text-sm font-semibold text-emerald-300 hover:border-emerald-400"
    >
      🌿 Add a research paper →
    </Link>
  );
}
