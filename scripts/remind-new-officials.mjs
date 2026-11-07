#!/usr/bin/env node
/**
 * Tell members when new officials take office in their state.
 *
 * A campaign's targets come from the live roster, so a new official shows up as
 * not yet written the day the roster changes. A member just has no reason to go
 * back and look. PJ asked for a nudge when a campaign crosses into a new year,
 * and January 2027 is the first one that matters.
 *
 * Dry run by default. --apply writes a notification to every member it matches,
 * which is a mass notice, so it needs the owner's yes each time. It is not on a
 * schedule. A member gets one notice per run window, however often this runs.
 *
 *   node --env-file=.env.local scripts/remind-new-officials.mjs --since 2027-01-01
 *   node --env-file=.env.local scripts/remind-new-officials.mjs --since 2027-01-01 --apply
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const since = args[args.indexOf("--since") + 1];
const apply = args.includes("--apply");
if (!args.includes("--since") || !/^\d{4}-\d{2}-\d{2}$/.test(since ?? "")) {
  console.error("Usage: remind-new-officials.mjs --since YYYY-MM-DD [--apply]");
  process.exit(1);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Every row of a query, past PostgREST's 1000-row cap. The query must be ordered. */
async function all(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const officials = await all(() =>
  sb
    .from("legislators")
    .select("id, state")
    .eq("active", true)
    .in("level", ["state", "federal"])
    .or(`term_start_date.gte.${since},created_at.gte.${since}`)
    .order("id"),
);
const newByState = new Map();
for (const o of officials) newByState.set(o.state, (newByState.get(o.state) ?? 0) + 1);

const campaigns = await all(() =>
  sb.from("campaigns").select("id, state").eq("active", true).in("state", [...newByState.keys()]).order("id"),
);
const statesWithCampaigns = new Set(campaigns.map((c) => c.state));

const members = await all(() =>
  sb.from("profiles").select("id, state").in("state", [...statesWithCampaigns]).order("id"),
);
const told = await all(() =>
  sb.from("notifications").select("user_id").eq("kind", "new_officials").gte("created_at", since).order("id"),
);
const alreadyTold = new Set(told.map((n) => n.user_id));
const toTell = members.filter((m) => !alreadyTold.has(m.id));

console.log(`New officials since ${since}: ${officials.length}, in ${newByState.size} states.`);
console.log(`States with a live campaign: ${statesWithCampaigns.size}.`);
console.log(`Members to tell: ${toTell.length} (${alreadyTold.size} told already).`);
for (const [state, n] of [...newByState].sort()) {
  if (!statesWithCampaigns.has(state)) continue;
  console.log(`  ${state}: ${n} new, ${toTell.filter((m) => m.state === state).length} members`);
}

if (!apply) {
  console.log("Dry run. Nothing was sent. Add --apply once the owner says yes.");
  process.exit(0);
}

const rows = toTell.map((m) => {
  const n = newByState.get(m.state);
  return {
    user_id: m.id,
    kind: "new_officials",
    title: `New officials in ${m.state}`,
    body: `${n} new official${n === 1 ? " has" : "s have"} taken office. Your campaigns can reach them now.`,
    link: "/campaigns",
  };
});
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await sb.from("notifications").insert(rows.slice(i, i + 500));
  if (error) throw new Error(error.message);
}
console.log(`Told ${rows.length} members.`);
