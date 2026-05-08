#!/usr/bin/env node
/**
 * Auto-create a solidarity campaign from a policy_alert.
 *
 * As of migration 0068 this runs in real-time via a Postgres trigger
 * (`trg_auto_campaign_on_alert`) — alerts get a campaign within the
 * same transaction they're inserted. This script is kept as:
 *   - A safety net in the hourly cron in case the trigger errors out
 *   - A tactical recovery tool: `--all-pending` will pick up any alert
 *     that's missing a campaign_id (e.g. if a template lookup failed)
 *   - A way to backfill alerts created before the trigger existed
 *
 * Scope: when a city/county/AG/BoP alert lands and action_required=true,
 * we want a campaign on the war-room dashboard that ANY iKratom member
 * can take action on with one click — not just locals. This script
 * generates that campaign.
 *
 * Targeting tiers (best → fallback):
 *   1. If we have city/county officials in legislators (role in
 *      ['city_council','mayor']) for the alert's locality → use them
 *   2. If kind='bop_hearing' and bop_boards has contact_email for the
 *      state → use the BoP board email
 *   3. Otherwise → fall back to state legislators (state_senate +
 *      state_house) for the alert's state. Solidarity action targets
 *      state-level reps to push for state-level preemption / KCPA.
 *
 * mobilization_type = 'solidarity' by default (open to all members
 * regardless of state of residence). When the campaign targets state
 * legislators specifically and the alert is local, we add 'both' so
 * the user's own state reps get prioritized in their dashboard.
 *
 * Subject + body templates are kind-aware. Each ends with a link
 * back to the source URL + the iKratom briefing link so reps can
 * verify the framing.
 *
 * Run:
 *   node --env-file=.env.local scripts/auto-campaign-from-alert.mjs <alert-id>
 *   node --env-file=.env.local scripts/auto-campaign-from-alert.mjs --all-pending
 *   node --env-file=.env.local scripts/auto-campaign-from-alert.mjs --all-pending --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const SPECIFIC = args.find((a) => /^[0-9a-f-]{36}$/i.test(a)) ?? null;
const ALL_PENDING = args.includes("--all-pending");
const DRY = args.includes("--dry-run");

if (!SPECIFIC && !ALL_PENDING) {
  console.error("Usage: <alert-id>  OR  --all-pending  (optionally --dry-run)");
  process.exit(1);
}

// ---------- templates ----------
function templateForAlert(alert) {
  const sourceLine = alert.source_url ? `\n\nSource: ${alert.source_url}` : "";
  const localityName = alert.locality === "FED" ? "the federal level" :
    alert.locality === "ALL" ? "the national level" :
    alert.locality;

  if (alert.kind === "bill_event" && alert.title?.toLowerCase().includes("city")) {
    // City ordinance pattern (Marshall IL, Ventura CA)
    return {
      subject: `Re: kratom-related ordinance in ${localityName} — please consider the alkaloid distinction`,
      body: `Dear {{recipient_title}} {{recipient_last_name}},

I'm writing as a member of the kratom advocacy community regarding the recent kratom-related action in ${localityName}.

A growing body of state legislation — including bills in New Hampshire, Ohio, and elsewhere — distinguishes between natural leaf kratom (the plant in its traditional form) and 7-hydroxymitragynine-enriched or synthetic kratom products. The legitimate industry supports restrictions on enriched and synthetic products. We oppose conflating those products with natural leaf, which has been used safely for centuries and is supported by a substantial harm-reduction literature.

I respectfully ask that any local action preserve access to natural-leaf kratom while addressing the documented concerns about enriched/synthetic derivatives.

If your jurisdiction has not yet acted, the Kratom Consumer Protection Act (KCPA) framework — already adopted by eight states — provides a tested model that distinguishes legitimate products from concerning ones, including age limits, labeling requirements, and a 7-OH cap.

Background and platform: https://www.ikratom.org${sourceLine}

Thank you for your time and consideration.

Sincerely,
{{full_name}}
{{city}}, {{state}}`,
    };
  }

  if (alert.kind === "bop_hearing") {
    return {
      subject: `Public comment on kratom-related agenda item — ${localityName} Board of Pharmacy`,
      body: `Dear Board members,

I submit this public comment regarding kratom-related items on the upcoming agenda.

I urge the Board to distinguish carefully between natural leaf kratom and 7-hydroxymitragynine-enriched or synthetic kratom products. The legitimate industry supports restrictions on enriched and synthetic derivatives — what we oppose is broad scheduling that captures the natural plant.

The federal National Drug Control Strategy 2026 (May 2026, ONDCP) explicitly distinguishes 7-OH-enriched products from natural leaf in its enforcement framework. State boards adopting that same distinction protect consumers without criminalizing a substance with documented harm-reduction benefits.

Source: ${alert.source_url ?? "(see ikratom.org)"}
Briefing: https://www.ikratom.org/briefings/ndcs-2026

Sincerely,
{{full_name}}
{{city}}, {{state}}`,
    };
  }

  if (alert.kind === "ag_enforcement" || alert.kind === "fda_action") {
    return {
      subject: `Concern about scope of kratom enforcement in ${localityName}`,
      body: `Dear {{recipient_title}} {{recipient_last_name}},

I'm writing regarding the recent kratom-related enforcement action in ${localityName}.

I support enforcement against 7-hydroxymitragynine-enriched, synthetically altered, or mislabeled kratom products. I am concerned, however, when enforcement language conflates those products with natural-leaf kratom, which has a different chemical profile, a long history of traditional use, and growing peer-reviewed literature documenting its role in harm reduction for opioid dependence.

I respectfully ask that future enforcement and policy communication make this distinction explicit.

Source: ${alert.source_url ?? ""}

Sincerely,
{{full_name}}
{{city}}, {{state}}`,
    };
  }

  // Default: state-bill or generic news event
  return {
    subject: `Kratom policy in ${localityName} — please preserve natural leaf access`,
    body: `Dear {{recipient_title}} {{recipient_last_name}},

I'm writing as a member of the kratom advocacy community regarding recent policy activity in ${localityName}.

Modern kratom legislation — including the federal NDCS 2026 framework and bills like NH SB 557 — distinguishes between natural leaf kratom (the plant) and 7-hydroxymitragynine-enriched / synthetic derivatives. The first preserves a centuries-old plant medicine; the second targets concerning new products.

I support sensible regulation that maintains this distinction. The Kratom Consumer Protection Act framework — adopted in eight states — is the tested model.

Source: ${alert.source_url ?? ""}
Briefing: https://www.ikratom.org/briefings/ndcs-2026

Sincerely,
{{full_name}}
{{city}}, {{state}}`,
  };
}

// ---------- targeting ----------
async function pickTargets(alert) {
  // Tier 1: city/county officials for the locality
  if (alert.locality && /^[A-Z]{2}$/.test(alert.locality)) {
    // Try to extract city from title (heuristic — works for "Marshall, IL — ..." style)
    const cityMatch = alert.title?.match(/^([A-Z][a-zA-Z\s]+),\s+([A-Z]{2})/);
    const cityName = cityMatch?.[1]?.trim();
    if (cityName) {
      const { data: cityOfficials } = await sb
        .from("legislators")
        .select("id, full_name, role")
        .eq("state", alert.locality)
        .ilike("locality", `%${cityName}%`)
        .in("role", ["city_council", "mayor"])
        .eq("active", true);
      if (cityOfficials && cityOfficials.length > 0) {
        return {
          targets: cityOfficials.map((o) => o.id),
          roles: ["city_council", "mayor"],
          locality: cityName,
          tier: "city",
        };
      }
    }
  }

  // Tier 2: BoP board for state
  if (alert.kind === "bop_hearing" && alert.bop_board_id) {
    return { targets: [], roles: [], locality: null, tier: "bop", bopBoardId: alert.bop_board_id };
  }

  // Tier 3: state legislators (always available for any 50-state alert)
  if (alert.locality && /^[A-Z]{2}$/.test(alert.locality)) {
    const { data: stateLegs } = await sb
      .from("legislators")
      .select("id")
      .eq("state", alert.locality)
      .in("role", ["state_senate", "state_house"])
      .eq("active", true)
      .limit(200);
    return {
      targets: (stateLegs ?? []).map((l) => l.id),
      roles: ["state_senate", "state_house"],
      locality: null,
      tier: "state",
    };
  }

  // Tier 4: federal (US Senate + US House) for ALL/FED locality
  const { data: fedLegs } = await sb
    .from("legislators")
    .select("id")
    .in("role", ["us_senate", "us_house"])
    .eq("active", true)
    .limit(600);
  return {
    targets: (fedLegs ?? []).map((l) => l.id),
    roles: ["us_senate", "us_house"],
    locality: null,
    tier: "federal",
  };
}

// ---------- main ----------
async function processAlert(alert) {
  console.log(`\n=== ${alert.id.slice(0, 8)} | ${alert.kind} | ${alert.locality} ===`);
  console.log(`  ${alert.title}`);

  if (alert.campaign_id) {
    console.log(`  ⏭  campaign already linked: ${alert.campaign_id}`);
    return false;
  }
  if (!alert.action_required) {
    console.log("  ⏭  action_required=false; skipping");
    return false;
  }

  const { targets, roles, locality, tier, bopBoardId } = await pickTargets(alert);
  console.log(`  targeting tier: ${tier}, ${targets.length} legislator(s) ${locality ? `in ${locality}` : ""}`);

  const tpl = templateForAlert(alert);

  // Slug from kind + locality + first 6 words of title
  const slugWords = alert.title
    ?.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .slice(0, 6)
    .join("-")
    .replace(/-+/g, "-");
  const slug = `alert-${alert.locality.toLowerCase()}-${slugWords}`.slice(0, 80);

  const campaignRow = {
    slug,
    state: /^[A-Z]{2}$/.test(alert.locality) ? alert.locality : null,
    title: alert.title.slice(0, 200),
    blurb: alert.body ? alert.body.split("\n")[0].slice(0, 260) : null,
    subject_template: tpl.subject,
    body_template: tpl.body,
    target_legislator_ids: targets.length > 0 ? targets : null,
    target_roles: roles.length > 0 ? roles : null,
    target_locality: locality,
    mobilization_type: "solidarity",
    allow_non_residents: true,
    auto_generated: true,
    review_state: "pending_review", // admin verifies before going public
    active: false, // becomes active after review
    starts_at: new Date().toISOString(),
    ends_at: alert.expires_at ?? null,
    ai_personalize: false,
  };

  if (DRY) {
    console.log("  DRY RUN — would insert:");
    console.log(`    slug: ${campaignRow.slug}`);
    console.log(`    subject: ${campaignRow.subject_template}`);
    console.log(`    targets: ${targets.length} legislator(s) (${tier})`);
    return true;
  }

  const { data: created, error } = await sb
    .from("campaigns")
    .insert(campaignRow)
    .select("id, slug")
    .single();
  if (error) {
    console.log(`  ✗ campaign insert failed: ${error.message}`);
    return false;
  }
  console.log(`  ✓ campaign ${created.id.slice(0, 8)} (${created.slug})`);

  // Link back from the alert
  await sb.from("policy_alerts").update({ campaign_id: created.id }).eq("id", alert.id);
  console.log("  ✓ alert.campaign_id updated");
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
    .eq("action_required", true)
    .is("campaign_id", null)
    .eq("moderation_status", "approved")
    .order("created_at", { ascending: false })
    .limit(50);
  alerts = data ?? [];
}

if (alerts.length === 0) { console.log("Nothing to process."); process.exit(0); }
console.log(`Processing ${alerts.length} alert(s)${DRY ? " (DRY RUN)" : ""}…`);

let ok = 0, fail = 0;
for (const a of alerts) {
  if (await processAlert(a)) ok++; else fail++;
}
console.log(`\nDone. ok=${ok}, fail=${fail}`);
try {
  await sb.from("scraper_runs").insert({
    source: "auto_campaign_from_alert",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: fail > ok ? "error" : (ok === 0 ? "empty" : "success"),
    rows_added: ok,
    notes: `${ok} campaigns generated, ${fail} skipped/failed`,
  });
} catch { /* best-effort */ }
