#!/usr/bin/env node
/**
 * auto-approve-campaigns.mjs — confidence-gated, owner-tunable auto-approval of
 * the campaign pending_review queue (build #3). Cloned from the proven
 * auto-approve-meetings.mjs pattern.
 *
 * The owner's ask: "I should not have to manually approve or deny anything. The
 * system should be smart enough to automate that and ensure there are no dupes
 * and it's relevant." This engine encodes that as a DETERMINISTIC three-way
 * decision per pending auto-generated campaign:
 *
 *   APPROVE   — high-confidence, relevant, sourced, targeted, non-duplicate.
 *               Flips active=true + review_state='auto_active' (IDENTICAL to a
 *               manual approve) which fires campaign_notify_trigger → real
 *               legislator-facing notifications. IRREVERSIBLE (un-approve does
 *               NOT recall sent emails) — hence the conservative caps + shadow.
 *   SUPERSEDE — a duplicate of a live/pending campaign (or an intra-run cluster
 *               sibling). Sends nothing; just collapses the queue.
 *   REJECT    — clearly junk (procedural/concluded/recall/wrong-state/RSS-FP).
 *               OFF by default (campaign_auto_reject_enabled) — a wrong reject
 *               buries a real call-to-action, the asymmetric risk.
 *   ESCALATE  — everything ambiguous. The SAFE default: left in pending_review
 *               for the existing human queue.
 *
 * MODES (site_config.campaign_auto_approve_mode, owner-tunable, no deploy):
 *   off    — no-op.
 *   shadow — compute every decision and WRITE the ledger (applied=false), but
 *            make NO state change and send NO notification. The owner reviews
 *            the ledger before promoting. (default)
 *   live   — apply approve + supersede (+ reject only if separately enabled),
 *            bounded by per-run + rolling-24h caps and a circuit breaker.
 *
 * emergency_mode / read_only_mode (existing kill-switches) hard no-op the engine.
 *
 * Run:
 *   node --env-file=.env.local scripts/auto-approve-campaigns.mjs --dry-run
 *   node --env-file=.env.local scripts/auto-approve-campaigns.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { normalizedTitleKey, strongTopicKey, billKey, federalTopicKey } from "./lib/topic-key.mjs";
import { isCampaignWorthyAlert, isBillConcluded, fpGateDecision, eligibilityVetoSafe } from "./lib/campaign-eligibility.mjs";
import { reconcileLocality } from "./lib/geo-resolver.mjs";
import { APPROVE_COLUMNS, REJECT_COLUMNS, SUPERSEDE_COLUMNS } from "./lib/campaign-review-columns.mjs";

const DRY = process.argv.slice(2).includes("--dry-run");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const t0 = Date.now();
const STALE_SESSION_DAYS = 365;
// How long a campaign whose source article is still un-keyword-classified
// (body_has_kratom_keyword = null) stays in "waiting" before the engine proceeds
// without the FP signal. ~3 nightly classifier runs — long enough that a genuine
// classification would have landed, short enough that a never-classifiable
// Google-News redirect doesn't trap a real CTA forever.
const FP_STALE_GRACE_HOURS = 72;

// ── 1. Policy ───────────────────────────────────────────────────────────────
const { data: cfg } = await sb
  .from("site_config")
  .select(
    "id, emergency_mode, read_only_mode, campaign_auto_approve_enabled, campaign_auto_approve_mode, " +
    "campaign_auto_approve_min_confidence, campaign_auto_approve_require_source, campaign_auto_reject_enabled, " +
    "campaign_auto_approve_stale_days, campaign_auto_approve_max_per_run, campaign_auto_approve_max_per_day, " +
    "campaign_auto_approve_min_age_hours",
  )
  .maybeSingle();

const P = {
  emergency: cfg?.emergency_mode ?? false,
  readOnly: cfg?.read_only_mode ?? false,
  enabled: cfg?.campaign_auto_approve_enabled ?? false,
  minConf: Number(cfg?.campaign_auto_approve_min_confidence ?? 0.85),
  requireSource: cfg?.campaign_auto_approve_require_source ?? true,
  rejectEnabled: cfg?.campaign_auto_reject_enabled ?? false,
  staleDays: Number(cfg?.campaign_auto_approve_stale_days ?? 45),
  maxPerRun: Number(cfg?.campaign_auto_approve_max_per_run ?? 10),
  maxPerDay: Number(cfg?.campaign_auto_approve_max_per_day ?? 40),
  minAgeHours: Number(cfg?.campaign_auto_approve_min_age_hours ?? 26),
};
let mode = cfg?.campaign_auto_approve_mode ?? "shadow";
if (!["off", "shadow", "live"].includes(mode)) mode = "off"; // fail-closed
if (mode === "live" && !P.enabled) mode = "shadow"; // belt-and-suspenders vs DB CHECK
const LIVE = mode === "live" && !DRY;

console.log(
  `auto-approve-campaigns${DRY ? " [DRY]" : ""} — mode=${mode} enabled=${P.enabled} ` +
  `reject=${P.rejectEnabled} requireSource=${P.requireSource} minAge=${P.minAgeHours}h ` +
  `caps(run=${P.maxPerRun},day=${P.maxPerDay})`,
);

if (P.emergency || P.readOnly) { console.log("  emergency_mode/read_only_mode ON — no-op"); await tag("empty", 0); process.exit(0); }
if (mode === "off") { console.log("  mode=off — nothing to do"); await tag("empty", 0); process.exit(0); }

// ── 2. Candidates: pending_review + auto_generated (NEVER touch manual rows) ──
let candidates = [];
for (let from = 0; from < 3000; from += 1000) {
  const { data, error } = await sb
    .from("campaigns")
    .select("id, slug, title, state, bill_id, created_at, target_legislator_ids")
    .eq("review_state", "pending_review")
    .eq("auto_generated", true)
    .order("created_at", { ascending: true })
    .range(from, from + 999);
  if (error) { console.error("candidate query failed:", error.message); await tag("error", 0); process.exit(1); }
  if (!data?.length) break;
  candidates = candidates.concat(data);
  if (data.length < 1000) break;
}
console.log(`  ${candidates.length} pending auto-generated candidate(s)`);
if (!candidates.length) { await tag("empty", 0); process.exit(0); }

// ── 3. Resolve linked alerts (back-link policy_alerts.campaign_id) ────────────
const ids = candidates.map((c) => c.id);
const alertByCampaign = new Map();
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await sb
    .from("policy_alerts")
    .select("id, campaign_id, kind, title, severity, source_url, bill_id, locality")
    .in("campaign_id", ids.slice(i, i + 200));
  for (const a of data ?? []) if (a.campaign_id) alertByCampaign.set(a.campaign_id, a);
}

// ── 4. Occupied dedup keys from LIVE campaigns (auto_active + manual) ──────────
const occupied = new Map(); // key -> canonical campaign id (earliest)
{
  let live = [];
  for (let from = 0; from < 6000; from += 1000) {
    const { data } = await sb
      .from("campaigns")
      .select("id, state, title, created_at")
      .in("review_state", ["auto_active", "manual"])
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (!data?.length) break;
    live = live.concat(data);
    if (data.length < 1000) break;
  }
  for (const c of live) for (const k of keysFor(c.state, c.title)) if (!occupied.has(k)) occupied.set(k, c.id);
}

// ── 5. FP signal: two-hop alert.source_url -> news_items.body_has_kratom_keyword
// Batch by CUMULATIVE URL LENGTH, not a fixed count. Alert source_urls are
// Google-News redirects of 300-600 chars, so a .in() of 150 builds a 25KB+ query
// string that PostgREST silently truncates → the FP join matched UNPREDICTABLY
// (a campaign blocked on one run, slipped through the next). Cap each .in() batch
// at ~3KB of URL text so every match is found, every run.
const sourceUrls = [...new Set([...alertByCampaign.values()].map((a) => a.source_url).filter(Boolean))];
const fpByUrl = new Map(); // url -> true | false | null
{
  const FP_BATCH_CHARS = 3000;
  let batch = [], chars = 0;
  const flush = async () => {
    if (!batch.length) return;
    for (const col of ["url", "resolved_url"]) {
      const { data } = await sb.from("news_items").select("url, resolved_url, body_has_kratom_keyword").in(col, batch);
      for (const n of data ?? []) {
        const u = col === "url" ? n.url : n.resolved_url;
        if (u && !fpByUrl.has(u)) fpByUrl.set(u, n.body_has_kratom_keyword);
      }
    }
    batch = []; chars = 0;
  };
  for (const u of sourceUrls) {
    if (chars + u.length > FP_BATCH_CHARS && batch.length) await flush();
    batch.push(u); chars += u.length + 3; // +3 ≈ the ',"..."' encoding overhead
  }
  await flush();
}

// ── 6. Bills for the bill-linked path ─────────────────────────────────────────
// Resolve via the campaign's bill_id AND the linked alert's bill_id — many
// news-born campaigns carry the bill only on the alert (campaign.bill_id null).
// `last_action` + `active` power the structured concluded-bill veto (the status
// enum lags: an enacted bill can still read status='passed_chamber').
const billIds = [...new Set([
  ...candidates.map((c) => c.bill_id),
  ...[...alertByCampaign.values()].map((a) => a.bill_id),
].filter(Boolean))];
const billById = new Map();
for (let i = 0; i < billIds.length; i += 200) {
  const { data } = await sb
    .from("bills")
    .select("id, relevance_confidence, status, active, last_action, last_action_at, targets_natural_leaf, targets_synthetic_only, deep_analyzed_at")
    .in("id", billIds.slice(i, i + 200));
  for (const b of data ?? []) billById.set(b.id, b);
}

// ── 7. Rolling 24h auto-approve count (maxPerDay cap) ─────────────────────────
// Counts ALL automated approvals (admin_audit_log action='campaign_auto_approved'),
// INCLUDING auto-create.ts's bill-born auto-publishes — intentionally: maxPerDay
// is a GLOBAL automated-approval blast budget shared across both paths (both fire
// legislator emails), so a bill wave + an alert wave can't together exceed it.
let approvedLast24 = 0;
try {
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { count } = await sb
    .from("admin_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "campaign_auto_approved")
    .gte("created_at", since);
  approvedLast24 = count ?? 0;
  if (approvedLast24 > 0) console.log(`  ${approvedLast24} automated approval(s) already in the last 24h (cap ${P.maxPerDay})`);
} catch (e) { console.log(`  ⚠ couldn't read 24h approval count (${String(e.message ?? e).slice(0, 50)}) — treating as 0`); }

// ── 8. Base decision per candidate (intra-run cluster collapse applied after) ─
const now = Date.now();
const decisions = candidates.map((c) => {
  try {
    return { c, ...decide(c) };
  } catch (e) {
    return { c, decision: "escalate", score: null, reason: `engine error (fail-safe): ${String(e.message ?? e).slice(0, 120)}`, signals: { error: true }, key: primaryKey(c) };
  }
});

// Intra-run cluster lock: at most ONE approve per (primary key) cluster. Keep
// the oldest approve (candidates are oldest-first), supersede the rest — even
// when none is live yet. Closes the duplicate-approve hole the DB index misses
// for '|unknown|unknown' / title-fallback keys.
const clusterWinner = new Map();
for (const d of decisions) {
  if (d.decision !== "approve") continue;
  const k = d.key;
  if (clusterWinner.has(k)) {
    d.decision = "supersede";
    d.supersededBy = clusterWinner.get(k);
    d.intraRunWinner = d.supersededBy; // canonical is a THIS-RUN winner, not a live campaign
    d.reason = `auto-deduped: intra-run cluster ${k} (canonical=${shortId(d.supersededBy)})`;
  } else {
    clusterWinner.set(k, d.c.id);
  }
}

// ── 9. Circuit breaker (before any live write) ────────────────────────────────
const wouldApprove = decisions.filter((d) => d.decision === "approve");
const breakerTripped = LIVE && (wouldApprove.length > P.maxPerRun || wouldApprove.length > candidates.length * 0.5);
if (breakerTripped) {
  console.log(`  ⚠ CIRCUIT BREAKER: ${wouldApprove.length} would-approve of ${candidates.length} candidates — flipping to shadow, NOT applying.`);
  try { await sb.from("site_config").update({ campaign_auto_approve_mode: "shadow" }).eq("id", cfg?.id ?? true); } catch { /* best-effort */ }
  mode = "shadow"; // reflect the degraded mode in this run's ledger + telemetry
}
let applyLive = LIVE && !breakerTripped;

