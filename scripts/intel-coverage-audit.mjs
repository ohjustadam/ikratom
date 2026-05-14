/**
 * Intel network coverage audit — the matrix view across all 51 states.
 *
 * "Bullseyes everywhere": every state should have the same six intel
 * layers populated. This script emits a per-state matrix so admins
 * can see at a glance where the gaps are.
 *
 * Layers audited (one column each):
 *   1. legislators    — active rows in the directory
 *   2. bills          — active kratom-relevant bills tracked
 *   3. bill_votes     — roll-call records synced (LegiScan-driven; was
 *                       silently 0 across all 51 states until 2026-05-14
 *                       because LEGISCAN_API_KEY wasn't in CI secrets.
 *                       This script makes that kind of gap loud.)
 *   4. news_mentions  — per-legislator news hits indexed (D4 Phase 1)
 *   5. lobbyists      — kratom-industry state-lobbying registrations
 *                       (D2 pilot, currently Utah-only; queued FL/NJ/CA/TX)
 *   6. briefing       — does the state have an active briefing
 *
 * Default output: human-readable table.
 * `--json` for machine output (admin dashboard consumption).
 * `--check` exits non-zero if any "must-have" layer is missing from
 *   any state (used by CI to enforce baseline coverage).
 *
 * The script paginates Supabase queries (counter-intuitive bug from
 * an earlier ad-hoc audit: default response cap is 1000 rows, so
 * "total" counts silently truncated until pagination was added).
 *
 * Usage:
 *   node --env-file=.env.local scripts/intel-coverage-audit.mjs
 *   node --env-file=.env.local scripts/intel-coverage-audit.mjs --json
 *   node --env-file=.env.local scripts/intel-coverage-audit.mjs --check
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const JSON_OUT = flag("--json");
const CHECK_MODE = flag("--check");

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
];

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const log = (s) => { if (!JSON_OUT) console.log(s); };

/**
 * Supabase default-caps SELECT response at 1000 rows. For per-state
 * counts on big tables (legislators, bill_vote_members) we need the
 * full picture, so paginate with range().
 */
