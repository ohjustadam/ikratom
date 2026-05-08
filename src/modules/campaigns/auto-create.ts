/**
 * Auto-generate "respond to this bill" campaigns from newly-detected
 * anti-kratom bills. Called from the daily cron after the bills sync
 * completes.
 *
 * Eligibility for auto-campaign:
 *   - bill.active = true
 *   - bill.state IS NOT NULL (federal handled separately later)
 *   - bill.kratom_relevance = 'anti'
 *   - bill.relevance_confidence >= 0.6  (only confident classifications;
 *       default for non-AI-enriched bills is null and these are skipped —
 *       they'll be picked up after enrichment runs locally)
 *   - bill.status NOT IN ('enacted', 'dead')
 *   - bill.last_action_at >= today − STALE_AFTER_DAYS  (prevents creating
 *       campaigns about bills from closed legislative sessions; without
 *       this guard, OpenStates' kratom search returns historical anti-bills
 *       that have effectively died with their session — emailing
 *       legislators about a dead bill makes the platform look unserious)
 *   - no existing campaign already linked via bill_id (auto OR manual)
 *
 * Templates: standardized "I'm a constituent, please vote NO" letter with
 * {{full_name}} / {{legislator_name}} / {{state}} placeholders. The bill's
 * advocacy_callout (Ollama-generated) is woven into the blurb + body for
 * specificity.
 *
 * Notifications: the existing `trg_campaign_notify` Postgres trigger fires
 * on campaign INSERT and fans out in-app notifications respecting each
 * user's preferences. We don't need to do that here.
 */

/** Treat a bill as stale (closed-session) when its last action is older
 *  than this. Most US legislative sessions span 12 months; a year of
 *  silence reliably means the bill died with the session. */
const STALE_AFTER_DAYS = 365;

/** Confidence floor for auto-publishing (active=true). Below → pending review. */
const AUTO_PUBLISH_CONFIDENCE = 0.85;
/** Confidence floor for considering at all. Below → skip entirely. */
const MIN_CONSIDER_CONFIDENCE = 0.6;

/**
 * Compute the "current session" for a state — the highest-string session_id
 * that has any bill activity within the last STALE_AFTER_DAYS. Bills from
 * any other session for that state are considered closed and ineligible
 * for auto-campaigns. We compute this in JS rather than SQL because session
 * identifiers are non-numeric (e.g. "2025-2026", "89R") and need
 * lexicographic max with last-action-date as tiebreak.
 */
function pickCurrentSessions(
  rows: Array<{ state: string; session_id: string | null; last_action_at: string | null }>,
): Map<string, string> {
  const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86400_000).toISOString().slice(0, 10);
  // For each (state, session_id), track the max last_action_at
  const max = new Map<string, { state: string; session: string; lastAction: string }>();
  for (const r of rows) {
    if (!r.session_id || !r.last_action_at) continue;
    if (r.last_action_at < cutoff) continue;
    const key = `${r.state}::${r.session_id}`;
    const prev = max.get(key);
    if (!prev || r.last_action_at > prev.lastAction) {
      max.set(key, { state: r.state, session: r.session_id, lastAction: r.last_action_at });
    }
  }
  // For each state, pick the session with the most recent activity
  const current = new Map<string, { session: string; lastAction: string }>();
  for (const v of max.values()) {
    const prev = current.get(v.state);
    if (!prev || v.lastAction > prev.lastAction) {
      current.set(v.state, { session: v.session, lastAction: v.lastAction });
    }
  }
  return new Map(Array.from(current.entries()).map(([s, v]) => [s, v.session]));
}

import type { SupabaseClient } from "@supabase/supabase-js";

