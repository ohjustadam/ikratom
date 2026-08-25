/**
 * Frontmatter value coercion for our file-driven content
 * (src/content/briefings/*.md, src/content/patch-notes/*.md).
 *
 * gray-matter runs js-yaml with the default schema, so an UNQUOTED YAML
 * date — `published: 2026-05-08` — parses to a JS Date, not a string.
 * Two things go wrong when that Date reaches JSX:
 *   1. `String(date)` prints "Fri May 08 2026 19:00:00 GMT-0500 (...)"
 *      instead of "2026-05-08"
 *   2. rendering the raw Date object triggers React error #31
 * Quoting the date in the .md file dodges it, but that's a trap for
 * whoever writes the next briefing. Coerce at the boundary instead.
 *
 * Timezone note: `.toISOString().slice(0, 10)` is safe HERE and only
 * here. YAML parses a date-only scalar to UTC midnight, so slicing the
 * UTC date back off is lossless — there is no meaningful time component
 * to shift. Do NOT reuse this on a real timestamp: user-facing dates
 * anchor to America/New_York (see src/app/brief/page.tsx), because
 * Vercel and GitHub Actions both run UTC and bare-UTC formatting rolls
 * a day ahead during a US evening.
 *
 * Test coverage: src/lib/__tests__/frontmatter.test.ts
 */
export function frontmatterString(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    // An unparseable date would make toISOString() throw and take the
    // whole page down — degrade to "no value" instead.
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  return String(v);
}
