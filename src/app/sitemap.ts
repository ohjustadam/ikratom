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
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Dynamic surfaces: pull recent rows from each table. Caps keep
  // sitemap size sane while staying inside Google's 50,000 URL limit
  // by a huge margin.
  const supabase = await createClient();
  const dynamic: MetadataRoute.Sitemap = [];

  // Bills — active + tracked. Most-recently-updated first.
  try {
    const { data: bills } = await supabase
      .from("bills")
      .select("id, last_action_at, last_synced_at")
      .eq("active", true)
      .order("last_action_at", { ascending: false, nullsFirst: false })
      .limit(2000);
    for (const b of bills ?? []) {
      dynamic.push({
        url: `${base}/bills/${b.id}`,
        lastModified: b.last_action_at
          ? new Date(b.last_action_at)
          : b.last_synced_at
          ? new Date(b.last_synced_at)
          : undefined,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  } catch (e) {
    console.error("[sitemap] bills query failed:", e);
  }

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

  // Legislators — public-facing detail pages.
  try {
    const { data: legs } = await supabase
      .from("legislators")
      .select("id")
      .eq("active", true)
      .limit(2000);
    for (const l of legs ?? []) {
      dynamic.push({
        url: `${base}/legislators/${l.id}`,
        lastModified: now,
        changeFrequency: "monthly",
        priority: 0.4,
      });
    }
  } catch (e) {
    console.error("[sitemap] legislators query failed:", e);
  }

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
