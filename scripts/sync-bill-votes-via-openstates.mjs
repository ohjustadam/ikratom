/**
 * Pull roll-call vote data into bill_votes + bill_vote_members via
 * OpenStates v3 — the fallback for when LEGISCAN_API_KEY isn't set
 * in CI yet.
 *
 * Honest scope caveat: OpenStates free tier is 250 requests/day.
 * Our existing pipelines (sync-committees-openstates.mjs widened to
 * --all-states, plus the bill enrichment) already use a meaningful
 * chunk of that. This script is therefore deliberately rate-limited
 * to ~50 bills per day so it can chip away at the backlog without
 * starving the other jobs. At ~50/day for 467 active bills, a full
 * backfill takes ~10 days. Steady state after that is cheap (only
 * new bills + bills with new activity).
 *
 * When LEGISCAN_API_KEY does arrive, the LegiScan script (which can
 * do all 467 in a single run inside its much larger ~1000/day quota)
 * takes over. This OpenStates fallback then becomes a redundancy
 * layer — both scripts write to the same bill_votes + bill_vote_members
 * tables via idempotent UPSERT on the same UNIQUE keys.
 *
 * OpenStates v3 vote schema (per their docs + live-probed response):
 *   bill.votes[] = {
 *     identifier, motion_text, motion_classification,
 *     start_date, result, organization: {classification: 'lower'|'upper'},
 *     counts: [{option, value}],   // 'yes' | 'no' | 'abstain' | etc.
 *     votes:  [{voter_name, option, voter: {id}}],
 *     sources: [{url}],
 *   }
 *
 * We map this onto the existing schema:
 *   bill_votes:        one row per OpenStates vote object
 *   bill_vote_members: one row per voter_name in vote.votes[]
 *
 * Idempotency:
 *   - bill_votes uses (bill_id, legiscan_roll_call_id) as the conflict
 *     key. We don't have a legiscan_roll_call_id for OpenStates votes,
 *     so we synthesize one from the OpenStates vote identifier hash.
 *     That keeps both sources non-conflicting if both run.
 *   - bill_vote_members uses (bill_vote_id, legiscan_people_id). We
 *     don't have legiscan_people_id for OpenStates voters either, so
 *     we map voter_name to legislators via our existing full_name
 *     matching and leave legiscan_people_id NULL.
 *
 * Usage:
 *   node --env-file=.env.local scripts/sync-bill-votes-via-openstates.mjs
 *   node --env-file=.env.local scripts/sync-bill-votes-via-openstates.mjs --limit 5
 *   node --env-file=.env.local scripts/sync-bill-votes-via-openstates.mjs --bill <uuid>
 *   node --env-file=.env.local scripts/sync-bill-votes-via-openstates.mjs --dry-run
 *
 * Flags:
 *   --limit N      max bills per run (default 50; tune down if OS quota tight)
 *   --bill <uuid>  process just this bill (debug / targeted backfill)
 *   --dry-run      fetch + parse but don't write
 *   --force        re-process bills that already have votes (default: skip)
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (n, fallback = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fallback; };
const flag = (n) => args.includes(n);

const LIMIT = parseInt(arg("--limit", "50"), 10);
const SPECIFIC = arg("--bill");
const DRY_RUN = flag("--dry-run");
const FORCE = flag("--force");

const OPENSTATES_KEY = process.env.OPENSTATES_API_KEY;
if (!OPENSTATES_KEY) {
  console.log("OPENSTATES_API_KEY not set — skipping");
  process.exit(0);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================================
// Synthesize a stable integer "roll_call_id" from the OpenStates
// vote identifier so it doesn't collide with LegiScan numeric IDs.
// LegiScan IDs are real positive integers; we negate the hash to
// guarantee they don't clash. Same identifier → same synthetic ID,
// keeping UPSERT idempotent across runs.
// =============================================================
function synthesizeRollCallId(opensStatesVoteIdentifier) {
  if (!opensStatesVoteIdentifier) return null;
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < opensStatesVoteIdentifier.length; i++) {
    h ^= opensStatesVoteIdentifier.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Bring into signed 31-bit range, then negate so OpenStates IDs
  // are always negative (LegiScan-source IDs are always positive).
  const positive = (h >>> 0) % 2_000_000_000;
  return -1 * (positive + 1);
}

function parseDate(s) {
  if (!s) return null;
  // OpenStates uses 'YYYY-MM-DD' for start_date; pass through.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function chamberFromOrg(org) {
  // OpenStates classifies as 'lower' / 'upper' / 'legislature'.
  const cls = (org?.classification ?? "").toLowerCase();
  if (cls === "lower") return "House";
  if (cls === "upper") return "Senate";
  return org?.name ?? null;
}

function countOption(counts, option) {
  const row = (counts ?? []).find(c => (c.option ?? "").toLowerCase() === option);
  return row?.value ?? 0;
}

// =============================================================
// Fetch one bill's vote data from OpenStates.
// We look up by (state, session_id, bill_number). All three are in
// our bills table.
// =============================================================
async function fetchVotesForBill(bill) {
  // OpenStates expects URL-encoded bill identifier with internal
  // spaces preserved ("S 221" → "S%20221"). The session is the
  // bill's session_id. State is lower-cased 2-letter.
  const state = bill.state.toLowerCase();
  const session = bill.session_id ?? "";
  if (!session) return { skipped: "no session_id" };
  const identifier = encodeURIComponent(bill.bill_number);
  const url = `https://v3.openstates.org/bills/${state}/${encodeURIComponent(session)}/${identifier}?include=votes`;
  const res = await fetch(url, {
    headers: { "X-API-Key": OPENSTATES_KEY },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 429) {
    return { rateLimited: true };
  }
  if (res.status === 404) {
    return { notFound: true };
  }
  if (!res.ok) {
    return { error: `OpenStates ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }
  const data = await res.json();
  return { votes: data?.votes ?? [] };
}

// =============================================================
// Write votes + member rows for one bill, idempotently.
// =============================================================
async function persistVotes(bill, votes) {
  if (votes.length === 0) return { ok: true, voteRows: 0, memberRows: 0 };

  // Map OpenStates vote objects → bill_votes rows
  const voteRows = votes.map(v => {
    const rcId = synthesizeRollCallId(v.identifier ?? `${bill.id}-${v.motion_text}-${v.start_date}`);
    const yea = countOption(v.counts, "yes");
    const nay = countOption(v.counts, "no");
    const other = (v.counts ?? []).reduce((a, c) => a + (c.value ?? 0), 0) - yea - nay;
    const passed = v.result?.toLowerCase() === "pass" || v.result?.toLowerCase() === "passed";
    return {
      bill_id: bill.id,
      legiscan_roll_call_id: rcId,           // negative = OpenStates source
      vote_date: parseDate(v.start_date),
      chamber: chamberFromOrg(v.organization),
      motion: String(v.motion_text ?? "").slice(0, 500),
      motion_id: null,                        // OpenStates doesn't expose one
      yea_count: Number(yea ?? 0),
      nay_count: Number(nay ?? 0),
      nv_count: countOption(v.counts, "not voting"),
      absent_count: countOption(v.counts, "absent"),
      total_count: (v.votes ?? []).length,
      passed,
      source: "openstates",
      raw_json: v,
      synced_at: new Date().toISOString(),
    };
  });

  if (DRY_RUN) {
    return { ok: true, voteRows: voteRows.length, memberRows: votes.reduce((a, v) => a + (v.votes?.length ?? 0), 0), dryRun: true };
  }

  const { data: inserted, error: vErr } = await sb
    .from("bill_votes")
    .upsert(voteRows, { onConflict: "bill_id,legiscan_roll_call_id" })
    .select("id, legiscan_roll_call_id");
  if (vErr) return { ok: false, error: `bill_votes write: ${vErr.message?.slice(0, 200)}` };

  // Map inserted rows back to OpenStates vote objects by roll_call_id
  // so we can attach members to the right bill_votes row.
  const idByRollCall = new Map();
  for (const r of inserted ?? []) idByRollCall.set(r.legiscan_roll_call_id, r.id);

  // For each OpenStates vote, look up its members and resolve voter
  // names against our legislators table (state-scoped to reduce
  // false matches on common names).
  const allMemberRows = [];
  // Pull legislators for this state once
  const { data: legs } = await sb
    .from("legislators")
    .select("id, full_name")
    .eq("state", bill.state)
    .eq("active", true);
  const legByLower = new Map();
  for (const l of legs ?? []) legByLower.set((l.full_name ?? "").toLowerCase().trim(), l.id);

  for (const v of votes) {
    const billVoteId = idByRollCall.get(synthesizeRollCallId(v.identifier ?? `${bill.id}-${v.motion_text}-${v.start_date}`));
    if (!billVoteId) continue;
    for (const member of (v.votes ?? [])) {
      const name = (member.voter_name ?? "").trim();
      if (!name) continue;
      // OpenStates voter_name is usually "Last, First" or "First Last".
      // Try both.
      const lower = name.toLowerCase();
      let legId = legByLower.get(lower) ?? null;
      if (!legId && lower.includes(",")) {
        const [last, first] = lower.split(",", 2).map(s => s.trim());
        legId = legByLower.get(`${first} ${last}`) ?? null;
      }
      allMemberRows.push({
        bill_vote_id: billVoteId,
        legislator_id: legId,
        legiscan_people_id: null,            // not from LegiScan
        legislator_name: name.slice(0, 200),
        vote_text: String(member.option ?? "").slice(0, 30),
        vote_value: optionToCode(member.option),
      });
    }
  }

  if (allMemberRows.length === 0) return { ok: true, voteRows: voteRows.length, memberRows: 0 };

  // bill_vote_members has UNIQUE(bill_vote_id, legiscan_people_id) but
  // we set people_id=null for OS-sourced rows. The UNIQUE allows
  // multiple NULL on Postgres so this works — each OS member becomes
  // a fresh row. The defensive approach is to delete existing OS rows
  // for this bill_vote and re-insert, since re-running shouldn't
  // create duplicates.
  const billVoteIds = [...idByRollCall.values()];
  if (billVoteIds.length > 0) {
    await sb.from("bill_vote_members").delete().in("bill_vote_id", billVoteIds).is("legiscan_people_id", null);
  }
  const { error: mErr } = await sb.from("bill_vote_members").insert(allMemberRows);
  if (mErr) return { ok: false, error: `bill_vote_members write: ${mErr.message?.slice(0, 200)}` };
  return { ok: true, voteRows: voteRows.length, memberRows: allMemberRows.length };
}

function optionToCode(opt) {
  switch ((opt ?? "").toLowerCase()) {
    case "yes": return 1;
    case "no": return 2;
    case "not voting": return 3;
    case "absent": return 4;
    default: return 0;
  }
}

// =============================================================
// Main: pick the next N bills with no vote data and process them.
// =============================================================
let bills;
if (SPECIFIC) {
  const { data } = await sb.from("bills").select("id, state, bill_number, session_id").eq("id", SPECIFIC).single();
  bills = data ? [data] : [];
} else {
  // Active bills that don't have any bill_votes rows yet (when --force isn't set).
  // We can't directly LEFT JOIN in PostgREST, so we do two queries.
  const { data: allBills } = await sb
    .from("bills")
    .select("id, state, bill_number, session_id")
    .eq("active", true)
    .in("kratom_relevance", ["anti", "pro"])
    .not("session_id", "is", null)
    .order("last_action_at", { ascending: false, nullsFirst: false });
  if (!FORCE) {
    const { data: alreadyHaveVotes } = await sb
      .from("bill_votes")
      .select("bill_id")
      .range(0, 9999);
    const haveSet = new Set((alreadyHaveVotes ?? []).map(r => r.bill_id));
    bills = (allBills ?? []).filter(b => !haveSet.has(b.id)).slice(0, LIMIT);
  } else {
    bills = (allBills ?? []).slice(0, LIMIT);
  }
}

if (bills.length === 0) {
  console.log("No bills need vote sync. Done.");
  process.exit(0);
}

console.log(`Syncing votes for ${bills.length} bill(s) via OpenStates${DRY_RUN ? " (DRY RUN)" : ""}…`);

let ok = 0, fail = 0, noVotes = 0, quotaHit = false;
for (let i = 0; i < bills.length; i++) {
  const b = bills[i];
  process.stdout.write(`  [${i + 1}/${bills.length}] ${b.state} ${b.bill_number}… `);

  const fetch_r = await fetchVotesForBill(b);
  if (fetch_r.rateLimited) {
    console.log("RATE LIMITED — stopping early so we don't burn quota");
    quotaHit = true;
    break;
  }
  if (fetch_r.notFound) { console.log("not found in OpenStates"); fail++; continue; }
  if (fetch_r.error) { console.log(`FAIL: ${fetch_r.error}`); fail++; continue; }
  if (fetch_r.skipped) { console.log(`skip (${fetch_r.skipped})`); continue; }

  const votes = fetch_r.votes;
  if (votes.length === 0) { console.log("no votes recorded"); noVotes++; continue; }

  const persist_r = await persistVotes(b, votes);
  if (!persist_r.ok) { console.log(`FAIL: ${persist_r.error}`); fail++; continue; }
  console.log(`✓ ${persist_r.voteRows} vote(s), ${persist_r.memberRows} member rows${persist_r.dryRun ? " (dry)" : ""}`);
  ok++;

  // Polite delay — OpenStates docs ask for ≤ 1 req/sec on free tier.
  await new Promise(r => setTimeout(r, 1500));
}

console.log(`\nDone. ok=${ok}, no-votes=${noVotes}, fail=${fail}, rate-limited=${quotaHit}`);
if (quotaHit) {
  console.log(`Stopped early due to OpenStates rate limit. Rerun tomorrow; idempotent on already-synced bills.`);
}
