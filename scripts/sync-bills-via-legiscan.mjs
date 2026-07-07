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
 * LegiScan free tier: 30,000 queries/month. Each bill we track
 * needs ~2 calls (search + getBill) on first sync, then 1/hour
 * thereafter. For ~50 tracked bills running hourly = ~36,000/month
 * which exceeds the cap. So we batch: tracked bills get hourly,
 * everything else daily. Use --priority to scope.
 *
 * Run:
 *   node --env-file=.env.local scripts/sync-bills-via-legiscan.mjs --priority   # hourly cron mode
 *   node --env-file=.env.local scripts/sync-bills-via-legiscan.mjs --all-anti   # daily wide pass
 *   node --env-file=.env.local scripts/sync-bills-via-legiscan.mjs --bill <uuid>
 */
import { createClient } from "@supabase/supabase-js";
import { terminalStatusFromAction } from "./lib/bill-status.mjs";

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

if (!PRIORITY && !ALL_ANTI && !SPECIFIC) {
  console.error("Usage: --priority | --all-anti | --bill <uuid>");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// LegiScan status code → our status string
// docs: https://legiscan.com/misc/LegiScan_API_User_Manual.pdf p.34
const STATUS_MAP = {
  1: "introduced",
  2: "in_committee",
  3: "in_committee",
  4: "passed_chamber",
  5: "passed_chamber",
  6: "enacted",
  7: "vetoed",
  8: "dead",
  9: "dead",
  10: "dead",
};

async function legiscanFetch(op, params) {
  const u = new URL("https://api.legiscan.com/");
  u.searchParams.set("key", KEY);
  u.searchParams.set("op", op);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
  const r = await fetch(u.toString(), { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`LegiScan ${op} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  if (data.status === "ERROR") throw new Error(`LegiScan ${op} error: ${data.alert?.message ?? "unknown"}`);
  return data;
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
  const actionTerminal = terminalStatusFromAction(lsLastAction?.action ?? bill.last_action);
  const lsStatus = actionTerminal && !["enacted", "vetoed", "dead"].includes(lsCodeStatus ?? "")
    ? actionTerminal
    : lsCodeStatus;
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
  patch.last_synced_at = new Date().toISOString();

  if (Object.keys(patch).length > 1 && !DRY) {  // > 1 = something more than just last_synced_at
    await sb.from("bills").update(patch).eq("id", bill.id);
    console.log(`  ✓ bill updated: ${Object.keys(patch).filter((k) => k !== 'last_synced_at').join(", ")}`);
  }

  await sleep(500); // polite
  return "ok";
}

// ---- main ----
let bills;
if (SPECIFIC) {
  const { data } = await sb.from("bills")
    .select("id, state, bill_number, kratom_relevance, status, last_action, legiscan_bill_id, session_id, current_committee_name")
    .eq("id", SPECIFIC).single();
  bills = data ? [data] : [];
} else if (PRIORITY) {
  // Hourly mode: only active anti bills with last_synced_at > 30 min old
  // (so we don't burn quota on the same bills every tick if cron runs fast)
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await sb.from("bills")
    .select("id, state, bill_number, kratom_relevance, status, last_action, legiscan_bill_id, session_id, current_committee_name")
    .eq("active", true)
    .eq("scope", "state")
    .eq("kratom_relevance", "anti")
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(30);
  bills = data ?? [];
} else if (ALL_ANTI) {
  // Daily mode: all active anti + pro bills
  const { data } = await sb.from("bills")
    .select("id, state, bill_number, kratom_relevance, status, last_action, legiscan_bill_id, session_id, current_committee_name")
    .eq("active", true)
    .eq("scope", "state")
    .in("kratom_relevance", ["anti", "pro"])
    .order("last_synced_at", { ascending: true, nullsFirst: true });
  bills = data ?? [];
}

if (bills.length === 0) { console.log("Nothing to sync."); process.exit(0); }
console.log(`Syncing ${bills.length} bill(s) via LegiScan${DRY ? " (DRY RUN)" : ""}…`);

let ok = 0, fail = 0, skip = 0;
let stoppedEarly = false;
const runStart = Date.now();
for (const b of bills) {
  if (Date.now() - runStart > MAX_RUN_MS) {
    stoppedEarly = true;
    console.log(`\n⏱ Reached ${MAX_MINUTES}-min wall-clock budget — stopping early so telemetry is recorded before the CI timeout. Bills are ordered most-stale-first; the next run continues here.`);
    break;
  }
  const r = await syncOne(b);
  if (r === "ok") ok++;
  else if (r === "fail") fail++;
  else skip++;
}

console.log(`\nDone. ok=${ok}, skip=${skip}, fail=${fail}${stoppedEarly ? " (stopped at time budget)" : ""}`);

try {
  await sb.from("scraper_runs").insert({
    source: PRIORITY ? "sync_bills_legiscan_priority" : "sync_bills_legiscan_all",
    started_at: new Date(runStart).toISOString(),
    finished_at: new Date().toISOString(),
    // "partial" when some bills synced despite a few LegiScan hiccups (429s /
    // timeouts on individual bills) — only a run that synced NOTHING is a real
    // error. De-noises the automation dashboard (this job ran ~hourly and a
    // single transient bill failure was flagging the whole run red).
    status: stoppedEarly && ok > 0 ? "partial"
      : fail > 0 ? (ok > 0 ? "partial" : "error")
      : (ok === 0 && skip === 0 ? "empty" : "success"),
    rows_updated: ok,
    notes: `${ok} synced, ${skip} skipped, ${fail} failed${stoppedEarly ? " · stopped at time budget" : ""}`,
  });
} catch { /* best-effort */ }