type Bill = {
  id: string;
  state: string;
  bill_number: string;
  title: string | null;
  summary_ai: string | null;
  summary: string | null;
  advocacy_callout: string | null;
  kratom_relevance: string | null;
  relevance_confidence: number | null;
  status: string | null;
  last_action: string | null;
  last_action_at: string | null;
  session_id: string | null;
  scope: string | null;
  targets_natural_leaf: boolean | null;
  targets_synthetic_only: boolean | null;
  deep_analyzed_at: string | null;
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

function buildCampaign(bill: Bill) {
  const stateLc = bill.state.toLowerCase();
  const numLc = (bill.bill_number || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const slug = `stop-${stateLc}-${numLc || slugify(bill.title ?? "bill")}`.slice(0, 80);

  const shortTitle = (bill.title ?? "an anti-kratom bill").slice(0, 100);
  const title = `Stop ${bill.state} ${bill.bill_number}: ${shortTitle}`.slice(0, 200);

  const blurb =
    bill.advocacy_callout ??
    `An anti-kratom bill is moving in ${bill.state}. Email your state legislators today.`;

  const summaryLine = bill.summary_ai || bill.summary || "";
  const calloutLine = bill.advocacy_callout
    ? `\n\nWhy this matters: ${bill.advocacy_callout}`
    : "";

  const body_md =
    `${bill.state} ${bill.bill_number} ${bill.title ? `— "${bill.title}"` : ""} would harm ` +
    `the kratom community. ${summaryLine}${calloutLine}\n\n` +
    `Last action: ${bill.last_action ?? "(see source)"}\n\n` +
    `This campaign was auto-generated by iKratom's bill-tracker. Review and ` +
    `edit before sending — your personal story is what makes legislator emails ` +
    `actually get read.`;

  const subject_template =
    `Please oppose ${bill.bill_number} — kratom matters to your constituents`;

  const body_template =
    `Dear {{legislator_name}},\n\n` +
    `My name is {{full_name}} and I'm a constituent in ${bill.state}. I'm writing about ${bill.bill_number}, ${shortTitle}.\n\n` +
    (bill.advocacy_callout
      ? `${bill.advocacy_callout}\n\n`
      : `This bill would significantly restrict kratom access for adults in our state.\n\n`) +
    `Kratom is a botanical that millions of Americans use safely as part of their daily wellness — for managing chronic pain, anxiety, energy, and recovery from opioid dependence. Restrictive legislation pushes consumers toward unregulated sources and worsens the very public-health concerns it claims to address.\n\n` +
    `I respectfully ask you to vote NO on ${bill.bill_number}, or to support amendments that focus on consumer-protection standards (age limits, labeling, lab testing) rather than prohibition.\n\n` +
    `Thank you for representing us.\n\n` +
    `{{full_name}}\n` +
    `{{city}}, ${bill.state}`;

  return {
    slug,
    title,
    blurb: blurb.slice(0, 500),
    body_md: body_md.slice(0, 20000),
    state: bill.state,
    bill_id: bill.id,
    target_roles: ["state_senate", "state_house"],
    subject_template: subject_template.slice(0, 200),
    body_template: body_template.slice(0, 20000),
    active: true,
    auto_generated: true,
  };
}

export type AutoCreateResult = {
  considered: number;
  created: number;
  pending: number;
  skippedExisting: number;
  skippedSyntheticOnly: number;
  errors: { bill_id: string; reason: string }[];
};

export async function autoCreateCampaignsForNewAntiBills(
  supabase: SupabaseClient,
): Promise<AutoCreateResult> {
  const result: AutoCreateResult = {
    considered: 0,
    created: 0,
    pending: 0,
    skippedExisting: 0,
    skippedSyntheticOnly: 0,
    errors: [],
  };

  // Eligible bills
  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86400_000)
    .toISOString()
    .slice(0, 10);

  // Step 1: figure out the current session per state by looking at recent
  // activity across all bills (not just anti). Bills from any other
  // session are filtered out below.
  const { data: sessionRows } = await supabase
    .from("bills")
    .select("state, session_id, last_action_at")
    .eq("active", true)
    .not("state", "is", null)
    .not("session_id", "is", null)
    .gte("last_action_at", staleCutoff);
  const currentSessionByState = pickCurrentSessions(
    (sessionRows ?? []) as Array<{ state: string; session_id: string | null; last_action_at: string | null }>,
  );

  // Step 2: load anti-bill candidates that pass all the prior filters
  // PLUS have a session_id (post-fix data only — legacy null-session
  // rows are skipped to avoid zombie campaigns).
  const { data: billsRaw, error: billsErr } = await supabase
    .from("bills")
    .select(
      "id, state, bill_number, title, summary_ai, summary, advocacy_callout, " +
      "kratom_relevance, relevance_confidence, status, last_action, last_action_at, " +
      "session_id, scope, targets_natural_leaf, targets_synthetic_only, deep_analyzed_at",
    )
    .eq("active", true)
    .eq("scope", "state")
    .eq("kratom_relevance", "anti")
    .gte("relevance_confidence", MIN_CONSIDER_CONFIDENCE)
    .not("state", "is", null)
    .not("session_id", "is", null)
    .not("status", "in", "(enacted,dead)")
    .gte("last_action_at", staleCutoff);

  if (billsErr) {
    result.errors.push({ bill_id: "(query)", reason: billsErr.message });
    return result;
  }

  const allBills = (billsRaw ?? []) as unknown as Bill[];
  // Step 3: drop any bill whose session_id isn't the current session for
  // its state. This is the real session-awareness gate.
  const bills = allBills.filter((b) => {
    const current = currentSessionByState.get(b.state);
    return current != null && b.session_id === current;
  });
  result.considered = bills.length;
  if (bills.length === 0) return result;

  // Find which bill_ids already have ANY campaign (auto or manual). We only
  // auto-create when no campaign exists at all — admins can still hand-write
  // a campaign for the same bill, which suppresses auto-creation.
  const billIds = bills.map((b) => b.id);
  const { data: existingCampaigns } = await supabase
    .from("campaigns")
    .select("bill_id")
    .in("bill_id", billIds);
  const taken = new Set(
    (existingCampaigns ?? [])
      .map((c: { bill_id: string | null }) => c.bill_id)
      .filter((x): x is string => !!x),
  );

  for (const bill of bills) {
    if (taken.has(bill.id)) {
      result.skippedExisting++;
      continue;
    }

    // PROTECTIVE GATE: a bill that's been deep-analyzed and explicitly
    // targets only synthetics (NH SB 557 case) shouldn't auto-fire an
    // anti campaign — even if shallow classifier said 'anti'.
    if (bill.targets_synthetic_only === true && bill.targets_natural_leaf === false) {
      result.skippedSyntheticOnly++;
      continue;
    }

    // PUBLISH vs REVIEW gate:
    //   - High confidence (≥ 0.85) AND deep-analysis confirms anti-leaf
    //     OR no deep-analysis yet (legacy backwards compat)
    //     → publish active immediately
    //   - Anything else → land in pending_review queue (active=false)
    const isHighConfidence = (bill.relevance_confidence ?? 0) >= AUTO_PUBLISH_CONFIDENCE;
    const isDeepConfirmedAntiLeaf =
      bill.deep_analyzed_at !== null && bill.targets_natural_leaf === true;
    const passesShallowOnly = bill.deep_analyzed_at === null; // not yet deep-analyzed
    const shouldAutoPublish = isHighConfidence && (isDeepConfirmedAntiLeaf || passesShallowOnly);

    const baseRow = buildCampaign(bill);
    const row = shouldAutoPublish
      ? { ...baseRow, active: true, review_state: "auto_active" }
      : { ...baseRow, active: false, review_state: "pending_review" };

    let insertedCampaignId: string | null = null;
    const { data: insertData, error } = await supabase
      .from("campaigns")
      .insert(row)
      .select("id, title, blurb")
      .single();
    if (error) {
      // Slug collision / unique-violation path — try a numeric suffix once
      if (error.code === "23505") {
        const altRow = { ...row, slug: `${row.slug}-${Date.now().toString(36)}`.slice(0, 80) };
        const { data: retryData, error: retryErr } = await supabase
          .from("campaigns")
          .insert(altRow)
          .select("id, title, blurb")
          .single();
        if (retryErr) {
          result.errors.push({ bill_id: bill.id, reason: retryErr.message });
        } else {
          insertedCampaignId = (retryData?.id as string | undefined) ?? null;
          if (shouldAutoPublish) result.created++;
          else result.pending++;
        }
      } else {
        result.errors.push({ bill_id: bill.id, reason: error.message });
      }
    } else {
      insertedCampaignId = (insertData?.id as string | undefined) ?? null;
      if (shouldAutoPublish) result.created++;
      else result.pending++;
    }

    // Discord fan-out — best-effort, never blocks the loop. Only fire on
    // SUCCESSFULLY auto-PUBLISHED campaigns so server admins don't get
    // pings about pending-review bills the public can't yet see. Imported
    // lazily so this cron-only Discord wiring doesn't pull web-only deps
    // when auto-create is referenced elsewhere.
    if (shouldAutoPublish && insertedCampaignId) {
      try {
        const { notifyDiscordOnBillDrop, notifyDiscordOnCampaignLaunch } = await import(
          "@/modules/discord/actions"
        );
        // Fire bill_drop_hostile (the bill itself is news) and
        // campaign_launch (action is now available) in parallel — they
        // target different event subscribers in /admin/discord-integrations.
        await Promise.all([
          notifyDiscordOnBillDrop({
            billId: bill.id,
            state: bill.state,
            title: bill.title ?? `${bill.state} ${bill.bill_number}`,
            sponsor: null,
            status: bill.status ?? null,
            isHostile: true,
          }),
          notifyDiscordOnCampaignLaunch({
            campaignId: insertedCampaignId,
            title:
              (insertData?.title as string | undefined) ??
              bill.title ??
              `Action on ${bill.state} ${bill.bill_number}`,
            state: bill.state,
            description: (insertData?.blurb as string | undefined) ?? null,
          }),
        ]);
      } catch {
        // never let a Discord outage stop campaign creation
      }
    }
  }

  return result;
}
