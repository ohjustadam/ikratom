#!/usr/bin/env node
/**
 * Layer 2 of the real-time pipeline: LegiScan primary sync.
 *
 * Why: OpenStates lags real legislative action by days. LegiScan
 * updates within hours for most states. We use OpenStates for breadth
 * (uniform coverage) and LegiScan for speed.
 *
 * What this does:
 *   1. For each active anti/pro state bill, look up the LegiScan
 *      bill ID by (state, bill_number) if we don't have it cached.
 *   2. Fetch full bill data: getBill returns actions, votes, sponsors,
 *      texts, status.
 *   3. Write each action into bill_actions (deduped by unique
 *      constraint). The migration-0076 trigger then fires for new
 *      rows, auto-spawning policy_alerts for critical actions.
 *   4. Reconcile status: if LegiScan says signed/passed/dead and our
 *      DB still says introduced, update the bill row.
 *   5. Record the LegiScan bill ID into bills.legiscan_bill_id so
 *      we don't re-search on next run.
 *
 * BUDGET (rewritten 2026-10-28). The free key allows 10,000 queries a
 * calendar month, not the 30,000 this header used to claim. Fetching every
 * tracked bill in full on every run (30 bills every 2h + ~200 bills twice a
 * day) needed ~25,000 and ran October dry on the 28th. Now:
 *   - one getMasterListRaw per state (one query) gives every bill's
 *     change_hash; getBill runs only for bills whose hash moved
 *     (bills.legiscan_change_hash, migration 0299);
 *   - a bill missing from its state's current session list that we have
 *     synced before is final and costs nothing;
 *   - a bill LegiScan can't find is searched again weekly, not every run;
 *   - --priority covers only states whose legislature is in session and
 *     skips itself within --min-gap-hours of its last run;
 *   - every call is counted (scripts/lib/legiscan-budget.mjs) and the run
 *     stops at the month's essential ceiling (95% of 10,000).
 *
 * Run:
 *   node --env-file=.env.local scripts/sync-bills-via-legiscan.mjs --priority --min-gap-hours 6   # in-session states
 *   node --env-file=.env.local scripts/sync-bills-via-legiscan.mjs --all-anti                      # daily wide pass
 *   node --env-file=.env.local scripts/sync-bills-via-legiscan.mjs --bill <uuid>
 */
