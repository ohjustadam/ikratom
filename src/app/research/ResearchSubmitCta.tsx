"use client";

import Link from "next/link";
import { useChromeMe } from "@/components/chrome/ChromeProvider";

/**
 * "Add a paper" CTA on /research. Renders only for advocate leaders +
 * admins. Anonymous users see nothing (keeps the page calm).
 *
 * Client component on purpose (2026-10-03): as a server component it read the
 * auth cookie, which made /research viewer-dependent and impossible to cache
 * at the edge — and /research was hit 1,125 times in the Oct 3 distributed
 * crawl. The role now comes from the one /api/me fetch real browsers already
 * make (isLeader = leader, admin or owner).
 */
export function ResearchSubmitCta() {
  const { isLeader } = useChromeMe();
  if (!isLeader) return null;

  return (
    <Link
      href="/research/submit"
      className="mt-4 inline-flex items-center gap-2 rounded-md border border-emerald-700/40 bg-emerald-950/15 px-4 py-2 text-sm font-semibold text-emerald-300 hover:border-emerald-400"
    >
      🌿 Add a research paper →
    </Link>
  );
}
