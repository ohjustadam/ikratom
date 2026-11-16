// A browser-shaped User-Agent for our own scripts that call www.ikratom.org
// through Cloudflare.
//
// Bot Fight Mode challenges honest bot UAs, so these calls look like Chrome,
// with the honest identifier last. The Chrome version must be CURRENT. Since
// 2026-11-16 a WAF rule challenges Chrome/5x-12x and Firefox/11x-12x. The old
// hard-coded "Chrome/120.0" made the post-deploy smoke check fail with 403 on a
// healthy site, and it blocked every cache refresh the sync jobs requested.
//
// Chrome ships every 4 weeks, and 131 shipped on 2024-11-12. The version is
// worked out from the date, so it never goes stale.
export function chromeMajor(now = Date.now()) {
  return 131 + Math.floor((now - Date.UTC(2024, 10, 12)) / (28 * 864e5));
}

export function browserUA(id = "iKratom-Cron/1.0 (+https://www.ikratom.org)", now = Date.now()) {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor(now)}.0.0.0 Safari/537.36 ${id}`;
}
