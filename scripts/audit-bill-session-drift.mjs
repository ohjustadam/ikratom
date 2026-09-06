/**
 * audit-bill-session-drift.mjs — find & fix bills whose session label doesn't
 * match their live data.
 *
 * Two failure modes, both surfaced by the MI SB 433 investigation (2026-07-11):
 *   - FRANKENSTEIN: an old-session row that got a DIFFERENT (current-session)
 *     bill's actions/text stapled on because sync matched by bill_number only
 *     (MI SB 433: a dead 2019-2020 kratom row wearing a 2025-2026 THC school
 *     bill's text). Shows as an "active" threat that isn't real.
 *   - GARBAGE SESSION: a mis-parsed session label (e.g. "1841", "1728", "1958")
 *     — the year came from bill text, not the session.
 *   - DEAD: session closed AND no recent action → a concluded bill still marked
 *     active.
 *
 * READ-ONLY by default (prints a classified report). Targeted repair:
 *   node --env-file=.env.local scripts/audit-bill-session-drift.mjs \
 *     --deconflate <billId> [--apply]
 * De-conflation sets active=false + writes a verification_note + retracts any
 * auto-generated alerts on the row (they describe the wrong bill). Dry-run
 * unless --apply. The systemic sync guard lives in sync-bills-via-legiscan.mjs
 * (isSessionMismatch); this script cleans up rows already corrupted.
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const VERIFY = args.includes("--verify");
const deconflateIdx = args.indexOf("--deconflate");
const DECONFLATE_ID = deconflateIdx >= 0 ? args[deconflateIdx + 1] : null;
const NOW_YEAR = new Date().getFullYear();
const LEGISCAN_KEY = process.env.LEGISCAN_API_KEY;

function years(s) {
  const m = String(s ?? "").match(/(?:19|20)\d{2}/g);
  return m ? m.map(Number) : [];
}
function actionYear(iso) {
  const y = iso ? new Date(iso).getFullYear() : null;
  return Number.isFinite(y) ? y : null;
}

/** classify a row → null (fine) | 'garbage_session' | 'frankenstein' | 'dead' */
function classify(b) {
  const ys = years(b.session_id);
  const anyGarbage = ys.some((y) => y < 1990 || y > NOW_YEAR + 2);
  if (anyGarbage) return "garbage_session";
  if (ys.length === 0) return null;
  const end = Math.max(...ys);
  if (end > NOW_YEAR - 2) return null; // current/recent biennium — fine
  const ay = actionYear(b.last_action_at);
  if (ay && ay >= NOW_YEAR - 1) return "frankenstein"; // old session, fresh action
  return "dead";
}

async function retractAlerts(billId, apply) {
  const { data: alerts } = await sb
    .from("policy_alerts")
    .select("id, title, moderation_status")
    .eq("bill_id", billId)
    .eq("moderation_status", "approved");
  const list = alerts ?? [];
  for (const a of list) {
    console.log(`    ↳ alert ${a.id.slice(0, 8)} "${a.title.slice(0, 60)}" → retract`);
    if (apply) {
      // Record WHY. An unexplained retraction is unauditable later, and this
      // reason is specific and useful: the linked bill turned out to carry
      // another session's data (the bill_number-reuse "Frankenstein record"
      // problem), so the alert misstates the session it claims.
      await sb.from("policy_alerts").update({
        moderation_status: "rejected",
        moderation_note: `Retracted by the bill-session-drift audit: the linked bill was found to carry a different session's data (bill_number reuse), so this alert misstates its session.`,
        moderated_at: new Date().toISOString(),
      }).eq("id", a.id);
    }
  }
  return list.length;
}

