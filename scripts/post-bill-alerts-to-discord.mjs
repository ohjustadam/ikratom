#!/usr/bin/env node
/**
 * Posts recent critical/alert-severity bill action alerts to every
 * Discord integration that opted into 'bill_status_change' events.
 *
 * Decoupled from enrich-bill-journey so it fires on alerts spawned by:
 *   - The 0076 critical-action trigger (history-table writes)
 *   - Hourly OpenStates / LegiScan sync
 *   - News-triggered hot-resync
 *   - Manual admin edits
 *   - The classify-news-policy → policy_alert pipeline
 *
 * Idempotency: each policy_alert gets `discord_posted_at` set after
 * a successful post. Re-runs skip already-posted rows.
 *
 * Run hourly via .github/workflows/cron-hourly.yml.
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const APP_URL = process.env.APP_URL ?? "https://www.ikratom.org";

const COLORS = {
  red:     0xef4444,
  amber:   0xf59e0b,
  emerald: 0x10b981,
  zinc:    0x52525b,
};

function pickEmbed(alert, bill) {
  const isAnti = bill?.kratom_relevance === "anti";
  const isPro  = bill?.kratom_relevance === "pro";
  const headline = alert.title.slice(0, 250);

  let color = COLORS.zinc;
  let emoji = "📋";
  if (alert.severity === "critical") { color = COLORS.red;    emoji = "🚨"; }
  else if (alert.severity === "alert"){ color = COLORS.amber;  emoji = "⚠️"; }
  else if (alert.severity === "watch"){ color = COLORS.zinc;   emoji = "📋"; }
  if (isPro && alert.severity === "critical") { color = COLORS.emerald; emoji = "✅"; }

  return {
    title: `${emoji} ${headline}`,
    description: (alert.body ?? "").slice(0, 1800),
    url: bill ? `${APP_URL}/bills/${bill.id}` : alert.source_url ?? APP_URL,
    color,
    fields: [
      { name: "Severity", value: alert.severity, inline: true },
      ...(bill?.kratom_relevance ? [{ name: "Stance", value: bill.kratom_relevance, inline: true }] : []),
      ...(alert.locality ? [{ name: "Locality", value: alert.locality, inline: true }] : []),
    ],
    footer: { text: "iKratom · bill action alert" },
    timestamp: alert.created_at,
  };
}

async function findPendingAlerts() {
  // Critical/alert severity, kind=bill_event, approved, not yet posted,
  // and created in last 7 days. Dedup-key fingerprinted by migration
  // 0079 — only one approved row per key is possible at any moment.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("policy_alerts")
    .select("id, kind, severity, title, body, locality, source_url, bill_id, dedupe_key, created_at")
    .eq("kind", "bill_event")
    .in("severity", ["critical", "alert"])
    .eq("moderation_status", "approved")
    .is("discord_posted_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    console.error("query failed:", error.message);
    return [];
  }

  // Safety-net dedup at poster level. If two approved alerts somehow
  // landed with the same dedupe_key (race condition between trigger
  // and external insert), keep the earliest and mark the rest posted
  // so they don't re-fire. This is belt-and-suspenders — the unique
  // index already prevents this 99.9% of the time.
  const seen = new Map();
  const toMarkPosted = [];
  const unique = [];
  for (const a of data ?? []) {
    if (!a.dedupe_key) {
      unique.push(a);
      continue;
    }
    if (seen.has(a.dedupe_key)) {
      toMarkPosted.push(a.id);
    } else {
      seen.set(a.dedupe_key, a);
      unique.push(a);
    }
  }
  if (toMarkPosted.length > 0) {
    await sb.from("policy_alerts")
      .update({ discord_posted_at: new Date().toISOString() })
      .in("id", toMarkPosted);
    console.log(`  ⚠ poster-level dedup: ${toMarkPosted.length} duplicate(s) marked posted without firing`);
  }
  return unique;
}

async function getActiveIntegrations(forState) {
  // state_filter null = posts everywhere; otherwise must match
  const filter = forState ?? "FED";
  const { data } = await sb
    .from("discord_integrations")
    .select("id, webhook_url, server_name, events_enabled, state_filter, total_posts, total_failures")
    .eq("active", true)
    .or(`state_filter.is.null,state_filter.eq.${filter}`);
  return (data ?? []).filter(
    (r) => Array.isArray(r.events_enabled) && r.events_enabled.includes("bill_status_change"),
  );
}

async function postToWebhook(webhookUrl, embed) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed], username: "iKratom" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord ${res.status}: ${text.slice(0, 200)}`);
  }
}

// ---- main ----
const alerts = await findPendingAlerts();
console.log(`Found ${alerts.length} unposted bill action alert(s)`);
if (alerts.length === 0) {
  await logRun("empty", 0, "no pending alerts");
  process.exit(0);
}

let posted = 0, failed = 0;
for (const a of alerts) {
  // Load the bill for context
  let bill = null;
  if (a.bill_id) {
    const { data } = await sb.from("bills")
      .select("id, state, bill_number, title, kratom_relevance, status")
      .eq("id", a.bill_id).single();
    bill = data;
  }

  const integrations = await getActiveIntegrations(a.locality);
  if (integrations.length === 0) {
    console.log(`  ⏭  no Discord integrations for ${a.locality} — marking posted to skip retries`);
    await sb.from("policy_alerts")
      .update({ discord_posted_at: new Date().toISOString() })
      .eq("id", a.id);
    continue;
  }

  const embed = pickEmbed(a, bill);
  let ok = false;
  for (const integ of integrations) {
    try {
      await postToWebhook(integ.webhook_url, embed);
      console.log(`  ✓ ${a.severity.toUpperCase()} [${a.locality}] → ${integ.server_name}: ${a.title.slice(0, 60)}`);
      await sb.from("discord_integrations")
        .update({ total_posts: (integ.total_posts ?? 0) + 1, last_posted_at: new Date().toISOString(), consecutive_failures: 0 })
        .eq("id", integ.id);
      ok = true;
    } catch (e) {
      console.log(`  ✗ ${integ.server_name}: ${e.message?.slice(0, 100)}`);
      await sb.from("discord_integrations")
        .update({ total_failures: (integ.total_failures ?? 0) + 1, consecutive_failures: ((integ.consecutive_failures ?? 0) + 1) })
        .eq("id", integ.id);
    }
  }

  if (ok) {
    await sb.from("policy_alerts")
      .update({ discord_posted_at: new Date().toISOString() })
      .eq("id", a.id);
    posted++;
  } else {
    failed++;
  }
}

console.log(`\nDone. posted=${posted}, failed=${failed}`);
await logRun(failed > 0 ? "error" : "success", posted, `${posted} posted, ${failed} failed`);

async function logRun(status, count, notes) {
  try {
    await sb.from("scraper_runs").insert({
      source: "post_bill_alerts_to_discord",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status,
      rows_added: count,
      notes,
    });
  } catch { /* best-effort */ }
}