// One kill-switch re-read before applying. A mid-run flip during the few seconds
// this loop runs is rare, and every write is independently race-guarded on
// review_state='pending_review' — so a single pre-loop check is sufficient.
if (applyLive) {
  const { data: ks } = await sb
    .from("site_config")
    .select("emergency_mode, read_only_mode, campaign_auto_approve_mode, campaign_auto_approve_enabled")
    .eq("id", cfg?.id ?? true)
    .maybeSingle();
  if (ks?.emergency_mode || ks?.read_only_mode || ks?.campaign_auto_approve_mode !== "live" || !ks?.campaign_auto_approve_enabled) {
    applyLive = false;
    mode = "shadow";
    console.log("  kill-switch engaged — shadow-logging only this run");
  }
}
const appliedApprovals = new Set(); // campaign ids that ACTUALLY went active this run

// ── 10. Apply + ledger ────────────────────────────────────────────────────────
const tally = { approve: 0, supersede: 0, reject: 0, escalate: 0, applied: 0, capped: 0 };
let approvedThisRun = 0;

for (const d of decisions) {
  let decision = d.decision;

  // Caps: an approve that would breach the per-run OR rolling-24h cap → ESCALATE.
  if (decision === "approve" && applyLive) {
    if (approvedThisRun >= P.maxPerRun || approvedLast24 + approvedThisRun >= P.maxPerDay) {
      decision = "escalate";
      d.reason = `cap reached (run ${approvedThisRun}/${P.maxPerRun}, 24h ${approvedLast24 + approvedThisRun}/${P.maxPerDay}) — escalated`;
      tally.capped++;
    }
  }

  // Orphan-supersede guard: a sibling whose intra-run cluster WINNER did not
  // actually go active this run (winner got capped/escalated, or lost the race
  // to a human) must NOT be superseded toward a non-live row — that would bury a
  // real CTA behind a dangling superseded_by. Escalate it for human review.
  if (decision === "supersede" && d.intraRunWinner && applyLive && !appliedApprovals.has(d.intraRunWinner)) {
    decision = "escalate";
    d.reason = `cluster winner ${shortId(d.intraRunWinner)} not approved this run — escalating instead of orphan-superseding`;
  }

  d.decision = decision;
  tally[decision] = (tally[decision] ?? 0) + 1;
  const label = `${d.c.id.slice(0, 8)} ${decision.toUpperCase().padEnd(9)} ${(d.c.title ?? "").slice(0, 46)} — ${d.reason}`;

  if (!applyLive) {
    // shadow / dry-run: log + ledger only, never a state change.
    console.log(`  ${DRY ? "[dry] " : ""}${label}`);
    await ledger(d, mode, false);
    continue;
  }

  // live: apply the transition (reject only if separately enabled).
  let applied = false;
  if (decision === "approve") {
    applied = await transition(d.c.id, { ...APPROVE_COLUMNS, reviewed_at: nowIso(), reviewed_by: null, review_reason: d.reason });
    if (applied) { approvedThisRun++; appliedApprovals.add(d.c.id); await audit("campaign_auto_approved", d); }
    else d.signals = { ...(d.signals ?? {}), raceLostToHuman: true };
  } else if (decision === "supersede") {
    applied = await transition(d.c.id, { ...SUPERSEDE_COLUMNS, reviewed_at: nowIso(), reviewed_by: null, review_reason: d.reason, superseded_by: d.supersededBy ?? null });
    if (applied) await audit("campaign_auto_superseded", d);
    else d.signals = { ...(d.signals ?? {}), raceLostToHuman: true };
  } else if (decision === "reject" && (P.rejectEnabled || d.signals?.safeReject)) {
    applied = await transition(d.c.id, { ...REJECT_COLUMNS, reviewed_at: nowIso(), reviewed_by: null, review_reason: d.reason });
    if (applied) await audit("campaign_auto_rejected", d);
    else d.signals = { ...(d.signals ?? {}), raceLostToHuman: true };
  }
  if (applied) tally.applied++;
  console.log(`  ${applied ? "✓" : "·"} ${label}`);
  await ledger(d, mode, applied);
}

