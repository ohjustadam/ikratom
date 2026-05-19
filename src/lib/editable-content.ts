/**
 * Editable content helper — the in-site mini-CMS read path.
 *
 * Pages call `getContent(key, fallback)` to fetch admin-overrideable
 * copy. If the editable_content table has a row for the key, that
 * wins. Otherwise the fallback (code-defined) is returned.
 *
 * Critical design choice: code is source of truth for STRUCTURE,
 * DB is override layer for COPY. A new page MUST ship with a working
 * fallback. The DB row is purely an override — admins editing copy
 * never accidentally break a page by deleting a row.
 *
 * Caching: server-side Next.js cache via `unstable_cache` keyed by
 * the content key + a 60s TTL. So edits become visible within ~1
 * minute platform-wide without a deploy.
 *
 * Usage in a server component:
 *
 *   import { getContent } from "@/lib/editable-content";
 *
 *   export default async function SupportPage() {
 *     const intro = await getContent("support.intro",
 *       "iKratom is a free, nonpartisan platform...");
 *     return <p>{intro}</p>;
 *   }
 */

import { unstable_cache } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export type ContentFormat = "markdown" | "plain";

export type EditableContentRow = {
  key: string;
  content_md: string;
  format: ContentFormat;
  label: string | null;
  updated_at: string;
};

/**
 * Service-role client (read-only path). We use service-role rather
 * than the user-aware client because:
 *   1. Public RLS already allows the read, so no auth is needed
 *   2. Server-side cache means we want a single client instance shared
 *      across pages, not one bound to the requesting user's session
 *   3. Avoids cookie/session reads on every page render
 */
function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

const KEY_RE = /^[a-z][a-z0-9._-]{2,99}$/;

/**
 * Get a single editable-content value. Returns the admin-overridden
 * text if present, otherwise the fallback. Validates the key shape
 * before hitting the DB so bad keys fail fast (and at code-review
 * time, not runtime).
 *
 * Cached for 60s per key.
 */
export const getContent = unstable_cache(
  async function getContentImpl(key: string, fallback: string): Promise<string> {
    if (!KEY_RE.test(key)) {
      // Bad key shape — refuse silently in prod, throw in dev so the
      // dev catches it at code-review time.
      if (process.env.NODE_ENV !== "production") {
        throw new Error(`getContent: invalid key "${key}" (must match ${KEY_RE})`);
      }
      return fallback;
    }
    const sb = svc();
    if (!sb) return fallback;
    try {
      const { data } = await sb
        .from("editable_content")
        .select("content_md, published_at")
        .eq("key", key)
        .maybeSingle();
      if (!data) return fallback;
      const row = data as { content_md: string; published_at: string | null };
      // Honor published_at if set in the future.
      if (row.published_at && new Date(row.published_at).getTime() > Date.now()) {
        return fallback;
      }
      return row.content_md;
    } catch {
      return fallback;
    }
  },
  ["editable-content-get"],
  { revalidate: 60, tags: ["editable-content"] },
);

/**
 * Fetch every editable-content row at once. Used by the admin
 * /admin/content list view. Not cached — admin needs to see fresh
 * data immediately after a save.
 */
export async function listAllContent(): Promise<EditableContentRow[]> {
  const sb = svc();
  if (!sb) return [];
  const { data } = await sb
    .from("editable_content")
    .select("key, content_md, format, label, updated_at")
    .order("key", { ascending: true });
  return (data ?? []) as EditableContentRow[];
}

/**
 * Catalog of editable keys used by the platform. The admin /admin/content
 * page lists THIS catalog (not just rows that exist in the DB) so admins
 * see every slot they can override, even empty ones.
 *
 * Add to this list when wiring a new editable slot into a page.
 *
 * NOTE: The fallbacks here are NOT live copy — they're a "if the slot
 * is empty, here's what the page shows" preview. The actual fallback
 * passed to getContent() in each page file is the source of truth for
 * what visitors see when no override exists.
 */
export const CONTENT_CATALOG: Array<{
  key: string;
  label: string;
  description: string;
  format: ContentFormat;
  page: string;
}> = [
  {
    key: "support.intro",
    label: "Support page intro",
    description: "The lead paragraph on /support, right under the page title.",
    format: "markdown",
    page: "/support",
  },
  {
    key: "support.cta_banner",
    label: "Support page donation-CTA banner",
    description: "The big call-out box on /support telling visitors how to give. Update when the Open Collective link launches.",
    format: "markdown",
    page: "/support",
  },
  {
    key: "ethics.intro",
    label: "Ethics page intro",
    description: "First paragraph on /ethics.",
    format: "markdown",
    page: "/ethics",
  },
  {
    key: "how-it-works.intro",
    label: "How-it-works intro",
    description: "Lead text at the top of /how-it-works.",
    format: "markdown",
    page: "/how-it-works",
  },
  {
    key: "homepage.hero_tagline",
    label: "Homepage hero tagline",
    description: "The subtitle text under the main headline on /.",
    format: "plain",
    page: "/",
  },
  {
    key: "homepage.cta_banner",
    label: "Homepage CTA banner",
    description: "Optional banner text near the top of the homepage. Useful for time-sensitive announcements.",
    format: "markdown",
    page: "/",
  },
  {
    key: "global.announcement",
    label: "Global announcement bar",
    description: "Optional text shown sitewide above the header. Set empty to hide. Different from /admin/emergency (this is a softer announcement, not an alert banner).",
    format: "plain",
    page: "(every page)",
  },
];
