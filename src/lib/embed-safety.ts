/**
 * Embed-HTML safety validator.
 *
 * The library item form lets advocate-leaders paste an iframe embed
 * for video items (YouTube / Vimeo). Without validation, an embed
 * could contain `<script>` or a malicious iframe pointing at an
 * attacker-controlled site that uses postMessage or click-jacking to
 * abuse visitor sessions — a real XSS surface even with elevated-role
 * gating, since one compromised advocate-leader account could poison
 * every library item.
 *
 * Defense: accept ONLY single-iframe embeds pointing at a strict
 * allowlist of providers (YouTube + Vimeo). Strip everything else.
 *
 * Returns a sanitized embed string, or null if the input cannot be
 * validated. Caller should treat null as "reject this submission."
 */

const ALLOWED_IFRAME_SRC_RE =
  /^https:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com\/embed\/[\w-]+(?:\?[\w=&-]*)?|player\.vimeo\.com\/video\/\d+(?:\?[\w=&-]*)?)$/i;

const ALLOWED_IFRAME_ATTRS = new Set([
  "src",
  "title",
  "width",
  "height",
  "frameborder",
  "allow",
  "allowfullscreen",
  "loading",
  "referrerpolicy",
]);

/**
 * Validates that an embed_html string is a single `<iframe>` element
 * with a src from the allowed-provider list. Returns the canonical
 * sanitized form (single iframe, only safe attrs, hardcoded sandbox).
 */
export function sanitizeLibraryEmbedHtml(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 2000) return null;

  // Reject obvious script-injection attempts up front. Even if the
  // iframe regex below would catch these, fail-fast keeps the
  // codepath honest.
  if (/<script\b/i.test(trimmed)) return null;
  if (/javascript:/i.test(trimmed)) return null;
  if (/\bon[a-z]+\s*=/i.test(trimmed)) return null;

  // Must be a single iframe. Match the whole input — leading/trailing
  // whitespace already stripped. Allow self-closing or paired-end form.
  const iframeMatch = trimmed.match(/^<iframe\b([^>]*?)(?:\/>|>\s*<\/iframe>)$/i);
  if (!iframeMatch) return null;
  const attrs = iframeMatch[1];

  // Parse attributes one at a time. Anything not in the allowlist or
  // any "on*" event handler kills the embed.
  const collected: Record<string, string> = {};
  const attrRegex = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(attrs)) !== null) {
    const name = m[1].toLowerCase();
    if (name.startsWith("on")) return null; // never accept event handlers
    if (!ALLOWED_IFRAME_ATTRS.has(name)) continue; // silently drop unknown
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    collected[name] = value;
  }

  // Boolean-style attrs (e.g. `allowfullscreen`) without `=` — accept
  // if name is in allowlist.
  const boolRegex = /\b([a-zA-Z][a-zA-Z0-9-]*)(?!\s*=)/g;
  while ((m = boolRegex.exec(attrs)) !== null) {
    const name = m[1].toLowerCase();
    if (!ALLOWED_IFRAME_ATTRS.has(name)) continue;
    if (!(name in collected)) collected[name] = "";
  }

  // src is required and must match the allowlist.
  const src = collected.src;
  if (!src || !ALLOWED_IFRAME_SRC_RE.test(src)) return null;

  // Reconstruct a canonical iframe: only allowed attrs, with safety
  // additions we always inject (sandbox + referrerpolicy + loading).
  const parts: string[] = [`src="${escapeAttr(src)}"`];
  if (collected.title) parts.push(`title="${escapeAttr(collected.title.slice(0, 200))}"`);
  parts.push(`width="${parseDim(collected.width, 560)}"`);
  parts.push(`height="${parseDim(collected.height, 315)}"`);
  parts.push(`frameborder="0"`);
  parts.push(`allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"`);
  parts.push(`allowfullscreen`);
  parts.push(`loading="lazy"`);
  parts.push(`referrerpolicy="strict-origin-when-cross-origin"`);
  // Sandbox: deny scripts from same origin context, deny popups, etc.
  // The iframe's own page can still run scripts (YouTube needs them);
  // the sandbox limits what they can DO to our page.
  parts.push(`sandbox="allow-scripts allow-same-origin allow-presentation"`);

  return `<iframe ${parts.join(" ")}></iframe>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseDim(raw: string | undefined, dflt: number): number {
  if (!raw) return dflt;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 4000) return dflt;
  return n;
}
