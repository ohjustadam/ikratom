import Link from "next/link";
import { getCachedAuthProfile } from "@/lib/supabase/server";

/**
 * "Add a paper" CTA on /research. Renders only for advocate leaders +
 * admins. Anonymous users see nothing (keeps the page calm).
 */
export async function ResearchSubmitCta() {
  // Reuses the chrome's single cached auth+profile read — no extra auth
  // round-trip, no extra profiles select.
  const { profile } = await getCachedAuthProfile();
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
