#!/usr/bin/env node
/**
 * Two-source verification engine for LOCAL kratom bans — the failsafe behind
 * migration 0190. "Don't list a ban as true until a 2nd, as-close-to-primary-
 * as-possible source confirms it."
 *
 * DE-GEMINI'D (PR-A): the grounded-Gemini search is gone. Verification runs
 * the keyless officials-extract pattern — SearXNG finds the pages, we fetch
 * them, a local/free-tier LLM extracts what each page shows, and CODE applies
 * the hardened gate (see scripts/lib/ban-verify.mjs):
 *   - confirmed: >=2 distinct-host evidence sources incl. >=1 non-aggregator
 *     -> verification_status='confirmed', active=true (re-published).
 *   - repealed: authoritative / dated / double non-aggregator repeal evidence
 *     -> 'repealed', active=false (the Monroe County, MS pattern).
 *   - held: stays 'single_source', active=false.
 *   - queued: NO VERDICT (infra down / nothing usable found) — row untouched.
 *
 * Ratchets (unattended-night safety):
 *   - a 'confirmed' row is never demoted by a zero-evidence held.
 *   - a 'repealed' row is never auto-re-confirmed — that flip escalates to a
 *     human (repeal reversals are rare and high-stakes).
 *
 * Runs nightly on the owner box (run-nightly-steps.cmd). Cloud runs queue
 * everything harmlessly — never Gemini.
 *
 *   node --env-file=.env.local scripts/verify-local-bans.mjs --limit 25
 *   node --env-file=.env.local scripts/verify-local-bans.mjs --refresh   # re-check confirmed/repealed too
 *   node --env-file=.env.local scripts/verify-local-bans.mjs --dry-run
 *   node --env-file=.env.local scripts/verify-local-bans.mjs --max-minutes 90
 */
import { createClient } from "@supabase/supabase-js";
import { verifyLocalBan } from "./lib/ban-verify.mjs";
import { upsertLocalityIntel } from "./lib/locality-intel.mjs";
import { reconcileLocality } from "./lib/geo-resolver.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); const v = args[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : null; };
const num = (v, dflt) => { const n = parseInt(v ?? "", 10); return Number.isFinite(n) && n > 0 ? n : dflt; };
const LIMIT = num(arg("--limit"), 25);
const MAX_MINUTES = num(arg("--max-minutes"), 90);
const REFRESH = args.includes("--refresh");
const DRY = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// ---------- main ----------
const t0 = Date.now();
let q = sb.from("bills")
  .select("id, bill_number, state, locality, scope, verification_status")
  .in("scope", ["county", "municipal"]);
q = REFRESH
  ? q.not("verification_status", "is", null)
  : q.in("verification_status", ["single_source", "unverified"]);
// Stalest rows first so the backlog rotates instead of re-checking the same head.
const { data: rows, error } = await q.order("verified_at", { ascending: true, nullsFirst: true }).limit(LIMIT);
if (error) { console.error(error.message); process.exit(1); }
console.log(`verify-local-bans: ${rows?.length ?? 0} held local ban(s)${DRY ? " [DRY]" : ""}\n`);

let confirmed = 0, repealed = 0, held = 0, queued = 0, errored = 0, escalated = 0;
let budgetHit = false;
const NOW = () => new Date().toISOString();

