"use client";

import { useEffect, useState } from "react";
import { useChromeMe } from "@/components/chrome/ChromeProvider";
import type { TranslatedContentRef } from "@/lib/translations";

/**
 * Renders text in the viewer's language, falling back to the English source.
 *
 * WHY CLIENT-SIDE (2026-09-08). The server version called readLocale(), which
 * reads a cookie — and a cookie read opts the entire route out of caching. One
 * translated paragraph was enough to keep a whole page re-rendering against
 * Supabase on every crawler hit, to pick a language for a visitor who has no
 * locale cookie and would have got English regardless.
 *
 * So English ships in the cached HTML. That is the right default twice over:
 * it is what the overwhelming majority of readers get, and it is what crawlers
 * should index. Non-English viewers fetch their translation after hydration
 * from /api/translations, which is publicly cacheable — a translation is
 * identical for everyone who asks for that (entity, language) pair, so repeats
 * are served by the CDN rather than costing Supabase egress.
 *
 * The English text is rendered IMMEDIATELY, never hidden behind a spinner:
 * a reader should never see an empty space where the content is, and if the
 * fetch fails they simply keep the English they already had.
 */
export function TranslatedText({
  type,
  id,
  sourceText,
  className,
}: {
  type: TranslatedContentRef["type"];
  id: string;
  sourceText: string;
  className?: string;
}) {
  const { locale } = useChromeMe();
  const [translated, setTranslated] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!locale || locale === "en") { setTranslated(null); setMissing(false); return; }
    let alive = true;
    const qs = new URLSearchParams({ type, id, lang: locale });
    fetch(`/api/translations?${qs}`)
      .then((r) => (r.ok ? r.json() : { translated: null }))
      .then((d: { translated: string | null }) => {
        if (!alive) return;
        setTranslated(d.translated);
        setMissing(!d.translated);
      })
      .catch(() => { if (alive) { setTranslated(null); setMissing(false); } });
    return () => { alive = false; };
  }, [type, id, locale]);

  const body = className ?? "mt-2 text-base text-zinc-200";

  if (translated) {
    return (
      <div>
        <p className={body}>{translated}</p>
        <details className="mt-2 text-xs text-zinc-500">
          <summary className="cursor-pointer">Show original (English)</summary>
          <p className="mt-1">{sourceText}</p>
        </details>
      </div>
    );
  }

  if (missing) {
    return (
      <div>
        <p className={body}>{sourceText}</p>
        <p className="mt-1 text-[10px] text-zinc-600">
          (No translation available yet — admin: run <code className="rounded bg-zinc-950 px-1">npm run translate:content</code>.)
        </p>
      </div>
    );
  }

  return <p className={body}>{sourceText}</p>;
}
