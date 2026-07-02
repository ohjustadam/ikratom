/**
 * Safe serializer for JSON-LD embedded in a <script type="application/ld+json">
 * block via dangerouslySetInnerHTML.
 *
 * Plain JSON.stringify does NOT escape `<`, so any DB / scraped / user free-text
 * value containing the literal `</script>` closes the script element early and
 * the trailing bytes are parsed as live HTML — a stored-XSS breakout (e.g. a
 * scraped news title `x</script><img src=y onerror=...>`). Escaping every `<`
 * to its `<` JSON unicode escape keeps the payload byte-for-byte valid
 * JSON (crawlers decode it identically) while making it impossible to close the
 * script tag or open any new HTML tag — `<` is required for both.
 */
export function jsonLdSafe(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}