console.log(
  `\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
  `approve=${tally.approve} supersede=${tally.supersede} reject=${tally.reject} escalate=${tally.escalate} ` +
  `· applied=${tally.applied} capped=${tally.capped}${breakerTripped ? " · BREAKER TRIPPED" : ""}`,
);
await tag(tally.applied > 0 || mode === "shadow" ? "success" : "empty", tally.applied,
  `mode=${mode} approve=${tally.approve} supersede=${tally.supersede} reject=${tally.reject} escalate=${tally.escalate} applied=${tally.applied}${breakerTripped ? " BREAKER" : ""}`);

// ════════════════════════════════════════════════════════════════════════════
// decision logic
// ════════════════════════════════════════════════════════════════════════════
function decide(c) {
  const key = primaryKey(c);
  const sig = {};
  const alert = alertByCampaign.get(c.id);

  // HARD PRECONDITION: a candidate with no resolvable policy_alert is one the
  // engine is blind to — never synthesize confidence from title alone.
  if (!alert) return { decision: "escalate", score: null, reason: "no linked policy_alert resolved — needs human eyes", signals: { ...sig, noAlert: true }, key };
  sig.kind = alert.kind; sig.severity = alert.severity;

  // STRUCTURED concluded-bill veto: resolve the linked bill (campaign OR alert
  // bill_id). If it is already enacted / dead / chaptered / in force, the event
  // is moot — emailing officials to oppose a concluded measure is not a live
  // CTA. Driven by bill status + official last_action, NEVER the news headline
  // (a title regex would bury the veto-push window we keep actionable).
  const linkedBillId = c.bill_id ?? alert.bill_id ?? null;
  const linkedBill = linkedBillId ? billById.get(linkedBillId) : null;
  if (linkedBill && isBillConcluded(linkedBill)) {
    return veto(c, key, { ...sig, billConcluded: true, billStatus: linkedBill.status, lastAction: linkedBill.last_action ?? null }, "linked bill already concluded (enacted/chaptered/in force) — moot", true);
  }

  // ELIGIBILITY (the primary categorical gate for ~100% of the backlog). Auto-
  // reject is SAFE only for categorical junk (recall/lawsuit/enforcement news,
  // ag_enforcement, concluded); ambiguous agency news escalates (eligibilityVetoSafe).
  if (!isCampaignWorthyAlert(alert.kind, alert.title)) {
    return veto(c, key, sig, "alert not campaign-worthy (procedural / concluded / recall / lawsuit / news)", eligibilityVetoSafe(alert.kind, alert.title));
  }

  // DEDUP vs live/pending canonical → supersede (sends nothing; safe).
  for (const k of keysFor(c.state, c.title)) {
    if (occupied.has(k)) {
      return { decision: "supersede", score: null, supersededBy: occupied.get(k), reason: `auto-deduped: duplicate of live campaign (cluster ${k}, canonical=${shortId(occupied.get(k))})`, signals: { ...sig, dupKey: k }, key };
    }
  }

  // SOURCE requirement.
  if (P.requireSource && !alert.source_url) {
    return { decision: "escalate", score: null, reason: "no source_url on linked alert (require_source on)", signals: { ...sig, noSource: true }, key };
  }

  // FP signal (RSS false positive). false -> veto; null -> wait (within grace) or
  // proceed-unverified (past grace, so a never-classifiable source can't trap a
  // genuine CTA in "waiting" forever); true -> pass. See fpGateDecision.
  if (alert.source_url && fpByUrl.has(alert.source_url)) {
    const fp = fpByUrl.get(alert.source_url);
    sig.body_has_kratom_keyword = fp;
    const fpAgeH = (now - new Date(c.created_at).getTime()) / 3_600_000;
    const fpd = fpGateDecision(fp, fpAgeH, FP_STALE_GRACE_HOURS);
    if (fpd === "block") return veto(c, key, sig, "linked news item flagged not-about-kratom (RSS false positive)");
    if (fpd === "wait") return { decision: "escalate", score: null, reason: `kratom-keyword check not yet run on the source article — waiting (${Math.floor(fpAgeH)}h < ${FP_STALE_GRACE_HOURS}h grace)`, signals: { ...sig, fpPending: true }, key };
    if (fp === null) sig.fpStale = true; // passed only because the grace window elapsed — FP-unverified
  } else if (alert.source_url) {
    // Couldn't join the source URL to a news_items row (e.g. an unresolved
    // Google-News redirect). The FP check did NOT run — flag it so the owner can
    // see which approvals lacked an FP verification when reviewing the ledger.
    sig.fpJoinMissed = true;
  }

  // LOCALITY negative veto (alert-born only; title/source text, not the AI body).
  // SKIPPED for genuinely-federal campaigns: a federal kratom campaign correctly
  // has state=null + an "FDA"/"DEA" title, which reconcileLocality would otherwise
  // flag as "wrong-state: title names FED but campaign is null" — a FALSE veto that
  // blocked every national 7-OH CTA from ever approving. federalTopicKey is the
  // same guard the dedup uses (federal/national + federal signal + kratom + event).
  const isFederalCampaign = !!federalTopicKey(c.state, alert.title);
  sig.federal = isFederalCampaign;
  if (!linkedBillId && !isFederalCampaign) {
    const rec = reconcileLocality({ aiLocality: c.state, text: alert.title });
    sig.locality = { claim: c.state, corroborated: rec.corroborated, named: rec.locality };
    if (rec.corroborated === false) return veto(c, key, sig, `wrong-state: title names ${rec.locality} but campaign is ${c.state}`);
  }

  // TARGETING completeness. Empty ids = local_pending (or unseeded) → wait for
  // seed-bill-officials to fill targets. bop_hearing is exempt (uses board
  // contact, not legislator ids).
  const hasTargets = Array.isArray(c.target_legislator_ids) && c.target_legislator_ids.length > 0;
  if (!hasTargets && alert.kind !== "bop_hearing") {
    return { decision: "escalate", score: null, reason: "no legislator targets yet (local_pending / unseeded) — waiting for officials", signals: { ...sig, noTargets: true }, key };
  }

  // MATURITY: let the DAILY FP/locality janitors settle before approving.
  const ageHours = (now - new Date(c.created_at).getTime()) / 3_600_000;
  sig.ageHours = Math.floor(ageHours);
  if (ageHours < P.minAgeHours) {
    return { decision: "escalate", score: null, reason: `too new (${Math.floor(ageHours)}h < ${P.minAgeHours}h) — letting daily sweep settle`, signals: { ...sig, tooNew: true }, key };
  }

  // BILL-LINKED gate (replicates auto-create.ts so approve is never looser than
  // create). Uses the bill resolved above (campaign OR alert bill_id). The
  // concluded check already ran; this layer adds confidence / freshness / leaf-
  // target gates.
  if (linkedBillId) {
    const b = linkedBill;
    if (!b) return { decision: "escalate", score: null, reason: "bill-linked but bill not found — escalate", signals: { ...sig, billMissing: true }, key };
    const conf = b.relevance_confidence ?? 0;
    sig.relevance_confidence = conf;
    const staleCut = new Date(now - STALE_SESSION_DAYS * 86400_000).toISOString().slice(0, 10);
    const fresh = (b.last_action_at ?? "") >= staleCut;
    const liveStatus = !["enacted", "dead"].includes(String(b.status ?? ""));
    const syntheticOnly = b.targets_synthetic_only === true && b.targets_natural_leaf === false;
    const deepOk = b.deep_analyzed_at === null || b.targets_natural_leaf === true;
    if (syntheticOnly) return veto(c, key, sig, "bill targets synthetics only — not an anti-leaf campaign");
    if (!liveStatus) return veto(c, key, sig, `bill status '${b.status}' (enacted/dead) — moot`, true);
    if (!fresh) return { decision: "escalate", score: conf, reason: "bill from a closed/stale session — escalate", signals: { ...sig, stale: true }, key };
    if (conf < P.minConf || !deepOk) return { decision: "escalate", score: conf, reason: `bill confidence ${conf} < ${P.minConf} or deep-analysis ambiguous — escalate`, signals: sig, key };
  }

  // PASSED every gate.
  return { decision: "approve", score: linkedBill?.relevance_confidence ?? null, reason: `eligible ${alert.kind}/${alert.severity}, sourced, targeted, non-duplicate, mature (${sig.ageHours}h)`, signals: sig, key };
}

// A hard veto. `safe=true` marks CATEGORICAL junk (recall/lawsuit/enforcement
// news, ag_enforcement, already-concluded events, enacted/dead bills) that can
// never be a CTA — those auto-REJECT in live mode regardless of the broad
// campaign_auto_reject_enabled flag, so they stop piling into a manual queue.
// `safe=false` (the asymmetric-risk cases: wrong-state, FP, synthetic-only,
// low-confidence) only rejects when the owner has enabled broad reject; otherwise
// it ESCALATES — never bury a possibly-real CTA.
function veto(c, key, signals, reason, safe = false) {
  const willReject = safe || P.rejectEnabled;
  return {
    decision: willReject ? "reject" : "escalate",
    score: null,
    reason: (willReject ? "" : "(reject disabled→escalate) ") + reason,
    signals: { ...signals, veto: true, ...(safe ? { safeReject: true } : {}) },
    key,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// helpers
// ════════════════════════════════════════════════════════════════════════════
// Conservative dedup keys: a candidate is a duplicate only if it shares a STRONG
// topic key (state + kratom keyword + a SPECIFIC policy event) OR a near-identical
// title with another campaign. This avoids over-collapsing distinct events that
// merely share a generic word — a wrong supersede silently buries a real CTA.
function keysFor(state, title) {
  // A bill number is the strongest cluster signal: every procedural step of one
  // bill collapses to a single campaign.
  const bk = billKey(state, title);
  if (bk) return [bk];
  const keys = [normalizedTitleKey(title)];
  const sk = strongTopicKey(state, title);
  if (sk) keys.push(sk);
  // Coarse federal key: collapses the national FDA/DEA 7-OH push (reported with
  // varying verbs/keywords) into ONE canonical campaign instead of one-per-headline.
  const fk = federalTopicKey(state, title);
  if (fk) keys.push(fk);
  return [...new Set(keys)];
}
function primaryKey(c) {
  return billKey(c.state, c.title) ?? federalTopicKey(c.state, c.title) ?? strongTopicKey(c.state, c.title) ?? normalizedTitleKey(c.title);
}
function shortId(id) { return id ? String(id).slice(0, 8) : "?"; }
function nowIso() { return new Date().toISOString(); }

async function transition(id, patch) {
  const { data, error } = await sb
    .from("campaigns")
    .update(patch)
    .eq("id", id)
    .eq("review_state", "pending_review") // race guard: only pending rows
    .select("id");
  if (error) { console.log(`     ⚠ transition failed ${id.slice(0, 8)}: ${error.message?.slice(0, 80)}`); return false; }
  return (data?.length ?? 0) > 0; // affected=0 = already handled by a human, not an error
}

async function audit(action, d) {
  try {
    await sb.from("admin_audit_log").insert({
      actor_id: null, // system action
      action,
      target_type: "campaign",
      target_id: d.c.id,
      details: { decision: d.decision, score: d.score ?? null, reason: d.reason, signals: d.signals ?? {}, mode },
    });
  } catch { /* audit is best-effort, never blocks a decision */ }
}

async function ledger(d, modeAtDecision, applied) {
  if (DRY) return; // --dry-run is fully read-only: print decisions, write nothing
  try {
    await sb.from("campaign_auto_approve_decisions").insert({
      campaign_id: d.c.id,
      mode: modeAtDecision,
      decision: d.decision,
      score: d.score ?? null,
      signals: d.signals ?? {},
      review_reason: d.reason,
      applied: !!applied,
    });
  } catch (e) { /* best-effort; the run still proceeds */ }
}

async function tag(status, applied, notes) {
  if (DRY) return;
  try {
    await sb.from("scraper_runs").insert({
      source: "auto_approve_campaigns",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status,
      rows_updated: applied,
      notes: notes ?? `mode=${mode}`,
    });
  } catch { /* best-effort */ }
}
