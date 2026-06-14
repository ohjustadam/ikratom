#!/usr/bin/env node
/**
 * feed-news-from-alerts.mjs — "if it's not in /news, create it."
 *
 * Most policy_alerts are BORN from a news_item (classify-news-policy.mjs sets
 * news_items.policy_alert_id), so they already appear in /news. But some alerts
 * arrive from other paths (the bill_actions trigger, BoP scrapes, an admin
 * pasting a story) and carry a source_url that never became a /news entry. When
 * that source is a real NEWS article, this feeder seeds a news_items row from it
 * and links it back (news_items.policy_alert_id = alert.id), so every newsworthy
 * alert is readable in-app. The nightly resolve→extract→summarize pipeline then
 * enriches the seeded row (excerpt, media, AI summary) on its next pass.
 *
 * NOT seeded: alerts whose source is a legislative / government / bill-tracker /
 * advocacy-org page (openstates.org, *.gov, legislature/capitol/leginfo hosts,
 * protectkratom.org, …). Those aren't news articles — they're already
 * represented by the bill page + the alert itself, and would extract to an empty
 * /news page. We also skip Google-News redirects (not a clean publisher URL).
 *
 * If a news_item with the same publisher URL already exists but isn't linked, we
 * LINK it instead of inserting a duplicate (news_items.url is unique).
 *
 * READ-ONLY by default (dry-run). Pass --apply to write (owner-gated prod write).
 *   node --env-file=.env.local scripts/feed-news-from-alerts.mjs            # dry-run
 *   node --env-file=.env.local scripts/feed-news-from-alerts.mjs --apply    # write
 *   node --env-file=.env.local scripts/feed-news-from-alerts.mjs --apply --limit 50
 */
import { createClient } from "@supabase/supabase-js";
import { cleanSourceUrl } from "./lib/source-url.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes("--apply");
const LIMIT = parseInt(arg("--limit") ?? "500", 10);
const PAGE = 1000;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Hosts that are NOT news outlets — legislative/gov portals, bill trackers,
// advocacy orgs. A clean publisher URL on any other host is treated as news.
const NON_NEWS_HOST =
  /(\.gov$|\.gov\.|^openstates\.org$|legiscan\.com$|fastdemocracy\.com$|billtrack50\.com$|protectkratom\.org$|legislature|capitol|leginfo|congress\.gov|govtrack)/i;

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
const isNewsHost = (host) => !!host && !NON_NEWS_HOST.test(host);

async function fetchApprovedAlertsWithSource() {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("policy_alerts")
      .select("id, kind, locality, source_url, title, occurs_at, created_at")
      .eq("moderation_status", "approved")
      .not("source_url", "is", null)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) { console.error("alert query failed:", error.message); process.exit(1); }
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

async function fetchLinkedAlertIds() {
  const linked = new Set();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("news_items")
      .select("policy_alert_id")
      .not("policy_alert_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) { console.error("news link query failed:", error.message); process.exit(1); }
    (data ?? []).forEach((n) => linked.add(n.policy_alert_id));
    if (!data || data.length < PAGE) break;
  }
  return linked;
}

async function main() {
  console.log(`\n${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — seeding /news entries from newsworthy unlinked alerts\n`);

  const [alerts, linked] = await Promise.all([fetchApprovedAlertsWithSource(), fetchLinkedAlertIds()]);
  const unlinked = alerts.filter((a) => !linked.has(a.id));
  console.log(`${alerts.length} approved alerts w/ source_url · ${alerts.length - unlinked.length} already in /news · ${unlinked.length} unlinked\n`);

  let seeded = 0, relinked = 0, skipGoogle = 0, skipPortal = 0, errors = 0, shown = 0;

  for (const a of unlinked) {
    if (seeded + relinked >= LIMIT) break;
    const clean = cleanSourceUrl(a.source_url);
    if (!clean) { skipGoogle++; continue; }                 // google redirect / non-http
    const host = hostOf(clean);
    if (!isNewsHost(host)) { skipPortal++; continue; }       // gov/legislative/tracker/advocacy

    // Already in /news under this URL? Link it instead of duplicating.
    const { data: existing } = await sb.from("news_items")
      .select("id, policy_alert_id").eq("url", clean).maybeSingle();

    if (existing) {
      if (!existing.policy_alert_id) {
        relinked++;
        if (shown++ < 25) console.log(`  ↪ link existing /news ${existing.id.slice(0, 8)} → alert ${a.id.slice(0, 8)} (${host})`);
        if (APPLY) {
          const { error } = await sb.from("news_items").update({ policy_alert_id: a.id }).eq("id", existing.id);
          if (error) { errors++; console.log(`     ✗ link failed: ${error.message}`); }
        }
      }
      continue;
    }

    seeded++;
    if (shown++ < 25) console.log(`  + seed /news ← [${a.kind}] ${host} — "${(a.title ?? "").slice(0, 56)}"`);
    if (APPLY) {
      const row = {
        state: /^[A-Z]{2}$/.test(a.locality ?? "") ? a.locality : null,
        title: (a.title ?? "").slice(0, 300) || "(untitled)",
        url: clean.slice(0, 1000),
        resolved_url: clean.slice(0, 1000),     // already a clean publisher URL — resolve step is done
        source_name: (host ?? "").slice(0, 100),
        published_at: a.created_at,
        summary: null,                          // nightly summarize-news fills
        kratom_topic: null,
        ai_relevance_score: 0.7,                // came from an approved policy alert
        body_has_kratom_keyword: true,          // it IS a kratom policy alert → passes the FP gate
        policy_classified_at: new Date().toISOString(), // already classified (the alert is the classification)
        policy_alert_id: a.id,
        active: true,
        scraped_at: new Date().toISOString(),
      };
      const { error } = await sb.from("news_items").insert(row);
      if (error) {
        // url unique-violation = a row appeared between our check and insert; link it.
        if (error.code === "23505") {
          const { data: race } = await sb.from("news_items").select("id, policy_alert_id").eq("url", clean).maybeSingle();
          if (race && !race.policy_alert_id) await sb.from("news_items").update({ policy_alert_id: a.id }).eq("id", race.id);
          seeded--; relinked++;
        } else { errors++; console.log(`     ✗ insert failed: ${error.message?.slice(0, 80)}`); }
      }
    }
  }

  console.log(`\nSummary: ${unlinked.length} unlinked — ${seeded} would seed, ${relinked} link existing, ` +
    `${skipPortal} skipped (gov/portal/tracker), ${skipGoogle} skipped (no clean URL).`);
  if (APPLY) {
    console.log(`✓ Apply complete. ${seeded} seeded, ${relinked} relinked, ${errors} errors.`);
    try {
      await sb.from("scraper_runs").insert({
        source: "feed_news_from_alerts",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: errors > 0 ? "error" : (seeded + relinked) > 0 ? "success" : "empty",
        rows_added: seeded,
        rows_updated: relinked,
        notes: `${seeded} seeded, ${relinked} relinked, ${skipPortal} portal-skip, ${skipGoogle} url-skip, ${errors} err`,
      });
    } catch { /* best-effort */ }
  } else {
    console.log(`\nDry-run only. Re-run with --apply to write (owner-gated). Nightly extract+summarize enriches seeded rows.`);
  }
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
