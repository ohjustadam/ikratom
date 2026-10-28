/**
 * sync-legislative-sessions.mjs — the authoritative "is this session over?" feed.
 *
 * LegiScan getSessionList returns every session per state with a `sine_die` flag
 * (1 once the session has adjourned sine die = officially over). We upsert those
 * into legislative_sessions so the review cron can retire non-enacted bills the
 * moment their session closes — instead of guessing from inactivity.
 *
 * Uses the LEGISCAN_API_KEY, whose real cap is 10,000 queries a month (not
 * the 30k this header used to say). One getSessionList per state (~51 calls),
 * so it self-gates to once every 6 days: it was scheduled nightly, ~1,500 a
 * month, which helped run October's allowance dry. Sessions change a few
 * times a year. --force skips the gate. Nonessential: it stands down at 70% of
 * the month's budget (scripts/lib/legiscan-budget.mjs).
 *
 *   node --env-file=.env.local scripts/sync-legislative-sessions.mjs [--state XX]
 */
import { createClient } from "@supabase/supabase-js";
import { STATE_NAMES } from "./lib/us-states.mjs";
import { runWithLogging } from "./lib/scraper-run.mjs";
import { legiscanCallsThisMonth, budgetAllows } from "./lib/legiscan-budget.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const KEY = process.env.LEGISCAN_API_KEY;
const FORCE = process.argv.includes("--force");
let calls = 0;
const ONE_STATE = (() => { const i = process.argv.indexOf("--state"); return i >= 0 ? process.argv[i + 1]?.toUpperCase() : null; })();

async function getSessionList(state) {
  const u = new URL("https://api.legiscan.com/");
  u.searchParams.set("key", KEY);
  u.searchParams.set("op", "getSessionList");
  u.searchParams.set("state", state);
  calls++;
  const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`LegiScan ${r.status}`);
  const d = await r.json();
  if (d.status === "ERROR") throw new Error(d.alert?.message ?? "error");
  return d.sessions ?? [];
}

if (!ONE_STATE && !FORCE) {
  const { data: last } = await supabase.from("scraper_runs").select("finished_at")
    .eq("source", "sync_legislative_sessions").eq("status", "success")
    .order("finished_at", { ascending: false }).limit(1);
  const lastAt = last?.[0]?.finished_at ? Date.parse(last[0].finished_at) : 0;
  if (Date.now() - lastAt < 6 * 86_400_000) {
    console.log("sync_legislative_sessions ran under 6 days ago — skipping (use --force).");
    process.exit(0);
  }
  const used = await legiscanCallsThisMonth(supabase).catch(() => 0);
  if (!budgetAllows(used, "nonessential")) {
    console.log(`LegiScan month budget past the nonessential ceiling (${used} calls) — skipping.`);
    process.exit(0);
  }
}

await runWithLogging({ source: "sync_legislative_sessions", supabase }, async () => {
  if (!KEY) throw new Error("LEGISCAN_API_KEY not set");
  const states = ONE_STATE ? [ONE_STATE] : Object.keys(STATE_NAMES);
  let added = 0, updated = 0, sineDie = 0, errors = 0;

  for (const state of states) {
    let sessions;
    try { sessions = await getSessionList(state); }
    catch (e) { console.log(`  ✗ ${state}: ${(e.message ?? "err").slice(0, 60)}`); errors++; continue; }

    for (const s of sessions) {
      const row = {
        state,
        legiscan_session_id: s.session_id,
        session_name: String(s.session_name ?? s.session_title ?? "").slice(0, 200) || null,
        year_start: s.year_start ?? null,
        year_end: s.year_end ?? null,
        special: s.special === 1 || s.special === true,
        sine_die: s.sine_die === 1 || s.sine_die === true,
        synced_at: new Date().toISOString(),
      };
      if (row.sine_die) sineDie++;
      const { error, data } = await supabase
        .from("legislative_sessions")
        .upsert(row, { onConflict: "legiscan_session_id" })
        .select("id");
      if (error) { console.log(`  ⚠ ${state} ${s.session_id}: ${error.message?.slice(0, 80)}`); errors++; }
      else if (data) updated++;
    }
    console.log(`  ${state}: ${sessions.length} sessions`);
  }
  const notes = `${states.length} states · ${sineDie} sine_die · ${errors} errors · legiscan_calls=${calls}`;
  console.log(`\n✓ ${notes}`);
  return { rowsAdded: added, rowsUpdated: updated, notes };
});
