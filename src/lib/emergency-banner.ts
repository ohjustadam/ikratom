import { unstable_cache } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * Cookieless, cached read of the site-wide emergency banner.
 *
 * WHY THIS EXISTS (2026-07-22): `getEmergencyConfig()` in
 * `modules/admin/emergency-actions.ts` builds a COOKIE-bound Supabase client.
 * `EmergencyBanner` renders in the ROOT layout, so that one cookie read opted
 * **every route in the app** out of static generation — every request, incl.
 * every crawler hit, executed a server render. That is a direct contributor to
 * the Fluid-CPU overage that took the site down (see memory
 * `root-layout-forces-whole-app-dynamic`).
 *
 * The banner is by definition PUBLIC — it renders identically for anonymous
 * visitors — so it has no business reading a session cookie. This reads the
 * same row without cookies, through `unstable_cache`, so one DB trip per
 * revalidate window serves every visitor.
 *
 * Service-role is used because it needs no cookies; the select is therefore
 * restricted to the display-only columns. `read_only_mode` / `read_only_reason`
 * are deliberately NOT selected here — those are operational flags consumed by
 * mutation guards, not banner text, and must keep using the request-bound
 * admin path in `emergency-actions.ts`.
 *
 * Admin toggles land INSTANTLY: updateEmergencyConfig() calls
 * updateTag("emergency-banner"). The TTL below is only the fallback for an
 * edit made outside that action (e.g. raw SQL in /admin/console).
 *
 * Why the TTL is not short (2026-10-04): this banner renders in the ROOT
 * layout, and Next gives a page the shortest revalidate of everything in its
 * tree. At 60 s, EVERY static page in the build table read "Revalidate 1m"
 * (47 of 47 layout pages; only robots.txt, outside the layout, read 1h), so
 * /calendar regenerated up to 60x an hour instead of 4x. 15 minutes matches
 * the pages' own windows.
 */

const REVALIDATE_SECONDS = 900;

export type PublicEmergencyBanner = {
  emergencyMode: boolean;
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  severity: "info" | "urgent" | "critical";
};

const EMPTY: PublicEmergencyBanner = {
  emergencyMode: false,
  title: null,
  body: null,
  ctaLabel: null,
  ctaHref: null,
  severity: "urgent",
};

export const getPublicEmergencyBanner = unstable_cache(
  async (): Promise<PublicEmergencyBanner> => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    // Fail SOFT and hidden: a missing key must never crash every page in the
    // app, and a banner that fails closed is the safe direction.
    if (!url || !key) return EMPTY;

    try {
      const sb = createServiceClient(url, key, { auth: { persistSession: false } });
      const { data } = await sb
        .from("site_config")
        .select(
          "emergency_mode, emergency_title, emergency_body, emergency_cta_label, emergency_cta_href, emergency_severity"
        )
        .eq("id", true)
        .maybeSingle();

      const row = data as {
        emergency_mode: boolean | null;
        emergency_title: string | null;
        emergency_body: string | null;
        emergency_cta_label: string | null;
        emergency_cta_href: string | null;
        emergency_severity: "info" | "urgent" | "critical" | null;
      } | null;

      if (!row) return EMPTY;
      return {
        emergencyMode: !!row.emergency_mode,
        title: row.emergency_title,
        body: row.emergency_body,
        ctaLabel: row.emergency_cta_label,
        ctaHref: row.emergency_cta_href,
        severity: row.emergency_severity ?? "urgent",
      };
    } catch {
      return EMPTY;
    }
  },
  ["public-emergency-banner"],
  { revalidate: REVALIDATE_SECONDS, tags: ["emergency-banner"] }
);