async function deconflate(billId, apply) {
  const { data: b, error } = await sb
    .from("bills")
    .select("id, state, bill_number, session_id, active, last_action_at, kratom_relevance, title")
    .eq("id", billId)
    .single();
  if (error || !b) { console.log(`Bill ${billId} not found: ${error?.message}`); return; }

  console.log(`\nDE-CONFLATE ${b.state} ${b.bill_number} (${b.id.slice(0, 8)})`);
  console.log(`  session=${b.session_id} active=${b.active} lastAction=${b.last_action_at} rel=${b.kratom_relevance}`);
  console.log(`  class=${classify(b) ?? "clean"}`);
  const note =
    `De-conflated ${new Date().toISOString().slice(0, 10)}: this record mixed a closed ` +
    `${b.session_id} row with a different current-session bill's data (bill_number reuse). ` +
    `Deactivated — not a live kratom threat. See audit-bill-session-drift.mjs.`;
  console.log(`  → set active=false, verification_note, retract approved alerts`);
  if (apply) {
    await sb.from("bills").update({ active: false, verification_note: note }).eq("id", b.id);
  }
  const n = await retractAlerts(b.id, apply);
  console.log(apply ? `  ✓ applied (${n} alert(s) retracted)` : `  (dry-run — pass --apply to write; ${n} alert(s) would retract)`);
}

// ── LegiScan ground-truth verify + repair ─────────────────────────────────
async function legiscanBill(id) {
  if (!LEGISCAN_KEY) throw new Error("LEGISCAN_API_KEY not set");
  const u = new URL("https://api.legiscan.com/");
  u.searchParams.set("key", LEGISCAN_KEY);
  u.searchParams.set("op", "getBill");
  u.searchParams.set("id", String(id));
  const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`LegiScan ${r.status}`);
  const d = await r.json();
  if (d.status === "ERROR") throw new Error(d.alert?.message ?? "error");
  return d.bill;
}
function titleWords(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3);
}
/** 0..1 fraction of the stored title's words that appear in the LegiScan title. */
function titleOverlap(stored, legiscan) {
  const A = new Set(titleWords(stored));
  const B = titleWords(legiscan);
  if (A.size === 0 || B.length === 0) return 0;
  return B.filter((w) => A.has(w)).length / Math.max(A.size, B.length);
}

/**
 * For every flagged (frankenstein/garbage) row with a legiscan_bill_id, fetch
 * the real LegiScan bill and split into:
 *   - label_stale: LegiScan session ≠ stored, but titles match → same bill, the
 *     session LABEL is just stale → fix session_id (safe). If that collides with
 *     the real current-session row, this one's a dup → deactivate.
 *   - true_frankenstein: session ≠ stored AND titles differ → a different bill's
 *     data is on this row → deactivate + retract alerts (the MI SB 433 pattern).
 *   - ok: session matches → heuristic false-positive, left alone.
 *   - unverifiable: no legiscan_bill_id or LegiScan error → left for review.
 */
