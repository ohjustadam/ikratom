/**
 * revalidate.mjs — let standalone node scripts flush Next's cache tags.
 *
 * The pipeline runs OUTSIDE the Next runtime, so `revalidateTag` is not
 * importable here. This posts to /api/revalidate, which does have it.
 *
 * Context: as of 2026-08-20 sixteen surfaces declared unstable_cache tags and
 * NOTHING ever invalidated them, so every content change waited out its TTL.
 * A news article linked to the MA emergency alert took ten minutes to appear
 * because /alerts/[id] caches for 600s.
 *
 * Best-effort by design: a failed flush must never fail the sync that called
 * it. The worst case without this is the old behaviour — content appears when
 * the TTL lapses.
 */

/**
 * @param {string[]} tags  Tags to flush (must be allowlisted server-side).
 * @param {{ appUrl?: string, secret?: string, quiet?: boolean }} [opts]
 * @returns {Promise<boolean>} true when the endpoint confirmed a flush.
 */
export async function revalidateTags(tags, opts = {}) {
  const list = (Array.isArray(tags) ? tags : [tags]).filter(Boolean);
  if (list.length === 0) return false;

  const appUrl = opts.appUrl ?? process.env.APP_URL ?? "https://www.ikratom.org";
  const secret = opts.secret ?? process.env.CRON_SECRET;
  if (!secret) {
    if (!opts.quiet) console.log("  ↻ revalidate skipped (no CRON_SECRET)");
    return false;
  }

  const qs = list.map((t) => `tag=${encodeURIComponent(t)}`).join("&");
  try {
    const res = await fetch(`${appUrl}/api/revalidate?${qs}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        // Browser-shaped UA: Cloudflare Bot Fight Mode challenges datacenter
        // IPs on the www host, and it matches on the UA PREFIX — the honest
        // identifier goes last. Same shape as check-vercel-usage.mjs:167.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 iKratom-Cron/1.0 (+https://www.ikratom.org)",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if (!opts.quiet) console.log(`  ↻ revalidate ${res.status} for ${list.join(", ")}`);
      return false;
    }
    if (!opts.quiet) console.log(`  ↻ revalidated: ${list.join(", ")}`);
    return true;
  } catch (e) {
    if (!opts.quiet) console.log(`  ↻ revalidate failed (non-fatal): ${e.message?.slice(0, 80)}`);
    return false;
  }
}
