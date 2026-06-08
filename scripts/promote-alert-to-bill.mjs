#!/usr/bin/env node
/**
 * Convert a policy_alert of kind='bill_event' into a row in the bills
 * table when the alert references a city ordinance / county-level
 * action that doesn't exist as a state-legislative bill (and therefore
 * never gets synced via LegiScan or OpenStates).
 *
 * Result: the alert links to a real /bills/[id] page that supports the
 * full feature set — substance targeting, journey narrative (from
 * news context), full text view, etc. Members see the ordinance
 * alongside state legislation in /bills, with a "municipal" scope
 * badge.
 *
 * Run:
 *   node --env-file=.env.local scripts/promote-alert-to-bill.mjs <alert-id> --bill-number <X>
 *   node --env-file=.env.local scripts/promote-alert-to-bill.mjs --all-bill-events  (process every alert with kind=bill_event and bill_id=null)
 */
import { createClient } from "@supabase/supabase-js";
import { reconcileLocality } from "./lib/geo-resolver.mjs";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const SPECIFIC = args.find((a) => /^[0-9a-f-]{36}$/i.test(a)) ?? null;
const ALL = args.includes("--all-bill-events");
const BILL_NUMBER_OVERRIDE = arg("--bill-number");

if (!SPECIFIC && !ALL) {
  console.error("Usage: <alert-id> [--bill-number X]   OR   --all-bill-events");
  process.exit(1);
}

function deriveBillNumber(alert) {
  if (BILL_NUMBER_OVERRIDE) return BILL_NUMBER_OVERRIDE;
  // Try to pull a city + ordinance reference out of the title
  const cityMatch = alert.title?.match(/^([A-Z][A-Za-z .]+),\s*([A-Z]{2})/);
  const city = cityMatch?.[1]?.trim().replace(/\s+/g, "-") ?? "Local";
  const year = (alert.created_at ?? "").slice(0, 4) || new Date().getFullYear();
  return `${city}-Ord-${year}`.slice(0, 60);
}

function deriveTitle(alert) {
  // Prefer the alert title, but trim the locality prefix that some
  // alerts use ("Marshall, IL — city ordinance bans..." → "City
  // ordinance bans...").
  const t = alert.title ?? "";
  const m = t.match(/^[^—]+—\s*(.+)$/);
  return (m?.[1] ?? t).slice(0, 240);
}

function deriveStatus(alert) {
  // Heuristics from alert wording. Critical + future occurs_at = "introduced"
  // (vote upcoming); already-passed text = "enacted".
  const lower = (alert.title + " " + (alert.body ?? "")).toLowerCase();
  if (lower.includes("vote") || lower.includes("hearing") || lower.includes("first reading")) {
    return "introduced";
  }
  if (lower.includes("already in effect") || lower.includes("passed") || lower.includes("instituted")) {
    return "enacted";
  }
  return "introduced";
}

// Pull a candidate "City, ST" specific-locality out of the title. This is only
// STAMPED onto bills.locality when the gazetteer corroborates the state (see
// processAlert) — an uncorroborated guess would mislabel the bill, so we drop
// the specific locality and let the bill sit at plain state scope instead.
function deriveCityLocality(alert) {
  const m = alert.title?.match(/^([A-Z][A-Za-z .]+),\s*([A-Z]{2})/);
  if (m) return `${m[1].trim()}, ${m[2]}`;
  return null;
}

async function processAlert(alert) {
  console.log(`\n=== ${alert.id.slice(0, 8)} | ${alert.locality} | ${alert.title.slice(0, 60)} ===`);
  if (alert.bill_id) {
    console.log(`  ⏭  alert already linked to bill ${alert.bill_id}`);
    return false;
  }

  // Gazetteer-backed state resolution. The alert's stored locality is only a
  // guess (it could have been mislabeled upstream); the resolver corroborates
  // it against the alert title+body and NEVER returns a state the gazetteer
  // contradicts. We refuse to mint a bill from a guessed state — better an
  // undercount than a wrong-state municipal bill.
  const { locality: resolvedState, corroborated } = reconcileLocality({
    aiLocality: alert.locality,
    text: alert.body,
    title: alert.title,
  });
  if (!/^[A-Z]{2}$/.test(resolvedState)) {
    console.log(`  ⏭  no single state resolved (got "${resolvedState}"); skipping`);
    return false;
  }

  const billNumber = deriveBillNumber(alert);
  const title = deriveTitle(alert);
  const status = deriveStatus(alert);
  // Only stamp the specific "City, ST" locality when the resolver corroborated
  // the state. Uncorroborated → leave locality null and create the bill at
  // plain state scope (no mislabel).
  const cityLocality = deriveCityLocality(alert);
  const locality = corroborated ? cityLocality : null;
  if (cityLocality && !corroborated) {
    console.log(`  ⚠ locality-guard: "${cityLocality}" not corroborated against ${resolvedState} → dropping specific locality, using state scope`);
  }
  const session = String(new Date().getFullYear());

  // Idempotent — match by (state, bill_number, scope, locality).
  const { data: existing } = await sb
    .from("bills")
    .select("id")
    .eq("state", resolvedState)
    .eq("bill_number", billNumber)
    .eq("scope", "municipal")
    .eq("locality", locality ?? "")
    .limit(1)
    .maybeSingle();

  let billId = existing?.id;
  if (billId) {
    console.log(`  ⏭  bill already exists: ${billId}`);
  } else {
    const { data: created, error } = await sb
      .from("bills")
      .insert({
        state: resolvedState,
        bill_number: billNumber,
        title,
        summary: alert.body?.slice(0, 4000) ?? null,
        status,
        last_action: "Surfaced via news intel pipeline",
        last_action_at: alert.occurs_at ?? alert.created_at,
        source_url: alert.source_url,
        scope: "municipal",
        locality,
        session_id: session,
        kratom_relevance: "anti", // city ordinances tracked here are bans
        relevance_confidence: 0.75,
        active: true,
      })
      .select("id")
      .single();
    if (error) {
      console.log(`  ✗ bill insert failed: ${error.message}`);
      return false;
    }
    billId = created.id;
    console.log(`  ✓ bill created: ${billId} (${billNumber})`);
  }

  await sb.from("policy_alerts").update({ bill_id: billId }).eq("id", alert.id);
  console.log(`  ✓ alert.bill_id linked → /bills/${billId}`);
  return true;
}

let alerts;
if (SPECIFIC) {
  const { data } = await sb.from("policy_alerts").select("*").eq("id", SPECIFIC).single();
  alerts = data ? [data] : [];
} else {
  const { data } = await sb
    .from("policy_alerts")
    .select("*")
    .eq("kind", "bill_event")
    .is("bill_id", null)
    .eq("moderation_status", "approved")
    .order("created_at", { ascending: false });
  alerts = data ?? [];
}

if (alerts.length === 0) { console.log("Nothing to process."); process.exit(0); }
console.log(`Processing ${alerts.length} alert(s)…`);

let ok = 0, skip = 0;
for (const a of alerts) {
  const r = await processAlert(a);
  if (r) ok++; else skip++;
}
console.log(`\nDone. ok=${ok}, skipped=${skip}`);
try {
  await sb.from("scraper_runs").insert({
    source: "promote_alert_to_bill",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: ok === 0 && skip === 0 ? "empty" : "success",
    rows_added: ok,
    notes: `${ok} promoted, ${skip} skipped`,
  });
} catch { /* best-effort */ }
