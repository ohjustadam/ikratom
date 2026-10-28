#!/usr/bin/env node
/**
 * fulfill-local-reps-from-roster.mjs — close local rep requests the automatic
 * resolver can't, from rosters read off the OFFICIAL page by a person or a real
 * browser (the trunk, 2026-10-28).
 *
 * WHY: auto-fulfill-pending-local-reps.mjs (and its cloud twin) leave a request
 * pending when the county site blocks scripts (Kings Co CA, Johnson Co TX:
 * 403), when the search lands on a same-named town in another state (Caledonia
 * MS → caledoniamn.gov, refused by the wrong-state gate), or when a refresh
 * reads only part of a roster (Corinth MS, 1 of 7). Those requests churned every
 * 6 hours forever. A browser reads those pages fine. This script takes what it
 * read, with the page it came from, and applies the SAME rules as the
 * resolver: spelling-tolerant matching (sameOfficial), insert only who is
 * missing, re-confirm who is still there, then fulfill and notify.
 *
 * Input: a JSON array of
 *   { state, locality, level: "county"|"municipal", source_url,
 *     officials: [{ full_name, title, role, district?, email?, phone?, term_end_date? }] }
 *
 * It never retires anyone: a member missing from the roster is reported, not
 * deactivated (the resolver's refresh path owns retirement, with Legistar or a
 * term-end as evidence).
 *
 *   node --env-file=.env.local scripts/fulfill-local-reps-from-roster.mjs rosters.json           # dry run
 *   node --env-file=.env.local scripts/fulfill-local-reps-from-roster.mjs rosters.json --apply
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { sameOfficial } from "./lib/official-names.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const file = args.find((a) => !a.startsWith("--"));
if (!file) { console.error("usage: fulfill-local-reps-from-roster.mjs <rosters.json> [--apply]"); process.exit(2); }
const rosters = JSON.parse(fs.readFileSync(file, "utf8"));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const today = new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

console.log(`fulfill-local-reps-from-roster ${APPLY ? "(APPLY)" : "(dry run)"}: ${rosters.length} localit${rosters.length === 1 ? "y" : "ies"}`);
let inserted = 0, confirmed = 0, fulfilled = 0;

for (const r of rosters) {
  if (!r.source_url || !/^https:\/\//.test(r.source_url)) throw new Error(`${r.locality}: every roster needs its https source_url`);
  if (!r.officials?.length) throw new Error(`${r.locality}: empty roster`);
  console.log(`\n--- ${r.locality} (${r.level}) · ${r.officials.length} on the official page · ${r.source_url}`);

  const { data: existing, error } = await sb.from("legislators").select("id, full_name")
    .eq("level", r.level).eq("locality", r.locality).eq("active", true);
  if (error) throw new Error(error.message);

  const still = (existing ?? []).filter((e) => r.officials.some((o) => sameOfficial(o.full_name, e.full_name)));
  const missingFromPage = (existing ?? []).filter((e) => !still.includes(e));
  const toAdd = r.officials.filter((o) => !(existing ?? []).some((e) => sameOfficial(o.full_name, e.full_name)));

  for (const e of still) console.log(`    = ${e.full_name}: on the page (re-confirmed)`);
  for (const e of missingFromPage) console.log(`    ? ${e.full_name}: on file but NOT on the page (kept; review)`);
  for (const o of toAdd) console.log(`    + ${o.full_name} — ${o.title}`);

  const md = `- Tier: **verified** (official roster page, read ${today})\n- Source: ${r.source_url}`;
  const rows = toAdd.map((o) => ({
    state: r.state, level: r.level, locality: r.locality,
    role: o.role, body: r.level === "municipal" ? "city_council" : "county_commission",
    title: o.title, district: o.district ?? null, full_name: o.full_name,
    email: o.email ?? null, phone: o.phone ?? null, website: r.source_url,
    term_end_date: o.term_end_date ?? null,
    active: true, verified_sources_md: md, last_synced_at: now(),
  }));

  if (!APPLY) { inserted += rows.length; confirmed += still.length; fulfilled++; continue; }

  if (still.length) {
    await sb.from("legislators").update({ last_synced_at: now() }).in("id", still.map((e) => e.id));
    confirmed += still.length;
  }
  if (rows.length) {
    const { error: insErr } = await sb.from("legislators").insert(rows);
    if (insErr) { console.log(`  ✗ insert: ${insErr.message} — request left pending`); continue; }
    inserted += rows.length;
  }
  const { data: closed } = await sb.from("local_rep_requests")
    .update({ status: "fulfilled", resolved_at: now() })
    .eq("state", r.state).eq("locality", r.locality).eq("level", r.level).eq("status", "pending").select("id");
  fulfilled += closed?.length ? 1 : 0;
  console.log(`  ✓ ${rows.length} added, ${still.length} re-confirmed, ${closed?.length ?? 0} request(s) fulfilled`);
  if (rows.length) {
    const { data: n, error: nErr } = await sb.rpc("notify_locality_residents", {
      p_state: r.state, p_locality: r.locality, p_official_names: rows.map((x) => x.full_name),
    });
    if (nErr) console.log(`  ⚠ notify: ${nErr.message.slice(0, 80)}`);
    else if (n > 0) console.log(`  ◇ notified ${n} requester(s)/resident(s)`);
  }
}

console.log(`\n${APPLY ? "Done" : "Would do"}: ${inserted} added, ${confirmed} re-confirmed, ${fulfilled} localities fulfilled.`);
if (APPLY) {
  await sb.from("scraper_runs").insert({
    source: "local_reps_from_roster", started_at: now(), finished_at: now(), status: "success",
    rows_updated: inserted + confirmed, notes: `${fulfilled} fulfilled from official rosters (${rosters.map((r) => r.locality).join("; ")})`.slice(0, 500),
  });
}
