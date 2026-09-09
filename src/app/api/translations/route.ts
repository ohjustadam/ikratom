import { NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/anon";
import { getTranslation, type TranslatedContentRef } from "@/lib/translations";

/**
 * /api/translations?type=…&id=…&lang=… — a cached translation, if one exists.
 *
 * WHY THIS EXISTS (2026-09-08). Pages rendered translated content by calling
 * readLocale() on the server, which reads a cookie — and a cookie read opts the
 * whole route out of caching. So every page carrying a TranslatedSection was
 * re-rendered against Supabase on every hit, including the overwhelming
 * majority from crawlers, who have no locale cookie and would have got the
 * English default anyway.
 *
 * Now the English source ships in the cached HTML (correct: it is the default,
 * and it is what crawlers should index) and non-English viewers fetch their
 * translation from here after hydration.
 *
 * PUBLICLY CACHEABLE, deliberately: a translation is the same for everyone who
 * asks for that (entity, language) pair. The anon client guarantees the
 * response is viewer-independent, which is what makes a shared `public` cache
 * header safe here — the same invariant /lib/supabase/anon.ts exists to
 * protect. That also means repeat requests are served by the CDN rather than
 * costing Supabase egress.
 */
export const runtime = "nodejs";

// Mirrors TranslatedContentRef["type"]. Typed as that union so a change to the
// source of truth breaks the build here instead of silently rejecting a valid
// entity type at runtime.
const ALLOWED_TYPES = new Set<TranslatedContentRef["type"]>([
  "bill_summary",
  "bill_callout",
  "story_body",
  "thread_title",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANG_RE = /^[a-z]{2}(-[A-Za-z]{2})?$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "";
  const id = searchParams.get("id") ?? "";
  const lang = searchParams.get("lang") ?? "";

  // Validate before touching the database — an unvalidated id turns this into
  // an open probe endpoint, and a crawler walking random uuids would each miss
  // the cache and cost a query.
  if (!ALLOWED_TYPES.has(type as TranslatedContentRef["type"]) || !UUID_RE.test(id) || !LANG_RE.test(lang) || lang === "en") {
    return NextResponse.json({ translated: null }, {
      status: 400,
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  try {
    const translated = await getTranslation(createAnonClient(), { type: type as TranslatedContentRef["type"], id }, lang);
    return NextResponse.json({ translated: translated ?? null }, {
      // Long shared cache: translations change only when the translate cron
      // rewrites them, and a stale one is a strictly better failure than an
      // uncached round trip per reader.
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch {
    return NextResponse.json({ translated: null }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
