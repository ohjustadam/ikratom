#!/usr/bin/env node
/**
 * sweep-locality-intel.mjs — the unified LOCALITY INTELLIGENCE sweep (PR-A).
 *
 * While a locality is "on the table" we capture EVERYTHING in one pass, not
 * a single-purpose check: its current legal framework (ordinance/code +
 * any kratom measure being pushed, with dates/sponsors when stated), plus
 * derived links to its officials (legislators) and next council meeting
 * (municipal_meetings). Output: one locality_intel record (migration 0192)
 * powering /banned, the dashboard war-room, and the Dossier.
 *
 * Work source: locality_intel rows with sweep_status='queued' — queued by
 * extract-news-officials (every news story's locality) or by hand. Held-ban
 * localities are covered separately by verify-local-bans.mjs, which writes
 * the same intel record as a byproduct.
 *
 * If the locality ALSO has a held local-ban bills row of the same scope, the
 * verification-gate write is applied here too (same hardened gate + the same
 * gazetteer stateOk check verify-local-bans applies) so one sweep settles
 * both records.
 *
 * Queue hygiene: every attempt stamps attempts/last_attempt_at and rows
 * rotate stalest-first, so a dead locality can't head-of-line block; after 5
 * fruitless attempts a row flips to 'failed' (visible, re-queueable).
 *
 * Runs on the owner box (SearXNG + Ollama). Cloud runs no-op gracefully.
 *
 *   node --env-file=.env.local scripts/sweep-locality-intel.mjs --limit 15
 *   node --env-file=.env.local scripts/sweep-locality-intel.mjs --state MS --dry-run
 *   node --env-file=.env.local scripts/sweep-locality-intel.mjs --locality "Monroe County" --state MS
 */
import { createClient } from "@supabase/supabase-js";
import { verifyLocalBan } from "./lib/ban-verify.mjs";
import { upsertLocalityIntel, canonicalLocality } from "./lib/locality-intel.mjs";
import { reconcileLocality } from "./lib/geo-resolver.mjs";
import { searxngConfigured } from "./lib/searxng.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); const v = args[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : null; };
const num = (v, dflt) => { const n = parseInt(v ?? "", 10); return Number.isFinite(n) && n > 0 ? n : dflt; };
const LIMIT = num(arg("--limit"), 15);
const MAX_MINUTES = num(arg("--max-minutes"), 60);
const STATE = arg("--state");
const LOCALITY = arg("--locality");
const DRY = args.includes("--dry-run");
const MAX_ATTEMPTS = 5;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const t0 = Date.now();
const NOW = () => new Date().toISOString();

if (!searxngConfigured()) {
  console.log("sweep-locality-intel: SEARXNG_URL not configured — nothing to do here (the box drains the queue).");
  process.exit(0);
}

let targets = [];
if (LOCALITY && STATE) {
  targets = [{ state: STATE.toUpperCase(), locality: canonicalLocality(LOCALITY), scope: /\b(county|parish|borough)\b/i.test(LOCALITY) ? "county" : "municipal", attempts: 0 }];
} else {
  let q = sb.from("locality_intel")
    .select("state, locality, scope, attempts")
    .eq("sweep_status", "queued")
    .order("last_attempt_at", { ascending: true, nullsFirst: true })
    .limit(LIMIT);
  if (STATE) q = q.eq("state", STATE.toUpperCase());
  const { data, error } = await q;
  if (error) {
    // Table missing (0192 not applied yet) is a clean no-op, not a failure.
    console.log(`sweep-locality-intel: ${error.message} — is migration 0192 applied?`);
    process.exit(0);
  }
  targets = data ?? [];
}

console.log(`sweep-locality-intel: ${targets.length} queued localit${targets.length === 1 ? "y" : "ies"}${DRY ? " [DRY]" : ""}\n`);

let swept = 0, failed = 0, gated = 0, queuedAgain = 0;
let budgetHit = false;

