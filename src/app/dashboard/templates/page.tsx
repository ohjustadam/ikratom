import { permanentRedirect } from "next/navigation";

/**
 * /dashboard/templates is the legacy URL. The page moved to
 * /account/templates so the link sits inside the /account/* tree
 * (per ROADMAP.md P2 #11). Keep a permanent redirect so old links,
 * PWA shortcuts, and bookmarks all land in the right place.
 */
export default function LegacyTemplatesRedirect() {
  permanentRedirect("/account/templates");
}