import { createClient } from "@supabase/supabase-js";
import { terminalStatusFromAction } from "./lib/bill-status.mjs";
import {
  createLegiscanClient, legiscanCallsThisMonth, remainingFor, changeHashesFromMasterList, planBill,
} from "./lib/legiscan-budget.mjs";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const KEY = process.env.LEGISCAN_API_KEY;
if (!KEY) {
  // Cron-friendly: exit 0 with a no-op log so the workflow step stays
  // green. The moment a key lands in env, the script lights up.
  console.log("LEGISCAN_API_KEY not set — skipping (set it in .env.local + Vercel to enable)");
  try {
    const { createClient: _cc } = await import("@supabase/supabase-js");
    const _sb = _cc(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    await _sb.from("scraper_runs").insert({
      source: "sync_bills_legiscan_priority",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "empty",
      notes: "LEGISCAN_API_KEY not set",
    });
  } catch { /* best-effort */ }
  process.exit(0);
}

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const PRIORITY = args.includes("--priority");
const ALL_ANTI = args.includes("--all-anti");
const SPECIFIC = arg("--bill");
const DRY = args.includes("--dry-run");
// Wall-clock budget (uninterrupted-flow hardening, 2026-07-05): the daily
// --all-anti sweep can outgrow its CI step timeout as the corpus grows; a CI
// kill mid-loop skips the telemetry insert below and blinds the staleness
// monitor. Stop cleanly before the cap instead — the next daily run continues
// (bills are processed most-stale-first). 0/absent = unlimited (local runs).
const MAX_MINUTES = parseInt(arg("--max-minutes") ?? "0");
const MAX_RUN_MS = MAX_MINUTES > 0 ? MAX_MINUTES * 60_000 : Infinity;
// --priority runs from a 2-hourly cron; this makes it skip itself until N
// hours after its last finished run (0 = always run).
const MIN_GAP_HOURS = Number(arg("--min-gap-hours") ?? "0");
const SOURCE = PRIORITY ? "sync_bills_legiscan_priority" : "sync_bills_legiscan_all";

if (!PRIORITY && !ALL_ANTI && !SPECIFIC) {
  console.error("Usage: --priority | --all-anti | --bill <uuid>");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// LegiScan status code → our status string
// docs: https://legiscan.com/misc/LegiScan_API_User_Manual.pdf p.34
// LegiScan bill.status enum: 1=Introduced 2=Engrossed 3=Enrolled 4=Passed
// 5=Vetoed 6=Failed. CORRECTED 2026-07-16: the old map had 5→passed_chamber
// and 6→enacted — inverted vs the real enum, so a FAILED bill could be
// published as "became law" and (being terminal) never self-correct; a
// VETOED bill read as merely passed. Empirical anchor: enacted bills report
// code 4 with enactment only in the action text (see PR #729 / the override
// below), confirming 4=Passed-not-enacted and that no second "enacted" code
// exists. Codes 7-10 belong to LegiScan's progress-EVENT space, not
// bill.status — removed (they fall through to the action-text override).
// 2/3 (Engrossed/Enrolled) deliberately stay at the conservative
// "in_committee" floor to avoid an unreviewed mass status shift; the action
// text promotes them when it says so.
const STATUS_MAP = {
  1: "introduced",
  2: "in_committee",
  3: "in_committee",
  4: "passed_chamber",
  5: "vetoed",
  6: "dead",
};

// Counted client, created in main once the month's budget is known.
let client = null;
async function legiscanFetch(op, params) {
  return client.call(op, params ?? {});
}

/** Pull 4-digit years out of a stored session label ("2019-2020", "2023",
 *  "2017 Regular Session", even garbage like "1841"). */
function sessionYearsFromLabel(s) {
  const m = String(s ?? "").match(/(?:19|20)\d{2}/g);
  return m ? m.map(Number) : null;
}

/**
 * True when the LegiScan-resolved bill clearly belongs to a DIFFERENT
 * legislative session than the stored row. LegiScan search matches by
 * bill_number only, so "SB 433" can resolve to the CURRENT session's bill even
 * when this row is an old session — the Frankenstein-record bug (MI SB 433: a
 * 2019-2020 kratom row got 2025-2026 THC school-bill text + actions stapled on).
 * Precision over recall: when either side is unparseable we return false (don't
 * block a legitimate update).
 */
function isSessionMismatch(storedSessionId, detailSession) {
  const stored = sessionYearsFromLabel(storedSessionId);
  const dy = Number(detailSession?.year_start ?? detailSession?.year_end ?? 0);
  if (!stored || !dy) return false;
  if (stored.includes(dy)) return false;
  return Math.abs(dy - Math.max(...stored)) > 1;
}

async function findLegiScanId(bill) {
  // Use search to find bill by state + bill_number. LegiScan's search
  // is keyword-based; "state=TN bill_number=SB1656" works because
  // LegiScan's bill_number format is like "SB1656" (no space).
  const compactBillNum = bill.bill_number.replace(/\s+/g, "");
  const data = await legiscanFetch("getSearch", {
    state: bill.state,
    query: compactBillNum,
  });
  const results = data.searchresult ?? {};
  // Find an exact bill_number match
  for (const key of Object.keys(results)) {
    if (key === "summary") continue;
    const r = results[key];
    if (r.bill_number && r.bill_number.replace(/\s+/g, "") === compactBillNum) {
      return r.bill_id;
    }
  }
  return null;
}

async function syncOne(bill) {
  console.log(`\n=== ${bill.state} ${bill.bill_number} (${bill.id.slice(0, 8)}) | rel:${bill.kratom_relevance ?? '?'} ===`);

  // Resolve LegiScan ID
  let legiscanId = bill.legiscan_bill_id;
  if (!legiscanId) {
    try {
      legiscanId = await findLegiScanId(bill);
      // Remember the attempt either way: a bill LegiScan can't find is
      // searched again next week, not on every run (planBill).
      if (!DRY) await sb.from("bills").update({ legiscan_searched_at: new Date().toISOString() }).eq("id", bill.id);
      if (!legiscanId) {
        console.log("  ⏭  LegiScan didn't find a match");
        return "skip";
      }
      console.log(`  ↳ resolved LegiScan ID: ${legiscanId}`);
      if (!DRY) {
        await sb.from("bills").update({ legiscan_bill_id: legiscanId }).eq("id", bill.id);
      }
    } catch (e) {
      console.log(`  ✗ search failed: ${e.message?.slice(0, 100)}`);
      return "fail";
    }
  }

  // Fetch full bill
  let detail;
  try {
    const data = await legiscanFetch("getBill", { id: legiscanId });
    detail = data.bill;
  } catch (e) {
    console.log(`  ✗ getBill failed: ${e.message?.slice(0, 100)}`);
    return "fail";
  }
  if (!detail) {
    console.log("  ⏭  no bill detail returned");
    return "skip";
  }

  // GUARD: never staple a DIFFERENT session's actions/text onto this row.
  // (See isSessionMismatch — this is the fix for the MI SB 433 Frankenstein
  // record.) If the resolved bill is a different biennium than the stored
  // session_id, skip the merge entirely rather than corrupt the record.
  if (isSessionMismatch(bill.session_id, detail.session)) {
    console.log(
      `  ⚠ SESSION MISMATCH — stored '${bill.session_id}' vs LegiScan ` +
      `${detail.session?.year_start}-${detail.session?.year_end} (${detail.session?.session_name ?? "?"}); ` +
      `skipping merge to avoid a Frankenstein record`,
    );
    // Still remember the hash, or this bill is re-fetched (and re-skipped)
    // on every run until LegiScan's copy changes.
    if (!DRY && detail.change_hash) await sb.from("bills").update({ legiscan_change_hash: detail.change_hash }).eq("id", bill.id);
    return "skip";
  }

  // Action history → bill_actions (the trigger handles the rest)
  const actions = detail.history ?? [];
  console.log(`  ${actions.length} action(s) from LegiScan`);
  if (actions.length > 0 && !DRY) {
    const rows = actions
      .filter((a) => a.date && a.action)
      .map((a) => ({
        bill_id: bill.id,
        action_date: a.date,
        description: String(a.action).slice(0, 800),
        chamber: a.chamber === "S" ? "Senate" : a.chamber === "H" ? "House" : a.chamber ?? null,
        source: "legiscan",
        raw_json: a,
      }));
    const { data: inserted, error } = await sb
      .from("bill_actions")
      .upsert(rows, { onConflict: "bill_id,action_date,description", ignoreDuplicates: true })
      .select("id, description");
    if (error) {
      console.log(`  ⚠ bill_actions write failed: ${error.message?.slice(0, 200)}`);
    } else if (inserted && inserted.length > 0) {
      console.log(`  ↳ ${inserted.length} NEW action(s) → trigger fired for each`);
      for (const i of inserted.slice(0, 5)) console.log(`     - ${i.description.slice(0, 70)}`);
    } else {
      console.log("  ↳ all actions already in DB (no new triggers)");
    }
  }

  // ── Roll-call votes → bill_votes + bill_vote_members (Phase 3 D1) ──
  // LegiScan's getBill includes a `votes` array with per-roll-call
  // SUMMARIES (totals + passed flag). Per-member breakdowns require
  // a separate getRollCall call per roll_call_id. We do both:
  //   - always upsert the summary row (cheap, single parse)
  //   - call getRollCall only when we don't already have member
  //     data for that roll_call_id (avoids redundant API calls)
  const votes = detail.votes ?? [];
  if (votes.length > 0 && !DRY) {
    const voteRows = votes.map((v) => ({
      bill_id: bill.id,
      legiscan_roll_call_id: v.roll_call_id,
      vote_date: v.date ?? null,
      chamber: v.chamber === "S" ? "Senate" : v.chamber === "H" ? "House" : v.chamber ?? null,
      motion: String(v.desc ?? "").slice(0, 500),
      motion_id: v.motion_id ?? null,
      yea_count: Number(v.yea ?? 0),
      nay_count: Number(v.nay ?? 0),
      nv_count: Number(v.nv ?? 0),
      absent_count: Number(v.absent ?? 0),
      total_count: Number(v.total ?? 0),
      passed: v.passed === 1 || v.passed === true,
      source: "legiscan",
      raw_json: v,
      synced_at: new Date().toISOString(),
    }));
    const { data: insertedVotes, error: voteErr } = await sb
      .from("bill_votes")
      .upsert(voteRows, { onConflict: "bill_id,legiscan_roll_call_id" })
      .select("id, legiscan_roll_call_id");
    if (voteErr) {
      console.log(`  ⚠ bill_votes write failed: ${voteErr.message?.slice(0, 200)}`);
    } else if (insertedVotes && insertedVotes.length > 0) {
      console.log(`  ↳ ${insertedVotes.length} roll-call vote(s) upserted`);

      // Fetch per-member breakdowns for any vote we don't already
      // have members for. One extra API call per new roll_call_id.
      for (const v of insertedVotes) {
        // Skip if we already have member rows for this vote
        const { count: existingMembers } = await sb
          .from("bill_vote_members")
          .select("id", { count: "exact", head: true })
          .eq("bill_vote_id", v.id);
        if ((existingMembers ?? 0) > 0) continue;

        try {
          const rcData = await legiscanFetch("getRollCall", { id: v.legiscan_roll_call_id });
          const members = rcData?.roll_call?.votes ?? [];
          if (members.length === 0) continue;

          // Resolve legislator_id by LegiScan people_id where possible.
          // (Schema has people_id on the legislators table from
          // sync-bill-sponsors.mjs work.) Falls back to null when no
          // match — we still record the vote with legislator_name.
          const peopleIds = members.map((m) => m.people_id).filter(Boolean);
          const { data: legMatches } = peopleIds.length > 0
            ? await sb
                .from("legislators")
                .select("id, legiscan_people_id")
                .in("legiscan_people_id", peopleIds)
            : { data: [] };
          const idByPeopleId = new Map();
          for (const lm of legMatches ?? []) {
            if (lm.legiscan_people_id != null) idByPeopleId.set(lm.legiscan_people_id, lm.id);
          }

          const memberRows = members.map((m) => ({
            bill_vote_id: v.id,
            legislator_id: idByPeopleId.get(m.people_id) ?? null,
            legiscan_people_id: m.people_id ?? null,
            legislator_name: String(m.name ?? "").slice(0, 200),
            vote_text: String(m.vote_text ?? "").slice(0, 30),
            vote_value: Number(m.vote_id ?? 0),
          }));
          const { error: memErr } = await sb
            .from("bill_vote_members")
            .upsert(memberRows, { onConflict: "bill_vote_id,legiscan_people_id" });
          if (memErr) {
            console.log(`    ⚠ vote_members write failed (roll_call_id=${v.legiscan_roll_call_id}): ${memErr.message?.slice(0, 200)}`);
          } else {
            const matched = memberRows.filter((m) => m.legislator_id).length;
            console.log(`    ↳ ${memberRows.length} member votes (${matched} matched to legislators)`);
          }
        } catch (e) {
          console.log(`    ⚠ getRollCall failed (id=${v.legiscan_roll_call_id}): ${(e).message?.slice(0, 150)}`);
        }
        await sleep(400); // polite — extra API call per vote
      }
    }
  }

  // SORT before picking "last" — LegiScan's history array is NOT guaranteed
  // chronological (AB 1088's came back out of order, leaving last_action_at a
  // year stale while bill_actions held the real 2026 timeline).
  const lsLastAction = (detail.history ?? [])
    .filter((h) => h?.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-1)[0];
  // Reconcile status. LegiScan's NUMERIC code UNDER-reports enactment: it returns
  // 4 (Passed) for many bills whose own last_action says they became law — "Becomes
  // law without Governor's signature" (OK SB 891), "Approved by Governor", "Signed
  // by the Governor", "Enacted". Trusting the raw code reverted those to
  // passed_chamber on every nightly sync (undoing backfill-bill-status.mjs). So when
  // the action text explicitly indicates a terminal state and the numeric code is
  // still non-terminal, the action wins (identical rule to the backfill).
  const lsCodeStatus = STATUS_MAP[Number(detail.status)] ?? null;
  const TERMINAL = ["enacted", "vetoed", "dead"];
  // Scan the FULL history newest→oldest for a terminal action — not just the
  // single latest action. Post-enactment procedural notes ("Filed with
  // Secretary of State", "Effective date 08/01/2025") used to null the
  // override, letting the numeric code silently DOWNGRADE an enacted bill
  // back to passed_chamber every night (the exact regression class
  // backfill-bill-status.mjs guards against).
  const sortedHistory = (detail.history ?? [])
    .filter((h) => h?.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let actionTerminal = null;
  for (let i = sortedHistory.length - 1; i >= 0; i--) {
    actionTerminal = terminalStatusFromAction(sortedHistory[i]?.action);
    if (actionTerminal) break;
  }
  if (!actionTerminal) actionTerminal = terminalStatusFromAction(bill.last_action);
  let lsStatus = actionTerminal && !TERMINAL.includes(lsCodeStatus ?? "")
    ? actionTerminal
    : lsCodeStatus;
  // NEVER downgrade a terminal DB status on a quiet sync: if the DB already
  // says enacted/vetoed/dead and neither the action text nor the numeric code
  // asserts a terminal state, keep the DB value (mirror of the backfill's
  // conservative rule).
  if (TERMINAL.includes(bill.status) && lsStatus && !TERMINAL.includes(lsStatus)) {
    lsStatus = null;
  }
  const patch = {};

  // Extract current committee from the most-recent committee-mentioning
  // action. Mirrors src/lib/bill-committee.ts → parseCommitteeFromAction.
  // Stays inline (not imported) to keep this .mjs self-contained.
  //
  // Walks history newest-first; first match wins. If the most recent
  // status-changing action LEFT a committee (e.g. "Reported out of
  // Senate Health"), we still get the LAST mentioned committee — which
  // remains useful for context. Status field tells you whether the
  // bill is still IN that committee or has moved on; YourRepDecidingThisBill
  // uses both signals.
  // Mirrors parseCommitteeFromAction in src/lib/bill-committee.ts —
  // tries Form A first ("Senate Health Committee"), falls back to
  // Form B ("Senate Committee on Healthcare", canonicalized to
  // "Senate Healthcare Committee"). See tests/bill-committee.test.ts
  // for fixtures including the multi-chamber wrap-around case.
  const COMMITTEE_RE_A = /((?:Senate|House|Assembly|Joint)(?:(?!Senate|House|Assembly|Joint)[^.;]){2,80}?Committee)/i;
  const COMMITTEE_RE_B = /(Senate|House|Assembly|Joint)\s+Committee\s+on\s+((?:(?!Senate|House|Assembly|Joint)[^.;,]){2,60}?)(?=\s*[.;,]|$)/i;
  const parseCommittee = (desc) => {
    if (!desc) return null;
    const a = String(desc).match(COMMITTEE_RE_A);
    if (a) {
      const raw = a[1].trim();
      if (raw.length >= 8 && raw.length <= 80) {
        const chamber = /^senate/i.test(raw) ? "senate"
          : /^(house|assembly)/i.test(raw) ? "house"
          : /^joint/i.test(raw) ? "joint"
          : null;
        return { name: raw, chamber };
      }
    }
    const b = String(desc).match(COMMITTEE_RE_B);
    if (b) {
      const chamberRaw = b[1].trim();
      const body = b[2].trim().replace(/\s+/g, " ");
      if (body.length >= 3 && body.length <= 60) {
        const chamberCanonical = /^senate/i.test(chamberRaw) ? "Senate"
          : /^(house|assembly)/i.test(chamberRaw) ? chamberRaw[0].toUpperCase() + chamberRaw.slice(1).toLowerCase()
          : "Joint";
        const name = `${chamberCanonical} ${body} Committee`;
        if (name.length >= 8 && name.length <= 80) {
          const chamber = /^senate/i.test(chamberRaw) ? "senate"
            : /^(house|assembly)/i.test(chamberRaw) ? "house"
            : "joint";
          return { name, chamber };
        }
      }
    }
    return null;
  };
  let parsedCommitteeName = null;
  let parsedCommitteeChamber = null;
  let parsedCommitteeUpdatedAt = null;
  // Walk newest→oldest by DATE. LegiScan history isn't guaranteed date-sorted,
  // so array-index order != chronological order — iterating by index risked
  // recording a stale/older committee as the current one.
  const datedActions = [...actions].filter((a) => a?.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (let i = datedActions.length - 1; i >= 0; i--) {
    const a = datedActions[i];
    if (!a?.action) continue;
    const parsed = parseCommittee(a.action);
    if (!parsed) continue;
    parsedCommitteeName = parsed.name;
    parsedCommitteeChamber = parsed.chamber;
    parsedCommitteeUpdatedAt = a.date ?? null;
    break;
  }
  if (parsedCommitteeName && parsedCommitteeName !== bill.current_committee_name) {
    patch.current_committee_name = parsedCommitteeName;
    patch.current_committee_chamber = parsedCommitteeChamber;
    patch.current_committee_updated_at = parsedCommitteeUpdatedAt;
    console.log(`  ↳ committee: ${bill.current_committee_name ?? '(null)'} → ${parsedCommitteeName}`);
  }
  if (lsStatus && lsStatus !== bill.status) {
    console.log(`  ↳ status: ${bill.status ?? '(null)'} → ${lsStatus}`);
    patch.status = lsStatus;
    if (lsStatus === "enacted") patch.signed_at = new Date().toISOString();
  }
  if (lsLastAction) {
    const newLA = String(lsLastAction.action).slice(0, 500);
    if (newLA !== bill.last_action) {
      patch.last_action = newLA;
      patch.last_action_at = lsLastAction.date;
    }
  }
  // Remember LegiScan's hash for this version: the next run skips getBill
  // until the master list shows a different one.
  if (detail.change_hash && detail.change_hash !== bill.legiscan_change_hash) {
    patch.legiscan_change_hash = detail.change_hash;
  }
  patch.last_synced_at = new Date().toISOString();

  if (Object.keys(patch).length > 1 && !DRY) {  // > 1 = something more than just last_synced_at
    await sb.from("bills").update(patch).eq("id", bill.id);
    console.log(`  ✓ bill updated: ${Object.keys(patch).filter((k) => k !== 'last_synced_at').join(", ")}`);
  }

  await sleep(500); // polite
  return "ok";
}

// ---- main ----
const runStart = Date.now();
const BILL_COLS = "id, state, bill_number, kratom_relevance, status, last_action, legiscan_bill_id, session_id, current_committee_name, legiscan_change_hash, legiscan_searched_at";

async function record(status, notes, rowsUpdated = 0) {
  try {
    await sb.from("scraper_runs").insert({
      source: SOURCE, started_at: new Date(runStart).toISOString(), finished_at: new Date().toISOString(),
      status, rows_updated: rowsUpdated, notes,
    });
  } catch { /* best-effort */ }
}

// --priority runs from a 2-hourly cron but only needs to run every few hours.
if (PRIORITY && MIN_GAP_HOURS > 0) {
  const { data: last } = await sb.from("scraper_runs").select("finished_at").eq("source", SOURCE)
    .in("status", ["success", "partial", "empty"]).order("finished_at", { ascending: false }).limit(1);
  const lastAt = last?.[0]?.finished_at ? Date.parse(last[0].finished_at) : 0;
  if (Date.now() - lastAt < MIN_GAP_HOURS * 3_600_000) {
    console.log(`Last ${SOURCE} run was under ${MIN_GAP_HOURS}h ago — skipping (no LegiScan queries).`);
    process.exit(0);
  }
}

// Monthly budget: the bill sync is the essential job and may run to 95%.
const usedThisMonth = await legiscanCallsThisMonth(sb).catch(() => 0);
const allowance = SPECIFIC ? 50 : remainingFor(usedThisMonth, "essential");
if (allowance <= 0) {
  console.log(`LegiScan month budget reached (${usedThisMonth} calls recorded) — skipping.`);
  await record("empty", `budget reached · ${usedThisMonth} calls this month · legiscan_calls=0`);
  process.exit(0);
}
client = createLegiscanClient(KEY, { maxCalls: allowance });

let bills;
if (SPECIFIC) {
  const { data } = await sb.from("bills").select(BILL_COLS).eq("id", SPECIFIC).single();
  bills = data ? [data] : [];
} else if (PRIORITY) {
  // Active anti bills in states whose legislature is in session right now:
  // the only places a bill can move between daily passes.
  const year = new Date().getUTCFullYear();
  const { data: open } = await sb.from("legislative_sessions").select("state")
    .eq("sine_die", false).gte("year_end", year);
  const openStates = [...new Set((open ?? []).map((s) => s.state))];
  if (openStates.length === 0) { console.log("No legislature in session — nothing to do."); await record("empty", "no open sessions · legiscan_calls=0"); process.exit(0); }
  const { data } = await sb.from("bills").select(BILL_COLS)
    .eq("active", true).eq("scope", "state").eq("kratom_relevance", "anti").in("state", openStates);
  bills = data ?? [];
} else if (ALL_ANTI) {
  // Daily mode: all active anti + pro bills
  const { data } = await sb.from("bills").select(BILL_COLS)
    .eq("active", true)
    .eq("scope", "state")
    .in("kratom_relevance", ["anti", "pro"])
    .order("last_synced_at", { ascending: true, nullsFirst: true });
  bills = data ?? [];
}

if (bills.length === 0) { console.log("Nothing to sync."); await record("empty", "nothing to sync · legiscan_calls=0"); process.exit(0); }
console.log(`Checking ${bills.length} bill(s) via LegiScan${DRY ? " (DRY RUN)" : ""} · month so far ${usedThisMonth} calls, this run may use ${allowance}…`);

// One master list per state (current session) → which bills changed.
const hashesByState = new Map();
if (!SPECIFIC) {
  for (const state of [...new Set(bills.filter((b) => b.legiscan_bill_id).map((b) => b.state))]) {
    try {
      const data = await legiscanFetch("getMasterListRaw", { state });
      hashesByState.set(state, changeHashesFromMasterList(data.masterlist));
    } catch (e) {
      console.log(`  ⚠ master list ${state} failed: ${e.message?.slice(0, 100)} — its bills are fetched directly`);
    }
    if (client.exhausted) break;
  }
}

let ok = 0, fail = 0, skip = 0, unchanged = 0, final = 0, waiting = 0;
let stoppedEarly = false, outOfBudget = false;
const quiet = [];
for (const b of bills) {
  if (Date.now() - runStart > MAX_RUN_MS) {
    stoppedEarly = true;
    console.log(`\n⏱ Reached ${MAX_MINUTES}-min wall-clock budget — stopping early so telemetry is recorded before the CI timeout. Bills are ordered most-stale-first; the next run continues here.`);
    break;
  }
  const plan = SPECIFIC ? "fetch" : planBill(b, hashesByState.get(b.state));
  if (plan === "unchanged" || plan === "final") { plan === "unchanged" ? unchanged++ : final++; quiet.push(b.id); continue; }
  if (plan === "wait") { waiting++; continue; }
  if (client.exhausted) { outOfBudget = true; console.log(`\n💸 Run budget used (${client.calls} calls) — the rest wait for the next run.`); break; }
  const r = await syncOne(b);
  if (r === "ok") ok++;
  else if (r === "fail") fail++;
  else skip++;
}
// Unchanged bills were still checked: stamp them so "last synced" stays true.
if (quiet.length && !DRY) {
  for (let i = 0; i < quiet.length; i += 200) {
    await sb.from("bills").update({ last_synced_at: new Date().toISOString() }).in("id", quiet.slice(i, i + 200));
  }
}

console.log(`\nDone. fetched ok=${ok}, unchanged=${unchanged}, final=${final}, search-wait=${waiting}, skip=${skip}, fail=${fail} · legiscan_calls=${client.calls}${stoppedEarly ? " (stopped at time budget)" : ""}`);

// "partial" when some bills synced despite a few LegiScan hiccups (429s /
// timeouts on individual bills); only a run that synced NOTHING is a real
// error. A run where every bill was unchanged is a success: checking is the job.
await record(
  (stoppedEarly || outOfBudget) && ok > 0 ? "partial"
    : fail > 0 ? (ok > 0 ? "partial" : "error")
    : (ok + unchanged + final + skip === 0 ? "empty" : "success"),
  `${ok} synced, ${unchanged} unchanged, ${final} final, ${skip} skipped, ${fail} failed, ${waiting} waiting to re-search` +
    `${stoppedEarly ? " · stopped at time budget" : ""}${outOfBudget ? " · stopped at LegiScan budget" : ""} · legiscan_calls=${client.calls}`,
  ok,
);
