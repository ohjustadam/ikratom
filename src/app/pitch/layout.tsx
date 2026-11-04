import { notFound } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";

/**
 * /pitch is owner-only (owner, 2026-11-03): business planning, not for admins
 * and never public. Everyone else gets a 404, so the pages' existence isn't
 * confirmed either. Keep /pitch out of every Cloudflare cache rule: a cached
 * owner render would be served to the next visitor.
 */
export default async function PitchLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminContext();
  if (!ctx.ok || !ctx.isOwner) notFound();
  return children;
}
