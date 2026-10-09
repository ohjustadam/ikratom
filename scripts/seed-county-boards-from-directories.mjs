#!/usr/bin/env node
/**
 * seed-county-boards-from-directories.mjs — fill county governing boards from
 * statewide directories (scripts/lib/county-directories.mjs). Deterministic:
 * one fetch per state, markup parsing, no search and no model.
 *
 * WHY (2026-10-09): ~80 of 3,143 counties had officials on file; North Dakota
 * had 7 of 53, while the ND Association of Counties publishes all 53 boards on
 * one page. Owner asked to fill whole states wherever such a source exists.
 *
 * Per county:
 *   - inserts directory members not already on file (name match: first
 *     initial + last name), so hand-added or batch rows are never duplicated;
 *   - deactivates ONLY rows this script inserted earlier (their
 *     verified_sources_md names the directory URL) once the directory no
 *     longer lists them, so the roster follows elections;
 *   - leaves every other row alone and just counts it as "not in directory";
 *   - closes pending coverage requests for the county and notifies, like the
 *     batch does.
 * A parse that names far fewer counties than the state has is refused: the
 * page changed shape, and writing a partial state would look like coverage.
 *
 *   node --env-file=.env.local scripts/seed-county-boards-from-directories.mjs --dry-run [--state ND]
 */
import { createClient } from "@supabase/supabase-js";
import { COUNTY_DIRECTORIES, boardOnly, nameKey } from "./lib/county-directories.mjs";

const DRY = process.argv.includes("--dry-run");
const stAt = process.argv.indexOf("--state");
const ONLY = stAt > 0 ? String(process.argv[stAt + 1] ?? "").toUpperCase() : null;
const UA = "Mozilla/5.0 (compatible; iKratomBot/1.0; +contact@ikratom.org)";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const startedAt = new Date().toISOString();
const today = startedAt.slice(0, 10);
const totals = { states: 0, counties: 0, inserted: 0, deactivated: 0, notInDirectory: 0, requestsClosed: 0 };
const notes = [];
let failed = false;

for (const [state, cfg] of Object.entries(COUNTY_DIRECTORIES)) {
  if (ONLY && state !== ONLY) continue;
  const parsed = [];
  try {
    let urls = cfg.urls ?? [cfg.url];
    if (cfg.linksFrom) {
      // An index page that links one directory page per county.
      const r = await fetch(cfg.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${cfg.url}`);
      urls = cfg.linksFrom(await r.text());
    }
    for (const url of urls) {
      const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      parsed.push(...cfg.parse(await r.text()));
      if (urls.length > 3) await new Promise((res) => setTimeout(res, 800)); // polite pacing
    }
  } catch (e) {
    failed = true; notes.push(`${state}: fetch failed (${e.message})`); console.log(`✗ ${state}: ${e.message}`); continue;
  }
  const people = boardOnly(parsed);
  const byCounty = new Map();
  for (const p of people) byCounty.set(p.county, [...(byCounty.get(p.county) ?? []), p]);
  if (byCounty.size < Math.ceil(cfg.counties * 0.9)) {
    failed = true;
    notes.push(`${state}: parse named ${byCounty.size}/${cfg.counties} counties — refused (page changed shape?)`);
    console.log(`✗ ${state}: only ${byCounty.size}/${cfg.counties} counties parsed — refusing to write`);
    continue;
  }
  totals.states++;
  console.log(`${state}: ${people.length} board members across ${byCounty.size} counties`);

  for (const [county, members] of byCounty) {
    totals.counties++;
    const locality = `${county}, ${state}`;
    const { data: existing, error: exErr } = await sb.from("legislators")
      .select("id, full_name, verified_sources_md").eq("level", "county").eq("active", true).eq("locality", locality);
    if (exErr) { failed = true; notes.push(`${locality}: ${exErr.message}`); continue; }
    const have = new Map((existing ?? []).map((r) => [nameKey(r.full_name), r]));
    const dirKeys = new Set(members.map((m) => nameKey(m.full_name)));

    const rows = members.filter((m) => !have.has(nameKey(m.full_name))).map((m) => ({
      state, role: m.role ?? "county_commissioner", district: null, full_name: m.full_name,
      party: cfg.party ?? null, email: m.email, phone: m.phone, website: cfg.url, title: m.title,
      level: "county", locality, body: "county_commission", active: true, term_end_date: null,
      verified_sources_md: `- Source: ${cfg.url}\n- ${cfg.label}, read ${today} (deterministic parse of the official directory, no AI).`,
      last_synced_at: new Date().toISOString(),
    }));
    const gone = (existing ?? []).filter((r) => !dirKeys.has(nameKey(r.full_name)));
    const ours = gone.filter((r) => String(r.verified_sources_md ?? "").includes(cfg.url));
    totals.notInDirectory += gone.length - ours.length;

    if (rows.length || ours.length) {
      console.log(`  ${locality}: +${rows.length}${ours.length ? ` −${ours.length}` : ""}${gone.length - ours.length ? ` (${gone.length - ours.length} on file not in directory, left alone)` : ""}`);
    }
    if (DRY) { totals.inserted += rows.length; totals.deactivated += ours.length; continue; }

    if (rows.length) {
      const { error } = await sb.from("legislators").insert(rows);
      if (error) { failed = true; notes.push(`${locality}: insert ${error.message}`); continue; }
      totals.inserted += rows.length;
    }
    for (const r of ours) {
      const { error } = await sb.from("legislators").update({
        active: false,
        verified_sources_md: `${r.verified_sources_md ?? ""}\n- No longer listed in the ${cfg.label} on ${today}; deactivated.`.trim(),
      }).eq("id", r.id);
      if (!error) totals.deactivated++;
    }
    const { data: closed } = await sb.from("local_rep_requests")
      .update({ status: "fulfilled", resolved_at: new Date().toISOString(), last_attempt_reason: null, last_attempt_detail: null })
      .eq("state", state).eq("locality", locality).eq("level", "county").eq("status", "pending").select("id");
    if (closed?.length) {
      totals.requestsClosed += closed.length;
      await sb.rpc("notify_locality_residents", { p_state: state, p_locality: locality, p_official_names: rows.map((r) => r.full_name) });
    }
  }
}

const summary = `${DRY ? "[dry-run] " : ""}states ${totals.states} · counties ${totals.counties} · +${totals.inserted} · −${totals.deactivated} · not-in-directory ${totals.notInDirectory} · requests closed ${totals.requestsClosed}`;
console.log(`\n${summary}${notes.length ? `\n${notes.join("\n")}` : ""}`);
if (!DRY && !ONLY) {
  await sb.from("scraper_runs").insert({
    source: "seed_county_directories", started_at: startedAt, finished_at: new Date().toISOString(),
    status: failed ? "error" : "success", rows_updated: totals.inserted + totals.deactivated,
    notes: [summary, ...notes].join(" | ").slice(0, 2000),
  });
}
if (failed) process.exitCode = 1;