async function stampAttempt(t, { exhaust = false } = {}) {
  if (DRY) return;
  try {
    const upd = { attempts: (t.attempts ?? 0) + 1, last_attempt_at: NOW() };
    if (exhaust && upd.attempts >= MAX_ATTEMPTS) { upd.sweep_status = "failed"; upd.sweep_note = `no usable pages after ${upd.attempts} attempts`; }
    await sb.from("locality_intel").update(upd).eq("state", t.state).eq("locality", t.locality);
  } catch { /* best-effort */ }
}

for (const t of targets) {
  if (Date.now() - t0 > MAX_MINUTES * 60_000) { budgetHit = true; console.log(`  ⏱ wall-clock budget (${MAX_MINUTES}m) reached — stopping cleanly`); break; }
  const tag = `[${t.state}] ${t.locality}`;
  try {
    const r = await verifyLocalBan({ sb, state: t.state, locality: t.locality, caller: "sweep_locality_intel" });
    if (r.queued) {
      queuedAgain++;
      console.log(`  ⏸ ${tag} (${r.reason})`);
      // Infra-down reasons leave the row pristine; content-empty reasons
      // count an attempt so dead localities rotate back and eventually fail.
      if (!["searxng-unconfigured"].includes(r.reason)) await stampAttempt(t, { exhaust: true });
      continue;
    }

    // If a held local-ban bills row of this scope exists, settle it with the
    // same gate + gazetteer stateOk check verify-local-bans applies.
    if (!DRY && (r.outcome === "confirmed" || r.outcome === "repealed")) {
      const loc = reconcileLocality({ aiLocality: t.state, scopeState: t.state, text: t.locality ?? "" });
      const stateOk = loc.corroborated || loc.locality === t.state || loc.locality === "ALL";
      if (r.outcome === "repealed" || stateOk) {
        const { data: billRows } = await sb.from("bills")
          .select("id, verification_status")
          .eq("scope", t.scope === "county" ? "county" : "municipal")
          .eq("state", t.state)
          .in("locality", [t.locality, `${t.locality}, ${t.state}`])
          .in("verification_status", ["single_source", "unverified"]);
        for (const b of billRows ?? []) {
          const upd = r.outcome === "confirmed"
            ? { verification_status: "confirmed", active: true, status: "enacted", verified_at: NOW(), verification_note: `Confirmed by locality sweep: ${r.reason}.`, verification_sources: r.sources }
            : { verification_status: "repealed", active: false, verified_at: NOW(), verification_note: `Repealed${r.repeal_date ? ` (${r.repeal_date})` : ""}; via locality sweep.`, verification_sources: r.sources };
          await sb.from("bills").update(upd).eq("id", b.id);
          gated++;
        }
      }
    }

    const intel = await upsertLocalityIntel({ sb, state: t.state, locality: t.locality, scope: t.scope, result: r, dry: DRY });
    await stampAttempt(t);
    if (intel.ok) { swept++; console.log(`  ✓ ${tag} → ${r.outcome} (${(r.sources ?? []).length} src, ${(r.pending ?? []).length} pending)`); }
    else { failed++; console.log(`  ✗ ${tag} intel write: ${intel.error?.slice(0, 80)}`); }

    await new Promise((res) => setTimeout(res, 1000));
  } catch (e) {
    failed++;
    console.log(`  ✗ ${tag}: ${(e.message ?? "").slice(0, 80)}`);
  }
}

const total = targets.length;
const allQueued = total > 0 && queuedAgain === total;
console.log(`\nDone. swept=${swept} failed=${failed} bills_gated=${gated} requeued=${queuedAgain}${budgetHit ? " (budget hit)" : ""}`);
try {
  await sb.from("scraper_runs").insert({
    source: "sweep_locality_intel",
    started_at: new Date(t0).toISOString(),
    finished_at: NOW(),
    // all-queued = zero intelligence captured (infra down) — show red.
    status: allQueued || (failed > 0 && swept === 0) ? "fail" : "success",
    rows_updated: swept,
    notes: `swept=${swept} failed=${failed} bills_gated=${gated} requeued=${queuedAgain}${budgetHit ? " budget-hit" : ""}${DRY ? " [dry-run]" : ""}`,
  });
} catch { /* best-effort */ }
process.exit(0);
