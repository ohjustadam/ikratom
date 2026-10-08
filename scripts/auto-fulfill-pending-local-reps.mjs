/**
 * Resolve every pending local_rep_requests row — no admin in the loop.
 *
 * Usage: node --env-file=.env.local scripts/auto-fulfill-pending-local-reps.mjs
 *
 * Owner directive 2026-05-16: process pending local-rep coverage requests
 * automatically. De-Gemini'd 2026-06-08 (private/LOCAL_REPS_DEGEMINI_PLAN.md):
 * resolution is findAndExtractOfficials — Legistar webapi first (authoritative,
 * keyless), then self-hosted SearXNG + local Ollama / free-tier Groq-Cerebras
 * to extract officials from a deterministically-fetched .gov page. NO Gemini,
 * NO Google-Search grounding, no per-day quota. Re-runnable; idempotent.
 *
 * Run this where the SearXNG/Ollama infra is reachable (owner box / self-hosted
 * runner) to drain the long tail the cloud crons leave queued.
 */
import { createClient } from "@supabase/supabase-js";
import { findAndExtractOfficials } from "./lib/officials-extract.mjs";
import { fetchPageText } from "./lib/page-text.mjs";
import { noCountyGovernment } from "./lib/no-county-government.mjs";
import { sameOfficial } from "./lib/official-names.mjs";

const t0 = Date.now();
const args = process.argv.slice(2);
const numArg = (f, dflt) => { const i = args.indexOf(f); const n = parseInt(args[i + 1] ?? "", 10); return i >= 0 && Number.isFinite(n) && n > 0 ? n : dflt; };
const LIMIT = numArg("--limit", 0);           // 0 = no cap
const MAX_MINUTES = numArg("--max-minutes", 0); // 0 = no wall-clock budget
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Two-source gate: confirm an extracted official's name actually appears on
// its cited source page before we publish the row. Uses the shared
// render-capable fetchPageText (headless-Chromium fallback for JS-built
// rosters — Cuyahoga County / San Jose / Greensboro class), so a JS-rendered
// roster no longer hard-fails verification and strands the locality on a thin
// static shell. Per-URL cache: an 11-member council shares one source page, so
// it costs one fetch/render, not eleven.
const _verifyTextCache = new Map();
async function pageTextForVerify(url) {
  if (_verifyTextCache.has(url)) return _verifyTextCache.get(url);
  const text = await fetchPageText(url); // null on hard failure / PDF / WAF
  const lc = text ? text.toLowerCase() : null;
  _verifyTextCache.set(url, lc);
  return lc;
}
async function verify(fullName, sourceUrl) {
  if (!sourceUrl) return { ok: false, reason: "no-url" };
  const text = await pageTextForVerify(sourceUrl);
  if (!text) return { ok: false, reason: "fetch-failed" };
  const fn = fullName.toLowerCase();
  const at = text.indexOf(fn);
  if (at >= 0) return { ok: true, snippet: text.slice(Math.max(0, at - 60), at + 120) };
  const last = fullName.split(/\s+/).pop()?.toLowerCase();
  if (last && last.length >= 4 && text.includes(last)) return { ok: true, snippet: `(last-name match: ${last})` };
  return { ok: false, reason: "name-not-found" };
}

// --probe "Clifton Park, NY" [--level county]: READ-ONLY end-to-end check of
// the resolver (Legistar → SearXNG → free-AI extract → page verification) for
// one locality. Prints what WOULD be inserted and exits; writes nothing. Lets
// the pipeline be proven before a batch of new requests depends on it.
const probeAt = args.indexOf("--probe");
if (probeAt >= 0) {
  const locality = String(args[probeAt + 1] ?? "").trim();
  const m = /^(.+),\s*([A-Z]{2})$/.exec(locality);
  if (!m) { console.error('--probe needs "Town, ST"'); process.exit(2); }
  const lvlAt = args.indexOf("--level");
  const level = lvlAt >= 0 ? args[lvlAt + 1] : /\b(county|parish|borough)\b/i.test(locality) ? "county" : "municipal";
  console.log(`PROBE ${locality} (${level}) — read-only`);
  const res = await findAndExtractOfficials({ sb, city: m[1], state: m[2], locality, level, caller: "auto-fulfill-probe" });
  if (!res.ok) { console.log(`  result: ${res.queued ? `queued (${res.reason}${res.detail ? `: ${res.detail}` : ""})` : `error (${res.error ?? "0 officials"})`}`); process.exit(res.queued ? 0 : 1); }
  console.log(`  source: ${res.source} · ${res.officials.length} official(s)`);
  let verified = 0;
  for (const o of res.officials) {
    const v = res.source === "legistar" ? { ok: true } : await verify(o.full_name, o.source_url);
    if (v.ok) verified++;
    console.log(`  ${v.ok ? "✓" : "✗"} ${o.full_name} · ${o.title ?? o.role ?? "?"} · email:${o.email ? "yes" : "no"} phone:${o.phone ? "yes" : "no"}${v.ok ? "" : ` (${v.reason})`}`);
  }
  console.log(`  would insert ${verified} of ${res.officials.length}`);
  process.exit(verified > 0 ? 0 : 1);
}

