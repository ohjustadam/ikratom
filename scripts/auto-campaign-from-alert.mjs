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

  // Owner directive 2026-05-14: templates must NOT infer the user's
  // position on 7-OH (pro or anti). Default messaging asks legislators
  // to be specific about WHICH products their policy targets, names
  // the five distinct alkaloid classes (natural leaf, mitragynine,
  // 7-OH, pseudoindoxyl, synthetic) without endorsing a side, and
  // requests evidence-based decision-making + transparent public
  // process. Users with a recorded profile stance can opt into a
  // stance-specific variant via the campaign editor; this default
  // is neutral.
  if (alert.kind === "bill_event" && alert.title?.toLowerCase().includes("city")) {
    return {
      subject: `Re: kratom ordinance in ${localityName} — please clarify scope`,
      body: `Dear {{recipient_title}} {{recipient_last_name}},

I'm writing as a constituent regarding the recent kratom-related ordinance activity in ${localityName}.

Kratom is not a single substance. Policy language often refers to it as one thing, but the science and the marketplace recognize at least five distinct classes:
- Natural leaf kratom (the unmodified plant)
- Mitragynine (the dominant natural alkaloid)
- 7-hydroxymitragynine (a trace natural alkaloid often concentrated or isolated in modern products)
- Mitragynine pseudoindoxyl (an oxidation metabolite)
- Synthetic / semi-synthetic alkaloid analogues

Each has a different pharmacology, history of use, and risk profile. Policy that treats them as identical can either over-restrict (capturing traditional plant use that has decades of relatively safe consumption data) or under-restrict (leaving concentrated or synthetic products under-regulated).

I respectfully ask that any local action explicitly state which of these classes it targets, what testing or labeling standards apply, and what public process led to the decision.

Background and platform: https://www.ikratom.org${sourceLine}

Thank you for your time.

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

I respectfully ask the Board to make explicit which products are within scope of any proposed action. Kratom-related products on the US market today include the natural leaf, mitragynine, 7-hydroxymitragynine in concentrated form, mitragynine pseudoindoxyl, and synthetic / semi-synthetic alkaloid analogues. These differ in pharmacology, history, and risk.

Whichever direction the Board chooses, I ask that the rule:
- Name the specific compounds and product forms being addressed
- Cite the evidence underlying that scope
- Make the rationale and public process publicly available

Source: ${alert.source_url ?? "(see ikratom.org)"}
Background: https://www.ikratom.org

Sincerely,
{{full_name}}
{{city}}, {{state}}`,
    };
  }

  if (alert.kind === "ag_enforcement" || alert.kind === "fda_action") {
    return {
      subject: `Kratom enforcement in ${localityName} — request for scope clarification`,
      body: `Dear {{recipient_title}} {{recipient_last_name}},

I'm writing regarding the recent kratom-related enforcement action in ${localityName}.

I respectfully request that the agency clarify exactly which products and compounds the enforcement covers. "Kratom" as a category includes the natural leaf, mitragynine, 7-hydroxymitragynine in concentrated forms, mitragynine pseudoindoxyl, and synthetic analogues — each pharmacologically distinct. Enforcement language that does not specify which of these is in scope creates regulatory uncertainty for consumers, retailers, and downstream policy.

I take no position in this letter on whether the underlying restriction is correct — I am asking for clarity on what it actually covers, the evidence supporting that scope, and how it was decided.

Source: ${alert.source_url ?? ""}

Sincerely,
{{full_name}}
{{city}}, {{state}}`,
    };
  }

  // Default: state-bill or generic news event
  return {
    subject: `Kratom policy in ${localityName} — request for evidence-based scope`,
    body: `Dear {{recipient_title}} {{recipient_last_name}},

I'm writing as a constituent regarding recent kratom-related policy activity in ${localityName}.

Effective kratom policy depends on which products it targets. "Kratom" today refers to a family of products with significantly different chemistry: natural leaf, mitragynine, 7-hydroxymitragynine (as a trace natural alkaloid AND as a concentrated product), pseudoindoxyl, and synthetic / semi-synthetic analogues. The right policy may differ for each.

I respectfully ask that any legislation:
- State the specific compounds and product classes within scope
- Cite the evidence base for the chosen approach
- Allow a transparent comment period and recorded vote

I'm not writing to tell you which way to vote. I'm writing to ask that the decision rest on a clear factual record so constituents can evaluate it on its merits.

Source: ${alert.source_url ?? ""}

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

  // Return values:
  //   "ok"   — campaign created
  //   "skip" — no-op (already linked, action_required=false)
  //   "fail" — actual error (insert error, target lookup failure)
  if (alert.campaign_id) {
    console.log(`  ⏭  campaign already linked: ${alert.campaign_id}`);
    return "skip";
  }
  if (!alert.action_required) {
    console.log("  ⏭  action_required=false; skipping");
    return "skip";
  }
  // Owner directive 2026-05-14: 'we shouldnt be creating campaigns to call
  // gov officials just because a news article. there should be something
  // actionablly happening.' A campaign needs a concrete anchor — either
  // a bill_id (legislation actively moving) OR a specifically actionable
  // alert kind (bop_hearing, ag_enforcement, fda_action) where the event
  // itself IS the action. Generic news_break / bill_event without a
  // bill_id link is too noisy and was producing 200+ duplicate
  // cross-state campaigns from syndicated news.
  const ANCHORED_KINDS = new Set(["bop_hearing", "ag_enforcement", "fda_action"]);
  if (!alert.bill_id && !ANCHORED_KINDS.has(alert.kind)) {
    console.log(`  ⏭  no bill_id + kind=${alert.kind} not anchored — skipping (news-only alert)`);
    return "skip";
  }

  const { targets, roles, locality, tier, bopBoardId } = await pickTargets(alert);
  console.log(`  targeting tier: ${tier}, ${targets.length} legislator(s) ${locality ? `in ${locality}` : ""}`);

  const tpl = templateForAlert(alert);

  // Slug — matches the Phase 4 trigger's build_alert_campaign_slug()
  // exactly (including the 6-char alert-id suffix) so the script and
  // the trigger can't collide on the same slug. Pre-fix, the script
  // omitted the id suffix and threw unique_violation every cron run
  // for any alert pair sharing a 6-word title prefix.
  const slugWords = alert.title
    ?.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .slice(0, 6)
    .join("-")
    .replace(/-+/g, "-");
  const idSuffix = alert.id.replace(/-/g, "").slice(0, 6);
  const slug = `alert-${alert.locality.toLowerCase()}-${slugWords}-${idSuffix}`.slice(0, 80);

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
    return "ok";
  }

  const { data: created, error } = await sb
    .from("campaigns")
    .insert(campaignRow)
    .select("id, slug")
    .single();
  if (error) {
    if (error.code === "23505") {
      // Could be slug collision OR topic_key collision (ux_campaigns_topic_key_live
      // from migration 0108). Either way, an existing campaign covers this event —
      // find it and link the alert to it instead of failing.
      const violatedConstraint = error.message?.match(/constraint "([^"]+)"/)?.[1]
        ?? error.details?.match(/constraint "([^"]+)"/)?.[1] ?? "";
      const isTopicViolation = /topic_key_live/i.test(violatedConstraint)
        || /topic_key/i.test(error.details ?? "");
      let canonicalId = null;
      if (isTopicViolation) {
        // Look up the existing live campaign with the same topic_key
        const topicKey = error.details?.match(/Key \(topic_key\)=\(([^)]+)\)/)?.[1];
        if (topicKey) {
          const { data: existing } = await sb.from("campaigns")
            .select("id, slug")
            .eq("topic_key", topicKey)
            .in("review_state", ["pending_review", "auto_active", "manual"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (existing) {
            canonicalId = existing.id;
            console.log(`  ↪  topic-dedup: linking alert to existing canonical ${existing.slug} (${canonicalId.slice(0, 8)})`);
          }
        }
      }
      if (!canonicalId) {
        // Fall back to slug match (the original 0068 trigger may have inserted first)
        const { data: bySlug } = await sb.from("campaigns")
          .select("id").eq("slug", campaignRow.slug).maybeSingle();
        if (bySlug) {
          canonicalId = bySlug.id;
          console.log(`  ↪  slug-dedup: linking alert to existing campaign ${campaignRow.slug}`);
        }
      }
      if (canonicalId) {
        await sb.from("policy_alerts").update({ campaign_id: canonicalId }).eq("id", alert.id);
        return "skip";
      }
      console.log(`  ⏭  unique-violation but couldn't find canonical: ${campaignRow.slug}`);
      return "skip";
    }
    console.log(`  ✗ campaign insert failed: ${error.message}`);
    return "fail";
  }
  console.log(`  ✓ campaign ${created.id.slice(0, 8)} (${created.slug})`);

  // Link back from the alert
  await sb.from("policy_alerts").update({ campaign_id: created.id }).eq("id", alert.id);
  console.log("  ✓ alert.campaign_id updated");
  return "ok";
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

let ok = 0, fail = 0, skip = 0;
for (const a of alerts) {
  const r = await processAlert(a);
  if (r === "ok") ok++;
  else if (r === "fail") fail++;
  else skip++;
}
console.log(`\nDone. ok=${ok}, fail=${fail}, skip=${skip}`);
try {
  // Skips (alert already has a campaign, trigger beat us to the slug,
  // action_required=false) are correct no-ops in the safety-net role —
  // the Phase 4 trigger handles real-time, this script just sweeps.
  // Only flag error if there were ACTUAL failures.
  const status =
    fail > 0 ? "error" :
    (ok === 0 && skip === 0) ? "empty" :
    "success";
  await sb.from("scraper_runs").insert({
    source: "auto_campaign_from_alert",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status,
    rows_added: ok,
    notes: `${ok} generated, ${skip} no-op skipped, ${fail} failed`,
  });
} catch { /* best-effort */ }
