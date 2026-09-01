import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import fs from "fs";
import path from "path";

export const revalidate = 3600; // rebuild hourly

/**
 * sitemap.xml — search engine discovery surface.
 *
 * Static landing pages always present. Dynamic content (bills,
 * briefings, library items) gets the recent N rows so we cap the
 * sitemap size while keeping fresh content indexed.
 *
 * Robots.txt already references /sitemap.xml via the host directive.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.APP_URL ?? "https://www.ikratom.org").replace(/\/+$/, "");
  const now = new Date();

  const STATIC: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1.0 },
    { url: `${base}/pulse`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/status`, lastModified: now, changeFrequency: "hourly", priority: 0.7 },
    { url: `${base}/campaigns`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/bills`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/bop-watch`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/legislators`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/states`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/deadlines`, lastModified: now, changeFrequency: "hourly", priority: 0.85 },
    // New 2026-05-14/15 surfaces — high search value because they answer
    // queries like "where is kratom banned" / "kratom takeback plan" /
    // "people fighting kratom bills" that currently rank competitors.
    { url: `${base}/banned`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/takeback`, lastModified: now, changeFrequency: "weekly", priority: 0.85 },
    { url: `${base}/people`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    // Intel hub + cluster-coordination surfaces. These are the "smart
    // brain" pages — searches for "kratom lobbying" / "coordinated
    // kratom bills" / "kratom donor network" land here.
    { url: `${base}/intel`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/intel/operations`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/intel/operations/network`, lastModified: now, changeFrequency: "daily", priority: 0.75 },
    { url: `${base}/intel/threat-matrix`, lastModified: now, changeFrequency: "daily", priority: 0.75 },
    { url: `${base}/intel/donations`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/intel/lobbying`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/intel/actors`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/intel/rulemaking`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/intel/cases`, lastModified: now, changeFrequency: "weekly", priority: 0.65 },
    { url: `${base}/intel/awards`, lastModified: now, changeFrequency: "weekly", priority: 0.65 },
    { url: `${base}/intel/votes`, lastModified: now, changeFrequency: "weekly", priority: 0.65 },
    // Recent surfaces (May 2026): brief + now (action surfaces),
    // coalitions (multi-advocate teams), support (donation page),
    // research (peer-reviewed library), stories (real-person bank).
    { url: `${base}/brief`, lastModified: now, changeFrequency: "hourly", priority: 0.7 },
    { url: `${base}/now`, lastModified: now, changeFrequency: "hourly", priority: 0.6 },
    { url: `${base}/coalitions`, lastModified: now, changeFrequency: "daily", priority: 0.55 },
    { url: `${base}/support`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${base}/research`, lastModified: now, changeFrequency: "daily", priority: 0.65 },
    { url: `${base}/stories`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    // 50 + DC per-state landing pages (high SEO value — search for "kratom Texas" etc.)
    ...["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
        "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
        "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
        "VT","VA","WA","WV","WI","WY",
       ].map((code) => ({
      url: `${base}/states/${code}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
    { url: `${base}/news`, lastModified: now, changeFrequency: "hourly", priority: 0.7 },
    { url: `${base}/library`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/briefings`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/forum`, lastModified: now, changeFrequency: "daily", priority: 0.5 },
    { url: `${base}/communities`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${base}/how-it-works`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/ethics`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Dynamic surfaces: pull recent rows from each table. Caps keep
  // sitemap size sane while staying inside Google's 50,000 URL limit
  // by a huge margin.
  const supabase = await createClient();
  const dynamic: MetadataRoute.Sitemap = [];
  // Bill detail pages are also withheld from the sitemap while the crawl-cost
  // freeze is in place (see src/app/robots.ts). TEMPORARY — restore together
  // with the robots entry after the 2026-09-19 reset.

  // Library items — active.
  try {
    const { data: library } = await supabase
      .from("library_items")
      .select("id, updated_at")
      .eq("active", true)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(500);
    for (const l of library ?? []) {
      dynamic.push({
        url: `${base}/library/${l.id}`,
        lastModified: l.updated_at ? new Date(l.updated_at) : undefined,
        changeFrequency: "monthly",
        priority: 0.5,
      });
    }
  } catch (e) {
    console.error("[sitemap] library query failed:", e);
  }

  // Legislator DETAIL pages are deliberately NOT advertised (2026-09-01).
  //
  // They were 1,001 of the 1,432 URLs here — 70% of the entire crawl surface —
  // and every crawl of one is a server render: an uncached DB read-set, a
  // billed Netlify request, billed compute, and billed bandwidth. With ~44
  // real users, measured traffic to them was 99.97% bots (Supabase edge logs:
  // 19,833 server-side reads/day from Netlify vs 11 from consumer ISPs).
  //
  // That was burning 3.9 credits/day with ZERO deploys and would have hit the
  // 300-credit cap on ~2026-09-09, ten days before the 09-19 reset — the same
  // disable that took the site down on 2026-07-30.
  //
  // The pages still work, are still linked in-app, and /legislators (the index)
  // is still indexed. We just stop inviting crawlers to sweep 1,001 of them.
  // REVISIT after the reset once these routes are CDN-cacheable (that needs the
  // signedIn signup-wall moved client-side, /api/me style) — then the crawl is
  // nearly free and this should come back.

  // Active campaigns by slug.
  try {
    const { data: camps } = await supabase
      .from("campaigns")
      .select("slug, updated_at")
      .eq("active", true)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(500);
    for (const c of camps ?? []) {
      if (!c.slug) continue;
      dynamic.push({
        url: `${base}/campaigns/${c.slug}`,
        lastModified: c.updated_at ? new Date(c.updated_at) : undefined,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  } catch (e) {
    console.error("[sitemap] campaigns query failed:", e);
  }

  // Briefings — read from src/content/briefings/*.md.
  try {
    const briefingsDir = path.join(process.cwd(), "src", "content", "briefings");
    if (fs.existsSync(briefingsDir)) {
      for (const file of fs.readdirSync(briefingsDir)) {
        if (!file.endsWith(".md")) continue;
        const slug = file.replace(/\.md$/, "");
        if (!/^[a-z0-9-]+$/.test(slug)) continue;
        const stat = fs.statSync(path.join(briefingsDir, file));
        dynamic.push({
          url: `${base}/briefings/${slug}`,
          lastModified: stat.mtime,
          changeFrequency: "monthly",
          priority: 0.6,
        });
      }
    }
  } catch (e) {
    console.error("[sitemap] briefings scan failed:", e);
  }

  return [...STATIC, ...dynamic];
}