let pq = sb
  .from("local_rep_requests")
  .select("id, state, locality, level")
  .eq("status", "pending")
  .order("created_at", { ascending: true }); // oldest requests first
if (LIMIT > 0) pq = pq.limit(LIMIT);
const { data: pending, error: pendErr } = await pq;
if (pendErr) {
  // Surface the failure in telemetry rather than mis-reporting as "empty".
  try {
    await sb.from("scraper_runs").insert({
      source: "auto_fulfill_local_reps", started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(), status: "fail", rows_added: 0,
      notes: `pending query failed: ${pendErr.message}`.slice(0, 200),
    });
  } catch { /* best-effort */ }
  console.error(pendErr.message); process.exit(1);
}
console.log(`pending: ${pending?.length ?? 0}${LIMIT ? ` (capped at ${LIMIT})` : ""}`);

// Write the outcome onto the request so /admin/local-rep-requests can say WHY
// it's still pending (src/lib/local-rep-attempt.ts renders the code). Without
// this the admin only ever saw "check back shortly" — even for a city site
// behind a bot check that no retry will ever get past. Best-effort.
async function recordAttempt(req, reason, detail) {
  const { error } = await sb.from("local_rep_requests")
    .update({
      last_attempt_at: new Date().toISOString(),
      last_attempt_reason: String(reason).slice(0, 40),
      last_attempt_detail: detail ? String(detail).slice(0, 200) : null,
    })
    .eq("state", req.state).eq("locality", req.locality).eq("level", req.level).eq("status", "pending");
  if (error) console.log(`  ⚠ couldn't record attempt: ${error.message?.slice(0, 80)}`);
}

const seen = new Set();
let totalInserted = 0;
let totalSkipped = 0;
let budgetHit = false;
// Circuit breaker for INFRA-down only (Ollama OOM / SearXNG flailing) — a long
// streak of infra-flavored misses means the box is unhealthy, so abort. A
// per-locality CONTENT miss (no roster found, WAF-blocked page like San
// Jose/Greensboro, no candidate) must NEVER count here: otherwise a few hard
// localities at the front of the queue strand every resolvable request behind
// them forever (the bug that left 8 requests pending for >1 week).
let consecutiveInfraMiss = 0;
const INFRA_STREAK_STOP = 8;

