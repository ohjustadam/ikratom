/**
 * backfill-news-state-from-alerts.mjs
 *
 * 662 of 14,565 news_items carry `state = NULL`, and 455 of those are linked to
 * a policy_alert — i.e. they are policy-relevant coverage that no state-scoped
 * query can see. Found 2026-08-20 while wiring the Massachusetts emergency: the
 * canonical "State Action on Kratom" story (the Shrewsbury Board of Health
 * notice quoting the DPH Schedule I order verbatim) never appeared in any MA
 * news listing because its state was null.
 *
 * The linked alert already knows the jurisdiction — policy_alerts.locality is a
 * 2-letter state code for state-scoped alerts. This copies that across.
 *
 * DELIBERATELY NARROW:
 *   - only rows where state IS NULL (never overwrites an existing value)
 *   - only rows with a linked alert (the alert is the evidence)
 *   - only when locality matches ^[A-Z]{2}$ — "ALL" (federal) and municipal
 *     localities are NOT states and must stay null rather than be invented
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-news-state-from-alerts.mjs
 *   node --env-file=.env.local scripts/backfill-news-state-from-alerts.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { revalidateTags } from "./lib/revalidate.mjs";

const APPLY = process.argv.includes("--apply");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const STATE_CODE = /^[A-Z]{2}$/;
const PAGE = 500;

async function main() {
  console.log(`\n== news state backfill — ${APPLY ? "APPLY" : "DRY RUN"} ==\n`);

  // Pull candidates in pages. PostgREST caps at 1000 rows per request, and a
  // skip-without-marking loop would re-read the same window forever — so page
  // by offset and stop when a page comes back short.
  let offset = 0;
  const byState = new Map();
  let scanned = 0;
  let skippedNonState = 0;

  for (;;) {
    const { data, error } = await sb
      .from("news_items")
      .select("id, title, policy_alert_id")
      .is("state", null)
      .not("policy_alert_id", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    const alertIds = [...new Set(data.map((n) => n.policy_alert_id))];
    // Chunk the lookup. A single `in.()` with 500 UUIDs is an ~18 KB query
    // string and the request dies with a bare "TypeError: fetch failed" —
    // no status, no PostgREST error, because it never reaches the server.
    // Same failure mode as putting a whole chamber's ids in a campaign URL.
    const locById = new Map();
    for (let i = 0; i < alertIds.length; i += 100) {
      const { data: alerts, error: aErr } = await sb
        .from("policy_alerts")
        .select("id, locality")
        .in("id", alertIds.slice(i, i + 100));
      if (aErr) throw aErr;
      for (const a of alerts ?? []) locById.set(a.id, a.locality);
    }

    for (const n of data) {
      scanned++;
      const loc = locById.get(n.policy_alert_id);
      if (!loc || !STATE_CODE.test(loc)) {
        skippedNonState++;
        continue;
      }
      if (!byState.has(loc)) byState.set(loc, []);
      byState.get(loc).push(n.id);
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const total = [...byState.values()].reduce((a, ids) => a + ids.length, 0);
  console.log(`scanned ${scanned} null-state alert-linked rows`);
  console.log(`  resolvable to a state: ${total}`);
  console.log(`  left null (federal/municipal locality): ${skippedNonState}\n`);

  for (const [state, ids] of [...byState.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${state}: ${ids.length}`);
    if (!APPLY) continue;
    // Chunk the id list — a 400-id `in.()` filter makes an enormous URL.
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await sb.from("news_items").update({ state }).in("id", chunk);
      if (error) throw error;
    }
  }

  if (APPLY && total > 0) {
    await revalidateTags(["news-detail", "state-hub", "state-index-stats"]);
    console.log(`\nBackfilled ${total} rows.`);
  } else if (!APPLY) {
    console.log("\nDRY RUN — nothing changed.");
  } else {
    console.log("\nNothing to backfill.");
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
