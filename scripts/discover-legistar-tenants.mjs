#!/usr/bin/env node
/**
 * discover-legistar-tenants.mjs — grow the FREE Legistar officials source.
 *
 * For every (locality, state) we serve or are asked about that isn't already
 * a known Legistar tenant, probe candidate {client}.legistar.com slugs and
 * cache the result in `legistar_tenants`. This widens the deterministic,
 * key-less officials source so fewer localities need the SearXNG+Ollama long
 * tail — and ZERO need Gemini.
 *
 * Safe by construction (see legistar-resolver.mjs): a slug is only accepted
 * when the place/county name is unique to the expected state (per the Census
 * gazetteer) OR the slug carries the state code, AND member addresses don't
 * contradict the state, AND the tenant's bodies match the requested government
 * LEVEL (county → board of supervisors/commissioners; city → city council).
 * Cross-state AND cross-level slug collisions can't seed wrong tenants
 * ("salem" = City of Salem, OR — rejected for Salem County, NJ). Incremental:
 * skips localities already in the hand list or cache, so daily runs whittle
 * down the long tail without re-probing.
 *
 *   node --env-file=.env.local scripts/discover-legistar-tenants.mjs
 *   node --env-file=.env.local scripts/discover-legistar-tenants.mjs --limit 500
 *   node --env-file=.env.local scripts/discover-legistar-tenants.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { runWithLogging } from "./lib/scraper-run.mjs";
import { discoverTenant, normLoc, upsertTenant } from "./lib/legistar-resolver.mjs";
import { LEGISTAR_TENANTS } from "./lib/legistar-tenants.mjs";
import { GRANICUS_TENANTS } from "./lib/granicus-tenants.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const LIMIT = parseInt(arg("--limit") ?? "250", 10);

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

await runWithLogging({ source: "discover_legistar_tenants", supabase: sb }, async () => {
  // Demand set: localities we actually serve / are asked about, plus big
  // Granicus cities (many are also on the Legistar webapi).
  const demand = new Map(); // `${ST}|${normLoc}` -> { state, locality }
  const add = (state, locality) => {
    if (!state || !locality) return;
    const st = String(state).toUpperCase();
    if (!/^[A-Z]{2}$/.test(st)) return;
    const k = `${st}|${normLoc(locality)}`;
    if (normLoc(locality) && !demand.has(k)) demand.set(k, { state: st, locality });
  };

  const { data: legs } = await sb.from("legislators").select("state, locality").in("level", ["municipal", "county"]).limit(5000);
  for (const r of legs ?? []) add(r.state, r.locality);
  const { data: reqs } = await sb.from("local_rep_requests").select("state, locality").eq("status", "pending").limit(2000);
  for (const r of reqs ?? []) add(r.state, r.locality);
  const { data: bills } = await sb.from("bills").select("state, locality").not("locality", "is", null).in("scope", ["municipal", "county"]).limit(3000);
  for (const r of bills ?? []) add(r.state, r.locality);
  for (const t of GRANICUS_TENANTS) add(t.state, t.locality);

  // Skip the hand list, probed-and-missing rows, and post-gate live rows.
  // Live rows with body IS NULL are PRE-LEVEL-GATE discoveries (the gate
  // always stores a body) — leave them OUT of the skip-set so they re-enter
  // the probe queue and get revalidated through the gate (backfilling body on
  // pass, flipping to 'none' on fail). This is the self-heal for the
  // Salem-OR / Oakland-CA cross-level collisions that pre-gate probing cached.
  const known = new Set(LEGISTAR_TENANTS.map((t) => `${t.state.toUpperCase()}|${normLoc(t.locality)}`));
  const { data: cached } = await sb.from("legistar_tenants").select("state, locality, probe_status, body");
  for (const t of cached ?? []) {
    if (t.probe_status === "live" && !t.body) continue; // pre-gate row → re-probe
    known.add(`${String(t.state).toUpperCase()}|${normLoc(t.locality)}`);
  }

  const todo = [...demand.entries()].filter(([k]) => !known.has(k)).map(([, v]) => v).slice(0, LIMIT);
  console.log(`Demand ${demand.size} · already known ${known.size} · probing ${todo.length}${DRY ? " (dry-run)" : ""}`);

  let live = 0, none = 0;
  for (const { state, locality } of todo) {
    let found = null;
    try { found = await discoverTenant({ locality, state }); } catch { /* skip-bad-item self-heal */ }
    if (found) {
      live++;
      console.log(`  ✓ ${locality} → ${found.client}`);
      if (!DRY) await upsertTenant(sb, { state, locality, subdomain: found.client, webapi_client: found.client, body: found.body, probe_status: "live" });
    } else {
      none++;
      if (!DRY) await upsertTenant(sb, { state, locality, probe_status: "none" });
    }
  }
  console.log(`Done — ${live} live Legistar tenant(s) discovered, ${none} not on Legistar.`);
  return {
    rowsAdded: DRY ? 0 : live,
    rowsUpdated: 0,
    notes: `${todo.length} probed · ${live} live · ${none} none${DRY ? " (dry-run)" : ""}`,
  };
});