for (const req of pending ?? []) {
  if (MAX_MINUTES > 0 && Date.now() - t0 > MAX_MINUTES * 60_000) {
    budgetHit = true;
    console.log(`\n⏱ wall-clock budget (${MAX_MINUTES}m) reached — remaining requests drain next run`);
    break;
  }
  const key = `${req.state}|${req.locality}|${req.level}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`\n--- ${req.locality} (${req.level}) ---`);
  const city = req.locality.replace(/,\s*[A-Z]{2}$/, "");

  // A county with no county government (CT, RI, most of MA) can never be
  // fulfilled — reject it with the reason instead of churning no-extract
  // forever. Only for NEW coverage: a county that already has officers on file
  // (Middlesex MA keeps its sheriff/DA rows) is never auto-rejected.
  const noGov = req.level === "county" ? noCountyGovernment(req.state, req.locality) : null;
  if (noGov) {
    const { count: onFile } = await sb.from("legislators").select("id", { count: "exact", head: true })
      .eq("locality", req.locality).eq("level", "county").eq("active", true);
    if (!onFile) {
      console.log(`  ⊘ no county government — marking rejected`);
      await sb.from("local_rep_requests")
        .update({ status: "rejected", resolved_at: new Date().toISOString(), reject_reason: noGov })
        .eq("state", req.state).eq("locality", req.locality).eq("level", req.level).eq("status", "pending");
      continue;
    }
  }

  const res = await findAndExtractOfficials({
    sb, city, state: req.state, locality: req.locality, level: req.level, caller: "auto-fulfill-pending-cli",
  });

  if (res.queued) {
    if (res.reason === "searxng-unconfigured") {
      console.log("  ⚠ SEARXNG_URL not configured — run this where the local search+Ollama infra is reachable. Stopping.");
      break;
    }
    if (res.reason === "unincorporated-cdp") {
      // A Census-designated place / unincorporated community has no municipal
      // government to find — its local government is the parent county/parish.
      // Mark rejected (with a reason naming the parish, when known) so it stops
      // being retried every night (like Elkhorn CDP / Poydras, LA).
      const reason = res.parentAdmin
        ? `Unincorporated community — no city government. Local government is ${res.parentAdmin}.`
        : `Unincorporated community (CDP) — no municipal government to resolve.`;
      console.log(`  ⊘ unincorporated (no local government) — marking rejected${res.parentAdmin ? ` → ${res.parentAdmin}` : ""}`);
      await sb.from("local_rep_requests")
        .update({ status: "rejected", resolved_at: new Date().toISOString(), reject_reason: reason.slice(0, 200) })
        .eq("state", req.state).eq("locality", req.locality).eq("level", req.level).eq("status", "pending");
      continue;
    }
    console.log(`  ⏳ queued (${res.reason}${res.detail ? `: ${res.detail}` : ""}) — left pending`);
    await recordAttempt(req, res.reason, res.detail);
    // Only infra-flavored reasons feed the breaker; content misses fall through.
    if (res.reason === "no-extract" || res.reason === "searxng-empty") {
      consecutiveInfraMiss++;
      if (consecutiveInfraMiss >= INFRA_STREAK_STOP) {
        console.log(`  ⚠ ${consecutiveInfraMiss} infra-misses in a row — box infra likely down; stopping.`);
        break;
      }
    }
    continue;
  }
  if (!res.ok || res.officials.length === 0) {
    // Content miss (e.g. WAF-blocked roster) — leave pending, retried next
    // run, but DO NOT strand the rest of the queue behind it.
    console.log(`  ✗ no officials: ${res.error ?? "0 returned"} — left pending (queue continues)`);
    await recordAttempt(req, "no-officials", null);
    continue;
  }
  consecutiveInfraMiss = 0;

  const fromLegistar = res.source === "legistar";
  console.log(`  ${fromLegistar ? "Legistar (clerk)" : res.source}: ${res.officials.length} official(s)`);

  const { data: existing } = await sb.from("legislators").select("id, full_name, term_end_date").eq("level", req.level).eq("locality", req.locality).eq("active", true);
  // Spelling-tolerant matching ("Pilar Faulkner" = "Pilar F.H. Faulkner",
  // "Kenneth" = "Ken"): exact-string matching inserted duplicates AND left the
  // real row un-re-confirmed (2026-10-07: Santa Fe, Trenton, Westchester).
  const onRoster = (name) => res.officials.some((o) => sameOfficial(o.full_name, name));
  const alreadyInDb = (name) => (existing ?? []).some((r) => sameOfficial(r.full_name, name));

  // REFRESH (2026-10-03): a locality re-queued by refresh-local-rosters.mjs
  // already has officials. Members still on the fresh roster get their check
  // date bumped (the meeting page shows it). A member missing from it is
  // retired only on strong evidence — the clerk's own system (Legistar) no
  // longer lists them, or their recorded term has ended — and never when the
  // fresh roster looks partial (an AI extract that found 3 of 9 members).
  const stillThere = (existing ?? []).filter((r) => onRoster(r.full_name));
  if (stillThere.length) {
    await sb.from("legislators").update({ last_synced_at: new Date().toISOString() }).in("id", stillThere.map((r) => r.id));
    console.log(`  ↻ re-confirmed ${stillThere.length} existing official(s)`);
  }
  const gone = (existing ?? []).filter((r) => !onRoster(r.full_name));
  const looksComplete = res.officials.length >= Math.ceil((existing ?? []).length * 0.6);
  for (const r of gone) {
    const termEnded = r.term_end_date && Date.parse(r.term_end_date) < Date.now();
    if (looksComplete && (fromLegistar || termEnded)) {
      await sb.from("legislators").update({ active: false, last_synced_at: new Date().toISOString() }).eq("id", r.id);
      console.log(`    − ${r.full_name}: retired (${fromLegistar ? "not on the clerk roster" : "term ended"})`);
    } else {
      console.log(`    ? ${r.full_name}: not re-confirmed — kept (${looksComplete ? "no strong evidence" : "fresh roster looks partial"})`);
    }
  }

  const rows = [];
  for (const o of res.officials) {
    if (alreadyInDb(o.full_name)) { console.log(`    = ${o.full_name}: already in DB`); continue; }
    let md;
    if (fromLegistar) {
      md = [
        `- Tier: **verified** (Legistar — official clerk system)`,
        o.source_url ? `- Source: ${o.source_url}` : null,
        o.source_note ? `- ${o.source_note}` : null,
      ].filter(Boolean).join("\n");
    } else {
      const v = await verify(o.full_name, o.source_url);
      if (!v.ok) { console.log(`    ✗ ${o.full_name}: ${v.reason}`); totalSkipped++; continue; }
      md = [
        o.source_url ? `- Source: ${o.source_url}` : null,
        `- Verifier snippet: "${v.snippet}"`,
        o.source_note ? `- ${o.source_note}` : null,
      ].filter(Boolean).join("\n");
    }
    rows.push({
      state: req.state,
      role: o.role || "other_local",
      district: o.district,
      full_name: o.full_name,
      party: o.party,
      email: o.email,
      phone: o.phone,
      website: o.website,
      title: o.title,
      level: req.level,
      locality: req.locality,
      body: req.level === "municipal" ? "city_council" : "county_commission",
      active: true,
      term_end_date: o.term_end_date ?? null,
      verified_sources_md: md,
      last_synced_at: new Date().toISOString(),
    });
    console.log(`    ✓ ${o.full_name} → ${fromLegistar ? "Legistar" : "verified"}`);
  }
  if (rows.length > 0) {
    const { error } = await sb.from("legislators").insert(rows);
    if (error) { console.log(`  ✗ insert: ${error.message}`); continue; }
    console.log(`  ✓ inserted ${rows.length}`);
    totalInserted += rows.length;
  }

  // Fulfill only when the locality now has officials (inserted or already
  // present). If every extracted official failed verification, leave pending.
  // A REFRESH whose fresh roster is partial is not done either: 2026-10-07 the
  // batch closed Westchester (1 of 18 re-confirmed), Hartford, Dover, DC and
  // Springfield IL after reading one person each, leaving the rest unchecked.
  const covered = rows.length > 0 || (existing ?? []).length > 0;
  if (covered && (existing ?? []).length > 0 && !looksComplete) {
    console.log(`  ⏳ partial roster (${res.officials.length} found vs ${existing.length} on file) — left pending`);
    await recordAttempt(req, "partial-roster", `${res.officials.length} of ${existing.length}`);
    continue;
  }
  if (covered) {
    await sb.from("local_rep_requests").update({ status: "fulfilled", resolved_at: new Date().toISOString() })
      .eq("state", req.state).eq("locality", req.locality).eq("level", req.level).eq("status", "pending");
    // Notify requesters + residents via the shared RPC (0193) — the gap that
    // left 17 requesters silently unserved before 2026-06-09. Best-effort;
    // push rides the hourly fan-out (DND/quiet-hours respected there).
    const { data: notified, error: notifyErr } = await sb.rpc("notify_locality_residents", {
      p_state: req.state,
      p_locality: req.locality,
      p_official_names: rows.map((r) => r.full_name),
    });
    if (notifyErr) console.log(`  ⚠ notify RPC failed: ${notifyErr.message?.slice(0, 80)}`);
    else if (notified > 0) console.log(`  ◇ notified ${notified} requester(s)/resident(s)`);
  }
}
console.log(`\n=== TOTAL: inserted ${totalInserted} · skipped ${totalSkipped} ===`);
try {
  // Self-monitoring (standing rule #6): this runs on the owner box's nightly
  // scheduled task ("local" system in check-cron-staleness), where SearXNG +
  // Ollama are reachable — it's what drains the long-tail queue.
  await sb.from("scraper_runs").insert({
    source: "auto_fulfill_local_reps",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: totalInserted > 0 ? "success" : (seen.size === 0 ? "empty" : "success"),
    rows_added: totalInserted,
    notes: `${seen.size} localities processed · ${totalInserted} officials inserted · ${totalSkipped} skipped by verification${budgetHit ? " · budget-hit" : ""}`,
  });
} catch { /* best-effort */ }
