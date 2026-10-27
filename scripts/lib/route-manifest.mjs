/**
 * route-manifest.mjs — scan the Next.js route tree (src/app/**\/page.tsx) and
 * describe every page route in plain data.
 *
 * Why this exists (B6 c): sitemap.ts kept a hand-written list of routes, which
 * drifts the moment someone adds a page. The serverless bundle has no src/app
 * at runtime, so the scan runs at dev time (`npm run docs:routes`) and writes
 * src/lib/route-manifest.generated.json; tests/sitemap-routes.test.ts fails
 * when that file no longer matches the tree.
 *
 * Pure filesystem. No network, no env.
 */
import fs from "node:fs";
import path from "node:path";

const PAGE_RE = /^page\.tsx?$/;

/** Strip // and block comments so a commented-out redirect() or <Tag> is ignored. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * @param {string} root repo root (the folder holding src/app)
 * @returns {Array<{
 *   route: string, dynamic: boolean, forceDynamic: boolean,
 *   revalidate: number | null, usesSearchParams: boolean,
 *   loginGated: boolean, redirectOnly: boolean,
 * }>}
 */
export function scanRoutes(root) {
  const appDir = path.join(root, "src", "app");
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (PAGE_RE.test(e.name)) files.push(p);
    }
  })(appDir);

  const rows = files.map((file) => {
    const rel = path.relative(appDir, path.dirname(file)).split(path.sep).filter(Boolean);
    // (group) segments do not appear in the URL; @slot / _private folders are not routes.
    const urlSegs = rel.filter((s) => !/^\(.*\)$/.test(s));
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const rev = /export const revalidate\s*=\s*(\d+)/.exec(src);
    return {
      route: "/" + urlSegs.join("/"),
      dynamic: urlSegs.some((s) => s.startsWith("[")) || urlSegs.some((s) => s.startsWith("@")),
      forceDynamic: /export const dynamic\s*=\s*["']force-dynamic["']/.test(src),
      revalidate: rev ? Number(rev[1]) : null,
      // Awaiting searchParams makes the render per-request whatever else is set.
      usesSearchParams: /searchParams/.test(src),
      loginGated: /redirect\(\s*[`"']\/(login|signup)/.test(src),
      redirectOnly: /\bredirect\(/.test(src) && !/<[A-Za-z]/.test(src),
    };
  });
  rows.sort((a, b) => a.route.localeCompare(b.route));
  return rows;
}
