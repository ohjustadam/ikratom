#!/usr/bin/env node
/**
 * Intel step 2 (private/plans/INTEL_DEEPER_PLAN.md): playbook-match alerts.
 * The same restriction travels state to state. When a live restrictive bill
 * takes the same approach as a bill in another state, advocates can use the
 * earlier state's outcome, testimony and vote as their playbook.
 *
 * For each restrictive (kratom_relevance='anti'), still-moving state bill that
 * was filed or acted on in the window (NOT embedded_at: a corpus rebuild resets
 * it on every bill, and would alert on sessions that ended months ago), ask similar_bills() for its closest
 * other-state match. One at >= MIN_SIM becomes a neutral 'watch' alert in the
 * intel review queue (moderation 'pending', action_required false, so it never
 * spawns a campaign and never publishes without a review).
 *
 * Calibration (2026-10-23, Cloudflare bge-base over title + summary): any two
 * restrictive kratom bills score ~0.75 just for sharing a topic; 0.85 is the
 * top 1% of cross-state pairs, 0.88 the top ~0.1%. These vectors encode the
 * APPROACH ("add kratom to Schedule I"), not the bill text, so the alert says
 * "takes the same approach", never "copies".
 *
 *   node --env-file=.env.local scripts/playbook-match-alerts.mjs             # dry run
 *   node --env-file=.env.local scripts/playbook-match-alerts.mjs --apply --days 3
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DAYS = parseInt(arg("--days", "3"), 10);
const MIN_SIM = parseFloat(arg("--min-sim", "0.88"));
const MAX_ALERTS = parseInt(arg("--max", "10"), 10);
const TITLE_PREFIX = "Playbook match:";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const t0 = Date.now();
const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

// Stub rows minted from news coverage carry no real title or summary; their
// vectors match each other on boilerplate, not substance.
const isStub = (b) => /auto-extracted from/i.test(b.title ?? "");
const LIVE = (s) => !["enacted", "dead", "vetoed", "failed"].includes(String(s ?? ""));
const label = (b) => `${b.state} ${b.bill_number}`;
const outcome = (b) => (b.status === "enacted" ? "enacted" : b.status === "dead" ? "died" : `status: ${String(b.status ?? "pending").replace(/_/g, " ")}`);

const { data: fresh, error } = await sb.from("bills")
  .select("id, state, bill_number, title, status, active, official_url, source_url, last_action_at, created_at, session_sine_die")
  .eq("active", true)
  .eq("kratom_relevance", "anti")
  .not("embedding_f8", "is", null)
  .neq("scope", "local")
  .or(`created_at.gte.${since},last_action_at.gte.${since.slice(0, 10)}`)
  .limit(500);
if (error) throw new Error(`bills read failed: ${error.message}`);

const candidates = (fresh ?? []).filter((b) => LIVE(b.status) && !b.session_sine_die && !isStub(b) && /^[A-Z]{2}$/.test(b.state));
console.log(`${candidates.length} live restrictive bill(s) to match (window ${DAYS}d, threshold ${MIN_SIM}).`);

let created = 0, skipped = 0;
for (const b of candidates) {
  if (created >= MAX_ALERTS) break;
  const { data: matches, error: mErr } = await sb.rpc("similar_bills", { p_bill_id: b.id, p_limit: 5, p_min_similarity: MIN_SIM });
  if (mErr) { console.log(`  ✗ ${label(b)}: ${mErr.message}`); continue; }
  const m = (matches ?? []).find((x) => x.kratom_relevance === "anti" && !isStub(x));
  if (!m) continue;

  const { count } = await sb.from("policy_alerts").select("id", { count: "exact", head: true })
    .eq("bill_id", b.id).ilike("title", `${TITLE_PREFIX}%`);
  if ((count ?? 0) > 0) { skipped++; continue; }

  const pct = Math.round(m.similarity * 100);
  const title = `${TITLE_PREFIX} ${label(b)} takes the same approach as ${label(m)} (${outcome(m)})`;
  const body = [
    `${label(b)}: ${b.title}`,
    `${label(m)}: ${m.title} (${outcome(m)}${m.last_action_at ? `, last action ${m.last_action_at}` : ""}).`,
    "",
    `The two bills' titles and summaries are ${pct}% similar, which is rare even among kratom bills (most pairs score about 75%). This compares what the bills do, not their exact wording, so read both texts before relying on it.`,
    "",
    `What happened to ${label(m)} (its hearings, votes and testimony) shows how the same proposal played out in ${m.state}.`,
    `Source: ${b.official_url || b.source_url || "(no official link)"}`,
  ].join("\n");

  console.log(`  ${APPLY ? "+" : "~"} ${title} [${pct}%]`);
  if (!APPLY) { created++; continue; }
  const { error: insErr } = await sb.from("policy_alerts").insert({
    kind: "bill_event",
    severity: "watch",
    title: title.slice(0, 300),
    body,
    locality: b.state,
    bill_id: b.id,
    source_url: b.official_url || b.source_url || null,
    moderation_status: "pending",
    action_required: false,
  });
  if (insErr) console.log(`    ✗ insert failed: ${insErr.message}`);
  else created++;
}

console.log(`\n${APPLY ? "Created" : "Would create"} ${created} alert(s); ${skipped} already alerted.`);
try {
  await sb.from("scraper_runs").insert({
    source: "playbook_match_alerts",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: created > 0 ? "success" : "empty",
    rows_added: APPLY ? created : 0,
    notes: `${APPLY ? "apply" : "dry"}: ${candidates.length} candidates · ${created} new · ${skipped} already alerted · min_sim ${MIN_SIM}`,
  });
} catch { /* best-effort */ }
