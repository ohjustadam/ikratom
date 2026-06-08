#!/usr/bin/env node
/**
 * READ-ONLY diagnostic for migration 0186 (bill-aware campaign_topic_key).
 *
 * Answers two questions against the REAL prod DB (reads .env.local, so it is
 * immune to any Supabase MCP project-ref mismatch):
 *   1. Migration state — which migrations are recorded applied in
 *      public._ikratom_migrations (esp. 0182/0183/0186)?
 *   2. Back-fill collision risk — how many LIVE campaigns would map to the SAME
 *      bill-aware key (i.e. multiple live campaigns for one bill that 0186's
 *      back-fill would want to collapse). These are the only rows whose
 *      topic_key the 0186 back-fill leaves on its OLD value (canonical-safe).
 *
 * Writes NOTHING. Run:
 *   node --env-file=.env.local scripts/diagnose-topic-key-0186.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { billKey } from "./lib/topic-key.mjs";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// JS mirror of campaign_topic_key() as amended by 0186 (bill key first).
function newDbKey(state, title) {
  const bk = billKey(state, title);
  if (bk) return bk;
  const t = String(title || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  let kw = "unknown";
  if (/\b7-?hydroxymitragynine\b/.test(t)) kw = "mitragynine";
  else if (/\bmitragyn[a-z]*\b/.test(t)) kw = "mitragyna";
  else if (/\b7-?o?h\b/.test(t)) kw = "mitragynine";
  else if (/\bkratomite\b/.test(t)) kw = "kratom";
  else if (/\bkratoms?\b/.test(t)) kw = "kratom";
  else if (/\bgas[- ]?station\b/.test(t)) kw = "gas-station";
  else if (/\btianeptine\b/.test(t)) kw = "tianeptine";
  let ev = "unknown";
  if (/\bban/.test(t)) ev = "ban";
  else if (/\brestrict/.test(t)) ev = "restrict";
  else if (/\bregulat/.test(t)) ev = "regulat";
  else if (/\bhearing/.test(t)) ev = "hearing";
  else if (/\bschedul/.test(t)) ev = "schedule";
  else if (/\benact/.test(t)) ev = "enact";
  else if (/\bveto/.test(t)) ev = "veto";
  else if (/\brepeal/.test(t)) ev = "repeal";
  else if (/\bordinance/.test(t)) ev = "ordinance";
  else if (/\bcrackdown/.test(t)) ev = "crackdown";
  else if (/\blaw\b/.test(t)) ev = "law";
  else if (/\bruling/.test(t)) ev = "ruling";
  else if (/\bpass(es|ed)?/.test(t)) ev = "pass";
  else if (/\bsign(s|ed)?/.test(t)) ev = "sign";
  else if (/\bapprov/.test(t)) ev = "approve";
  else if (/\breject/.test(t)) ev = "reject";
  else if (/\bwithdraw/.test(t)) ev = "withdraw";
  else if (/\bstall/.test(t)) ev = "stall";
  else if (/\bhalt/.test(t)) ev = "halt";
  return `${state ?? "?"}|${kw}|${ev}`;
}
const enforced = (k) => !!k && !/\|unknown\|unknown$/.test(k);

// 1) Migration state
console.log("=== applied migrations (public._ikratom_migrations) ===");
try {
  const { data, error } = await sb.from("_ikratom_migrations").select("name").order("name");
  if (error) throw error;
  const names = (data ?? []).map((r) => r.name);
  console.log(`  ${names.length} applied; latest: ${names.slice(-6).join(", ") || "(none)"}`);
  for (const probe of ["0182", "0183", "0186"]) {
    const hit = names.find((n) => n.startsWith(probe));
    console.log(`  ${probe}: ${hit ? `APPLIED (${hit})` : "NOT applied"}`);
  }
} catch (e) {
  console.log(`  ⚠ couldn't read _ikratom_migrations: ${e.message ?? e}`);
}

// 2) Live campaigns + collision sizing
console.log("\n=== live-campaign back-fill analysis (0186 bill-aware key) ===");
let rows = [];
for (let from = 0; from < 20000; from += 1000) {
  const { data, error } = await sb
    .from("campaigns")
    .select("id, state, title, topic_key, review_state, created_at")
    .in("review_state", ["pending_review", "auto_active", "manual"])
    .order("created_at", { ascending: true })
    .range(from, from + 999);
  if (error) { console.log(`  ⚠ campaigns query failed: ${error.message}`); break; }
  if (!data?.length) break;
  rows = rows.concat(data);
  if (data.length < 1000) break;
}
console.log(`  ${rows.length} live campaigns (pending_review + auto_active + manual)`);

const byNew = new Map();      // newKey -> [rows]
let changed = 0, blindToEnforced = 0, billKeyed = 0;
for (const r of rows) {
  const nk = newDbKey(r.state, r.title);
  if (nk !== r.topic_key) changed++;
  if (nk.startsWith("bill:")) billKeyed++;
  if (!enforced(r.topic_key) && enforced(nk)) blindToEnforced++;
  if (!byNew.has(nk)) byNew.set(nk, []);
  byNew.get(nk).push(r);
}

const collisions = [...byNew.entries()].filter(([k, rs]) => enforced(k) && rs.length > 1);
console.log(`  ${changed} row(s) would get a NEW topic_key under 0186`);
console.log(`  ${billKeyed} row(s) map to a bill:* key`);
console.log(`  ${blindToEnforced} row(s) move from the |unknown|unknown blind spot into enforced space`);
console.log(`  ${collisions.length} enforced key(s) have >1 live campaign → back-fill keeps the OLDER row's old key (canonical-safe), NOT a failure`);

if (collisions.length) {
  console.log("\n  --- collision clusters (first 15) ---");
  for (const [k, rs] of collisions.slice(0, 15)) {
    console.log(`  [${k}] ×${rs.length}`);
    for (const r of rs.slice(0, 4)) {
      console.log(`      ${r.id.slice(0, 8)} ${r.review_state.padEnd(13)} ${(r.title ?? "").slice(0, 70)}`);
    }
  }
  console.log("\n  → These are existing multi-campaign clusters for one bill/event. 0186 leaves");
  console.log("    them as-is (oldest keeps the canonical key); the cleanup crons / auto-approve");
  console.log("    engine collapse them at decision time. Optionally collapse pre-go-live.");
} else {
  console.log("  → No collisions: 0186's live-row back-fill is a clean 1:1 update. Safe to apply.");
}
process.exit(0);