for (const b of (rows ?? [])) {
  if (Date.now() - t0 > MAX_MINUTES * 60_000) { budgetHit = true; console.log(`  ⏱ wall-clock budget (${MAX_MINUTES}m) reached — stopping cleanly`); break; }
  const tag = `[${b.state}] ${b.locality}`;
  try {
    const r = await verifyLocalBan({ sb, state: b.state, locality: b.locality, caller: "verify_local_bans" });

    if (r.queued) {
      // No verdict reached — leave the row untouched; the box re-drains it.
      queued++;
      console.log(`  ⏸ QUEUE   ${tag} (${r.reason})`);
      continue;
    }

    // RATCHET: never demote a confirmed ban on a zero-evidence night, and
    // never auto-flip repealed→confirmed (escalate that to a human).
    if (b.verification_status === "confirmed" && r.outcome === "held" && (r.sources?.length ?? 0) === 0) {
      console.log(`  🔒 RATCHET ${tag} — confirmed row, zero evidence tonight; not demoting`);
      continue;
    }
    if (b.verification_status === "repealed" && r.outcome === "confirmed") {
      escalated++;
      console.log(`  ⚠ ESCALATE ${tag} — repealed row re-confirms (${r.reason}); needs human review, not auto-flipping`);
      continue;
    }

    // Gazetteer sanity: don't let a mislabeled state ride along.
    const loc = reconcileLocality({ aiLocality: b.state, scopeState: b.state, text: b.locality ?? "" });
    const stateOk = loc.corroborated || loc.locality === b.state || loc.locality === "ALL";

    let vs, active, status, note;
    if (r.outcome === "repealed") {
      vs = "repealed"; active = false;
      note = `Repealed${r.repeal_date ? ` (${r.repeal_date})` : ""}; ${r.reason}.`;
    } else if (r.outcome === "confirmed" && stateOk) {
      vs = "confirmed"; active = true; status = "enacted";
      note = `Confirmed current ban: ${r.reason}${r.enacted_date ? `, enacted ${r.enacted_date}` : ""}${r.ordinance_citation ? `, ${r.ordinance_citation}` : ""}.`;
    } else {
      vs = "single_source"; active = false;
      note = `Held: ${r.reason}${stateOk ? "" : ", state mismatch"}.`;
    }

    const upd = { verification_status: vs, active, verified_at: NOW(), verification_note: note };
    if ((r.sources?.length ?? 0) > 0) upd.verification_sources = r.sources; // never wipe provenance with an empty pass
    if (status) upd.status = status;
    if (!DRY) await sb.from("bills").update(upd).eq("id", b.id);

    // Locality-intelligence byproduct (0192) — skipped on state mismatch so a
    // mislabeled row can't publish intel under the wrong state.
    let intelTag = "";
    if (stateOk) {
      const intel = await upsertLocalityIntel({ sb, state: b.state, locality: b.locality, scope: b.scope, result: r, dry: DRY });
      intelTag = intel.ok ? "" : ` (intel: ${intel.error?.slice(0, 60)})`;
    }

    if (vs === "confirmed") { confirmed++; console.log(`  ✓ CONFIRM ${tag} (${r.reason})${intelTag}`); }
    else if (vs === "repealed") { repealed++; console.log(`  ⌫ REPEAL  ${tag}${r.repeal_date ? ` (${r.repeal_date})` : ""}${intelTag}`); }
    else { held++; console.log(`  · HOLD    ${tag} (${r.reason})${intelTag}`); }

    await new Promise((res) => setTimeout(res, 1000));
  } catch (e) {
    errored++;
    console.log(`  ✗ ${tag}: ${(e.message ?? "").slice(0, 80)}`);
  }
}

const total = rows?.length ?? 0;
const allQueued = total > 0 && queued === total;
console.log(`\nDone. confirmed=${confirmed} repealed=${repealed} held=${held} queued=${queued} escalated=${escalated} errored=${errored}${budgetHit ? " (budget hit)" : ""}`);
try {
  await sb.from("scraper_runs").insert({
    source: "verify_local_bans",
    started_at: new Date(t0).toISOString(),
    finished_at: NOW(),
    // An all-queued run means ZERO verification happened (infra down) — that
    // must show red in /admin/automation, not green forever.
    status: allQueued || ((confirmed + repealed + held + queued) === 0 && errored > 0) ? "fail" : "success",
    rows_updated: confirmed + repealed + held,
    notes: `confirmed=${confirmed} repealed=${repealed} held=${held} queued=${queued} escalated=${escalated} errored=${errored}${budgetHit ? " budget-hit" : ""}${DRY ? " [dry-run]" : ""}`,
  });
} catch { /* best-effort */ }
process.exit(0);