async function verifyAndRepair(apply) {
  const { data: bills } = await sb
    .from("bills")
    .select("id, state, bill_number, session_id, active, last_action_at, kratom_relevance, title, legiscan_bill_id")
    .eq("active", true)
    .limit(5000);
  const flagged = (bills ?? []).filter((b) => ["frankenstein", "garbage_session"].includes(classify(b)));
  console.log(`\n=== LegiScan-verify ${flagged.length} flagged bills (${apply ? "REPAIR" : "dry-run"}) ===`);
  const buckets = { label_stale: [], true_frankenstein: [], ok: [], unverifiable: [] };

  for (const b of flagged) {
    if (!b.legiscan_bill_id) { buckets.unverifiable.push({ b, why: "no legiscan_id" }); continue; }
    let d;
    try { d = await legiscanBill(b.legiscan_bill_id); }
    catch (e) { buckets.unverifiable.push({ b, why: (e.message ?? "err").slice(0, 40) }); continue; }
    const ys = d?.session?.year_start, ye = d?.session?.year_end;
    const lsSession = ys && ye ? (ys === ye ? String(ys) : `${ys}-${ye}`) : null;
    const stored = years(b.session_id);
    const mismatch = lsSession && stored.length > 0 && !stored.includes(ys) && !stored.includes(ye);
    const overlap = titleOverlap(b.title, d?.title);
    if (!mismatch) buckets.ok.push({ b, lsSession, overlap });
    else if (overlap >= 0.5) buckets.label_stale.push({ b, lsSession, overlap });
    else buckets.true_frankenstein.push({ b, lsSession, overlap, lsTitle: d?.title });
  }

  for (const [k, arr] of Object.entries(buckets)) {
    console.log(`\n## ${k}: ${arr.length}`);
    for (const x of arr.slice(0, 25)) {
      console.log(`  ${x.b.state} ${x.b.bill_number}  stored=${x.b.session_id} → legiscan=${x.lsSession ?? "?"}  overlap=${(x.overlap ?? 0).toFixed(2)}  ${x.b.id.slice(0, 8)}${x.why ? ` (${x.why})` : ""}`);
      if (k === "true_frankenstein" && x.lsTitle) console.log(`      stored: "${(x.b.title ?? "").slice(0, 70)}"\n      legisc: "${x.lsTitle.slice(0, 70)}"`);
    }
    if (arr.length > 25) console.log(`  … +${arr.length - 25} more`);
  }

  if (!apply) { console.log(`\n(dry-run — pass --apply to fix stale labels + deactivate true-frankensteins)`); return; }

  let fixedLabels = 0, dupDeact = 0;
  for (const x of buckets.label_stale) {
    const { error } = await sb.from("bills").update({ session_id: x.lsSession }).eq("id", x.b.id);
    if (error) {
      // Collides with the real current-session row (mig-0243 unique index) → dup.
      await sb.from("bills").update({
        active: false,
        verification_note: `Duplicate of the ${x.lsSession} row (same bill, stale session label); deactivated ${new Date().toISOString().slice(0, 10)}.`,
      }).eq("id", x.b.id);
      dupDeact++;
    } else fixedLabels++;
  }
  let deact = 0, heldGarbage = 0;
  for (const x of buckets.true_frankenstein) {
    // Only deactivate when the STORED session is parseable AND closed — then
    // the row is a genuinely-dead old-session bill whose recent action was
    // stapled from the unrelated current bill (safe, reversible). A garbage
    // session ("1841") can't be confirmed dead → hold for review. Clear the
    // wrong legiscan_bill_id so it can't re-pollute + frees the unique id.
    if (classify(x.b) !== "frankenstein") { heldGarbage++; continue; }
    const note = `De-conflated ${new Date().toISOString().slice(0, 10)}: legiscan_bill_id ${x.b.legiscan_bill_id} points to a ${x.lsSession} bill with a different title (overlap ${(x.overlap).toFixed(2)}). This is a dead ${x.b.session_id} bill whose recent action was stapled from an unrelated current bill. Deactivated.`;
    await sb.from("bills").update({ active: false, legiscan_bill_id: null, verification_note: note }).eq("id", x.b.id);
    await retractAlerts(x.b.id, true);
    deact++;
  }
  console.log(`\n✓ ${fixedLabels} session labels corrected · ${dupDeact} duplicates deactivated · ${deact} dead-session bills deactivated (+ alerts retracted) · ${heldGarbage} garbage-session held for review`);
}

async function report() {
  const { data: bills } = await sb
    .from("bills")
    .select("id, state, bill_number, session_id, active, last_action_at, kratom_relevance")
    .eq("active", true)
    .limit(5000);
  const buckets = { garbage_session: [], frankenstein: [], dead: [] };
  for (const b of bills ?? []) {
    const c = classify(b);
    if (c) buckets[c].push(b);
  }
  console.log(`\n=== bill session-drift audit (${(bills ?? []).length} active bills) ===`);
  for (const [k, arr] of Object.entries(buckets)) {
    console.log(`\n## ${k}: ${arr.length}`);
    for (const b of arr.slice(0, 40)) {
      console.log(`  ${b.state} ${b.bill_number}  session=${b.session_id}  lastAction=${b.last_action_at}  rel=${b.kratom_relevance}  ${b.id.slice(0, 8)}`);
    }
    if (arr.length > 40) console.log(`  … +${arr.length - 40} more`);
  }
  const total = Object.values(buckets).reduce((n, a) => n + a.length, 0);
  console.log(`\nTOTAL flagged: ${total} / ${(bills ?? []).length} active`);
  console.log(`\nRepair a specific record: --deconflate <billId> [--apply]`);
}

if (DECONFLATE_ID) await deconflate(DECONFLATE_ID, APPLY);
else if (VERIFY) await verifyAndRepair(APPLY);
else await report();
