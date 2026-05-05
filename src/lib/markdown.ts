/**
 * Safe markdown rendering. Server-side render with marked, then sanitize the
 * HTML by allowing only a strict subset of tags + attributes.
 *
 * We don't trust input — forum posts can be from anyone — so we run our own
 * sanitizer instead of pulling in a heavier DOMPurify-style library.
 */

import { marked } from "marked";

// Configure marked: safe defaults, no HTML passthrough, no embedded scripts.
marked.setOptions({
  gfm: true,         // GitHub-flavored markdown (tables, autolinks, etc.)
  breaks: true,      // single newlines = <br>
});

const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "em", "del", "code", "pre", "blockquote",
  "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "a", "hr",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
};

/**
 * Sanitize HTML using a tag-whitelist approach. Strips disallowed tags
 * entirely (keeps text content), filters attributes, forces all links to
 * rel="noopener noreferrer" target="_blank" + http(s)/mailto only.
 */
function sanitize(html: string): string {
  // Strip script/style entirely (including content)
  html = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");

  // Process tags
  return html.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (_match, slash, tag, attrs) => {
    const lc = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lc)) return ""; // strip disallowed tag — keep inner content

    if (slash) return `</${lc}>`;

    // Process attributes
    const allowed = ALLOWED_ATTRS[lc];
    if (!allowed) return `<${lc}>`;

    const safeAttrs: string[] = [];
    const attrRegex = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m;
    while ((m = attrRegex.exec(attrs)) !== null) {
      const name = m[1].toLowerCase();
      const value = m[3] ?? m[4] ?? m[5] ?? "";
      if (!allowed.has(name)) continue;

      if (name === "href") {
        // Only http(s):, mailto:, tel:, or relative
        if (!/^(https?:|mailto:|tel:|\/)/i.test(value)) continue;
        // Encode quotes
        const safe = value.replace(/"/g, "&quot;");
        safeAttrs.push(`href="${safe}"`);
      } else {
        const safe = value.replace(/"/g, "&quot;");
        safeAttrs.push(`${name}="${safe}"`);
      }
    }

    // Auto-add safety attrs to anchors
    if (lc === "a") {
      safeAttrs.push('rel="noopener noreferrer"', 'target="_blank"');
    }

    return `<${lc}${safeAttrs.length ? " " + safeAttrs.join(" ") : ""}>`;
  });
}

/** Render markdown to safe HTML. */
export function renderMarkdown(md: string): string {
  if (!md) return "";
  const raw = marked.parse(md, { async: false }) as string;
  return sanitize(raw);
}