async function paginatedSelect(table, columns, where = {}) {
  const PAGE = 1000;
  const out = [];
  for (let start = 0; ; start += PAGE) {
    let q = sb.from(table).select(columns).range(start, start + PAGE - 1);
    for (const [k, v] of Object.entries(where)) {
      if (v === null) q = q.is(k, null);
      else q = q.eq(k, v);
    }
    const { data, error } = await q;
    if (error) { console.error(`${table} page ${start}: ${error.message}`); break; }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

const matrix = {};
for (const s of STATES) {
  matrix[s] = {
    state: s,
    legislators: 0, bills: 0, bill_votes: 0, news_mentions: 0,
    state_lobbyists: 0, briefing_active: false, briefing_len: 0,
  };
}

log("Loading data across 6 intel layers…");

// 1. legislators
const legs = await paginatedSelect("legislators", "state", { active: true });
for (const r of legs) {
  const s = r.state?.toUpperCase();
  if (s && matrix[s]) matrix[s].legislators++;
}

// 2. bills
const bills = await paginatedSelect("bills", "state", { active: true });
for (const r of bills) {
  const s = r.state?.toUpperCase();
  if (s && matrix[s]) matrix[s].bills++;
}

// 3. bill_votes — joined to bills for state. Paginated through
// the bill_votes table itself; for each row resolve state via bill.
const billState = new Map();
for (const b of await paginatedSelect("bills", "id, state")) {
  if (b.state) billState.set(b.id, b.state.toUpperCase());
}
const votes = await paginatedSelect("bill_votes", "bill_id");
for (const r of votes) {
  const s = billState.get(r.bill_id);
  if (s && matrix[s]) matrix[s].bill_votes++;
}

// 4. legislator_news_mentions — joined to legislators
const legState = new Map();
for (const l of legs) legState.set(l.id, l.state?.toUpperCase()); // (this requires legs has id; refactor)
// Actually we only selected state above. Re-query with id.
const legsWithIds = await paginatedSelect("legislators", "id, state", { active: true });
const legStateMap = new Map();
for (const l of legsWithIds) if (l.id) legStateMap.set(l.id, l.state?.toUpperCase());
const mentions = await paginatedSelect("legislator_news_mentions", "legislator_id");
for (const r of mentions) {
  const s = legStateMap.get(r.legislator_id);
  if (s && matrix[s]) matrix[s].news_mentions++;
}

// 5. state_lobbyist_registrations — direct state column, active only
const lobbyists = await paginatedSelect(
  "state_lobbyist_registrations",
  "state",
  { is_kratom_relevant: true },
);
for (const r of lobbyists) {
  const s = r.state?.toUpperCase();
  if (s && matrix[s]) matrix[s].state_lobbyists++;
}

// 6. state_briefings — active only
const briefings = await paginatedSelect(
  "state_briefings",
  "state, body_md",
  { is_active: true },
);
for (const r of briefings) {
  const s = r.state?.toUpperCase();
  if (s && matrix[s]) {
    matrix[s].briefing_active = true;
    matrix[s].briefing_len = r.body_md?.length ?? 0;
  }
}

// ── Output
const rows = STATES.map(s => matrix[s]);
const totals = rows.reduce((a, r) => ({
  legislators: a.legislators + r.legislators,
  bills: a.bills + r.bills,
  bill_votes: a.bill_votes + r.bill_votes,
  news_mentions: a.news_mentions + r.news_mentions,
  state_lobbyists: a.state_lobbyists + r.state_lobbyists,
  briefings_active: a.briefings_active + (r.briefing_active ? 1 : 0),
}), { legislators: 0, bills: 0, bill_votes: 0, news_mentions: 0, state_lobbyists: 0, briefings_active: 0 });

// Layer coverage = % of states with ≥1 row (excluding "no activity is valid" — see below).
const coverage = {
  legislators: rows.filter(r => r.legislators > 0).length / STATES.length,
  bills: rows.filter(r => r.bills > 0).length / STATES.length,
  bill_votes: rows.filter(r => r.bill_votes > 0).length / STATES.length,
  news_mentions: rows.filter(r => r.news_mentions > 0).length / STATES.length,
  state_lobbyists: rows.filter(r => r.state_lobbyists > 0).length / STATES.length,
  briefings_active: rows.filter(r => r.briefing_active).length / STATES.length,
};

if (JSON_OUT) {
  console.log(JSON.stringify({ states: rows, totals, coverage }, null, 2));
} else {
  console.log("\nIntel coverage matrix — 51 states × 6 layers");
  console.log("STATE | legs | bills | votes | news_m | st_lob | brief len");
  console.log("------+------+-------+-------+--------+--------+----------");
  for (const r of rows) {
    const lobStatus = r.state_lobbyists > 0 ? "🟢" : "  ";
    const voteStatus = r.bill_votes > 0 ? "🟢" : "🔴";
    const briefStatus = r.briefing_active ? `🟢 ${String(r.briefing_len).padStart(5)}` : "🔴  none";
    console.log(`  ${r.state}  | ${String(r.legislators).padStart(4)} | ${String(r.bills).padStart(5)} | ${voteStatus}${String(r.bill_votes).padStart(4)} | ${String(r.news_mentions).padStart(6)} | ${lobStatus}${String(r.state_lobbyists).padStart(5)} | ${briefStatus}`);
  }
  console.log("------+------+-------+-------+--------+--------+----------");
  console.log(`TOTAL | ${totals.legislators} legs | ${totals.bills} bills | ${totals.bill_votes} votes | ${totals.news_mentions} mentions | ${totals.state_lobbyists} lob | ${totals.briefings_active} briefings`);
  console.log("\nLayer coverage (% states with ≥1 row):");
  for (const [k, v] of Object.entries(coverage)) {
    const pct = (v * 100).toFixed(0);
    const indicator = v >= 0.95 ? "🟢" : v >= 0.5 ? "🟡" : "🔴";
    console.log(`  ${indicator} ${k.padEnd(20)} ${pct}%`);
  }
}

// --check mode: exit non-zero if briefing or legislator coverage drops
// below the floor. Briefings should be 100% (51 states), legislators
// should be near-universal. These are the layers we can't afford to
// silently lose — if either drops, daily cron is broken.
if (CHECK_MODE) {
  const failures = [];
  if (coverage.briefings_active < 1.0) failures.push(`briefings coverage ${(coverage.briefings_active * 100).toFixed(0)}% (expected 100%)`);
  if (coverage.legislators < 0.95) failures.push(`legislators coverage ${(coverage.legislators * 100).toFixed(0)}% (expected >=95%)`);
  if (failures.length > 0) {
    console.error("\nCOVERAGE FAILURES:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  if (!JSON_OUT) console.log("\n✓ Coverage check passed.");
}
