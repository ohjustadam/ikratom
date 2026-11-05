import { notFound } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";

/**
 * /pitch is owner-only (owner, 2026-11-03): business planning, not for admins
 * and never public. Everyone else gets the 404 page, so the pages' existence
 * isn't confirmed either.
 *
 * Every page calls this itself, first. A check in layout.tsx does NOT protect
 * a page: Next renders the layout and the page separately, so #1111's layout
 * check showed visitors a 404 while the page's full text still went out in the
 * same response (found on the live site, 2026-11-05).
 *
 * Keep /pitch out of every Cloudflare cache rule: a cached owner render would
 * be served to the next visitor.
 */
export async function requireOwner(): Promise<void> {
  const ctx = await getAdminContext();
  if (!ctx.ok || !ctx.isOwner) notFound();
}
