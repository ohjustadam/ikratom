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
 * (sessionMismatch); this script cleans up rows already corrupted.
 *
 * De-conflating hides a row but leaves the other bill's data on it. To put the
 * row's OWN bill back, from LegiScan:
 *   node --env-file=.env.local scripts/audit-bill-session-drift.mjs \
 *     --restore <billId>[,<billId>...] [--plan-out plan.json] [--apply]
 * It finds the bill in the session its label names (one getMasterList per
 * session, one getBill per row), and holds any row it can't confirm. A
 * confirmed row gets its own status, last action, LegiScan id, history,
 * sponsors and roll calls. The other bill's text versions and the AI summaries
 * written from them are cleared. `active` is left as it is.
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createLegiscanClient } from "./lib/legiscan-budget.mjs";
import { terminalStatusFromAction } from "./lib/bill-status.mjs";
import {
  actionInSession, normBillNumber, sessionsForLabel, sortedHistory, statusFromOwnLegiscanBill,
} from "./lib/bill-session.mjs";

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
const restoreIdx = args.indexOf("--restore");
const RESTORE_IDS = restoreIdx >= 0 ? String(args[restoreIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [];
const planIdx = args.indexOf("--plan-out");
const PLAN_OUT = planIdx >= 0 ? args[planIdx + 1] : null;
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
// Counted, so the month's LegiScan meter (lib/legiscan-budget.mjs) sees this job.
const legiscan = createLegiscanClient(LEGISCAN_KEY);
async function legiscanBill(id) {
  if (!LEGISCAN_KEY) throw new Error("LEGISCAN_API_KEY not set");
  return (await legiscan.call("getBill", { id })).bill;
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

// ── Restore a row's own bill ──────────────────────────────────────────────
// Fields written from the other bill's text or timeline. They go, rather than
// stay wrong: the AI enrichers only rerun on active rows.
const BORROWED_FIELDS = [
  "bill_text_versions", "text_synced_at", "summary_ai", "advocacy_callout", "summary_long",
  "journey_narrative", "journey_analyzed_at", "amendments_count", "substance_targeting",
  "substance_targeting_analyzed_at", "substance_targeting_source", "deep_analyzed_at", "enriched_at",
  "opposition_summary_md", "repeal_plan_md", "sunset_date", "current_committee_name",
  "current_committee_chamber", "current_committee_updated_at",
];
const RESTORE_COLS = `id, state, bill_number, session_id, title, summary, status, last_action, last_action_at, legiscan_bill_id, legiscan_change_hash, active, signed_at, ${BORROWED_FIELDS.join(", ")}`;

const sessionsByState = new Map();
async function stateSessions(state) {
  if (!sessionsByState.has(state)) {
    const { data } = await sb.from("legislative_sessions")
      .select("legiscan_session_id, session_name, year_start, year_end, special, sine_die").eq("state", state);
    sessionsByState.set(state, data ?? []);
  }
  return sessionsByState.get(state);
}
const masterLists = new Map();
async function masterList(sessionId) {
  if (!masterLists.has(sessionId)) {
    const ml = (await legiscan.call("getMasterList", { id: sessionId })).masterlist ?? {};
    const byNumber = new Map();
    for (const [k, v] of Object.entries(ml)) if (k !== "session" && v?.number) byNumber.set(normBillNumber(v.number), v);
    masterLists.set(sessionId, byNumber);
  }
  return masterLists.get(sessionId);
}
const KRATOM_RE = /kratom|mitragyn/i;
const actionKey = (date, text) => `${date}|${String(text ?? "").slice(0, 800)}`;

/** Work out the repair for one row, writing nothing. */
async function planRestore(row) {
  const tag = `${row.state} ${row.bill_number}`;
  const candidates = sessionsForLabel(row.session_id, await stateSessions(row.state)).slice(0, 3);
  let own = null;
  for (const s of candidates) {
    own = (await masterList(s.legiscan_session_id)).get(normBillNumber(row.bill_number)) ?? null;
    if (own) break;
  }
  if (!own) return { row, tag, hold: `LegiScan has no ${row.bill_number} in ${candidates.map((c) => c.session_name).join(", ") || `a session matching "${row.session_id}"`}` };
  const detail = (await legiscan.call("getBill", { id: own.bill_id })).bill;
  const session = detail?.session ?? {};
  const history = sortedHistory(detail);
  const last = history[history.length - 1] ?? null;

  // Proof the stored data is another bill's, and that LegiScan's is this one.
  const foreignId = row.legiscan_bill_id && Number(row.legiscan_bill_id) !== Number(own.bill_id) ? row.legiscan_bill_id : null;
  const lastOutside = Boolean(row.last_action_at) && !actionInSession(row.last_action_at, session);
  const ownText = `${detail?.title ?? ""} ${detail?.description ?? ""}`;
  const overlap = titleOverlap(`${row.title ?? ""} ${row.summary ?? ""}`, ownText);
  const base = { row, tag, own: { bill_id: Number(own.bill_id), session: session.session_name, years: `${session.year_start}-${session.year_end}`, title: detail?.title, description: detail?.description }, overlap, foreignId, lastOutside };
  if (!foreignId && !lastOutside) return { ...base, hold: "its last action already fits its own session" };
  if (!KRATOM_RE.test(ownText) && overlap < 0.3) return { ...base, hold: `LegiScan's ${row.bill_number} doesn't match this row (title overlap ${overlap.toFixed(2)})` };

  const { data: holders } = await sb.from("bills").select("id, bill_number, session_id")
    .eq("legiscan_bill_id", Number(own.bill_id)).neq("id", row.id);
  const twin = holders?.[0] ?? null;
  const status = statusFromOwnLegiscanBill(detail, row.bill_number);
  const enactedOn = status === "enacted"
    ? [...history].reverse().find((h) => terminalStatusFromAction(h.action) === "enacted")?.date ?? null
    : null;
  const today = new Date().toISOString().slice(0, 10);
  const patch = {
    status,
    last_action: last ? String(last.action).slice(0, 500) : null,
    last_action_at: last?.date ?? null,
    legiscan_bill_id: twin ? null : Number(own.bill_id),
    legiscan_change_hash: twin ? null : detail?.change_hash ?? null,
    signed_at: enactedOn,
    last_synced_at: new Date().toISOString(),
    verification_note:
      `Restored ${today} from LegiScan bill ${own.bill_id} (${session.session_name}). The row carried ` +
      `${foreignId ? `LegiScan bill ${foreignId}` : "another bill's actions"}, the same number in a later session. ` +
      `Its text and the AI summaries written from it were cleared.${twin ? ` Twin row ${twin.id.slice(0, 8)} holds the LegiScan id.` : ""}`,
  };
  for (const k of BORROWED_FIELDS) if (row[k] != null) patch[k] = null;
  if (!String(row.summary ?? "").trim() && detail?.description) patch.summary = String(detail.description).slice(0, 4000);
  // A live row whose own bill died with its session retires, by the nightly
  // review cron's rule (review-lapsed-items.mjs): session over, not enacted.
  const ownSession = (await stateSessions(row.state)).find((s) => Number(s.legiscan_session_id) === Number(session.session_id));
  if (row.active && ownSession?.sine_die && status !== "enacted") {
    patch.active = false;
    patch.verification_note += ` Retired: its ${session.session_name} is over and it did not pass.`;
  }

  // Child rows. History the other bill brought goes; the row's own stays.
  const ownKeys = new Set(history.map((h) => actionKey(h.date, h.action)));
  const wide = { year_start: session.year_start, year_end: Number(session.year_end) + 1 };
  const { data: acts } = await sb.from("bill_actions").select("id, action_date, description, source").eq("bill_id", row.id);
  const dropActions = (acts ?? []).filter((a) => !ownKeys.has(actionKey(a.action_date, a.description))
    && (a.source === "legiscan" || !actionInSession(a.action_date, wide)));
  const haveKeys = new Set((acts ?? []).filter((a) => !dropActions.includes(a)).map((a) => actionKey(a.action_date, a.description)));
  const addActions = history.filter((h) => !haveKeys.has(actionKey(h.date, h.action))).map((h) => ({
    bill_id: row.id, action_date: h.date, description: String(h.action).slice(0, 800),
    chamber: h.chamber === "S" ? "Senate" : h.chamber === "H" ? "House" : h.chamber ?? null,
    source: "legiscan", raw_json: h,
  }));

  const { data: oldSponsors } = await sb.from("bill_sponsors").select("id, name, classification").eq("bill_id", row.id);
  const peopleIds = (detail?.sponsors ?? []).map((s) => s.people_id).filter(Boolean);
  const { data: people } = peopleIds.length
    ? await sb.from("legislators").select("id, legiscan_people_id").in("legiscan_people_id", peopleIds)
    : { data: [] };
  const legislatorByPeople = new Map((people ?? []).map((p) => [p.legiscan_people_id, p.id]));
  const seen = new Set();
  const sponsors = [];
  for (const s of detail?.sponsors ?? []) {
    const classification = Number(s.sponsor_type_id) === 1 ? "primary" : "cosponsor";
    if (!s.name || seen.has(`${s.name}|${classification}`)) continue;
    seen.add(`${s.name}|${classification}`);
    sponsors.push({ bill_id: row.id, name: String(s.name).slice(0, 200), classification, party: s.party || null, district: s.district || null, legislator_id: legislatorByPeople.get(s.people_id) ?? null });
  }

  const { data: oldVotes } = await sb.from("bill_votes").select("id, legiscan_roll_call_id, vote_date, motion").eq("bill_id", row.id);
  const ownRollCalls = new Set((detail?.votes ?? []).map((v) => Number(v.roll_call_id)));
  const dropVotes = (oldVotes ?? []).filter((v) => !ownRollCalls.has(Number(v.legiscan_roll_call_id)));
  const votes = (detail?.votes ?? []).map((v) => ({
    bill_id: row.id, legiscan_roll_call_id: v.roll_call_id, vote_date: v.date ?? null,
    chamber: v.chamber === "S" ? "Senate" : v.chamber === "H" ? "House" : v.chamber ?? null,
    motion: String(v.desc ?? "").slice(0, 500), motion_id: v.motion_id ?? null,
    yea_count: Number(v.yea ?? 0), nay_count: Number(v.nay ?? 0), nv_count: Number(v.nv ?? 0),
    absent_count: Number(v.absent ?? 0), total_count: Number(v.total ?? 0),
    passed: v.passed === 1 || v.passed === true, source: "legiscan", raw_json: v, synced_at: new Date().toISOString(),
  }));

  return { ...base, twin, patch, dropActions, keptActions: (acts?.length ?? 0) - dropActions.length, addActions, oldSponsors: oldSponsors ?? [], sponsors, dropVotes, votes };
}

function printPlan(p) {
  const r = p.row;
  console.log(`\n${p.tag} (${r.id.slice(0, 8)}) · label ${r.session_id}`);
  if (p.own) console.log(`  own bill   LegiScan ${p.own.bill_id}, ${p.own.session}: "${String(p.own.title ?? "").slice(0, 70)}" (title overlap ${p.overlap.toFixed(2)})`);
  if (p.hold) { console.log(`  HELD: ${p.hold}`); return; }
  console.log(`  evidence   ${[p.foreignId && `stored LegiScan id ${p.foreignId}`, p.lastOutside && `last action ${r.last_action_at} is outside ${p.own.years}`].filter(Boolean).join("; ")}`);
  console.log(`  status     ${r.status} → ${p.patch.status}`);
  console.log(`  last act.  ${r.last_action_at} ${String(r.last_action ?? "").slice(0, 60)}`);
  console.log(`          →  ${p.patch.last_action_at} ${String(p.patch.last_action ?? "").slice(0, 60)}`);
  console.log(`  LegiScan   ${r.legiscan_bill_id ?? "none"} → ${p.patch.legiscan_bill_id ?? `none (twin ${p.twin?.id.slice(0, 8)} ${p.twin?.bill_number} holds it)`}`);
  console.log(`  actions    drop ${p.dropActions.length} · keep ${p.keptActions} · add ${p.addActions.length}`);
  console.log(`  sponsors   ${p.oldSponsors.map((s) => s.name).join("; ") || "none"} → ${p.sponsors.map((s) => s.name).join("; ") || "none"}`);
  console.log(`  roll calls drop ${p.dropVotes.length} · own ${p.votes.length}`);
  const cleared = BORROWED_FIELDS.filter((k) => k in p.patch);
  if (cleared.length) console.log(`  cleared    ${cleared.join(", ")}`);
  if ("summary" in p.patch) console.log(`  summary    (empty) → LegiScan description`);
  if (p.patch.active === false) console.log(`  active     true → false (its session is over and it did not pass)`);
}

async function applyRestore(p) {
  const fail = (what, e) => { throw new Error(`${p.tag}: ${what} failed: ${e.message}`); };
  let patch = p.patch;
  let { data, error } = await sb.from("bills").update(patch).eq("id", p.row.id).select("id");
  if (error && /legiscan_bill_id/.test(error.message)) {
    // Another row took the id since the plan was made.
    patch = { ...patch, legiscan_bill_id: null, legiscan_change_hash: null };
    ({ data, error } = await sb.from("bills").update(patch).eq("id", p.row.id).select("id"));
  }
  if (error) fail("bills update", error);
  if (data?.length !== 1) throw new Error(`${p.tag}: bills update matched ${data?.length ?? 0} rows`);
  if (p.dropActions.length) {
    const { error: e } = await sb.from("bill_actions").delete().in("id", p.dropActions.map((a) => a.id));
    if (e) fail("bill_actions delete", e);
  }
  if (p.addActions.length) {
    const { error: e } = await sb.from("bill_actions").upsert(p.addActions, { onConflict: "bill_id,action_date,description", ignoreDuplicates: true });
    if (e) fail("bill_actions insert", e);
  }
  if (p.oldSponsors.length) {
    const { error: e } = await sb.from("bill_sponsors").delete().eq("bill_id", p.row.id);
    if (e) fail("bill_sponsors delete", e);
  }
  if (p.sponsors.length) {
    const { error: e } = await sb.from("bill_sponsors").insert(p.sponsors);
    if (e) fail("bill_sponsors insert", e);
  }
  if (p.dropVotes.length) {
    const { error: e } = await sb.from("bill_votes").delete().in("id", p.dropVotes.map((v) => v.id));
    if (e) fail("bill_votes delete", e);
  }
  if (p.votes.length) {
    const { error: e } = await sb.from("bill_votes").upsert(p.votes, { onConflict: "bill_id,legiscan_roll_call_id" });
    if (e) fail("bill_votes insert", e);
  }
}

async function restore(ids, apply) {
  const { data: rows, error } = await sb.from("bills").select(RESTORE_COLS).in("id", ids);
  if (error) throw new Error(error.message);
  console.log(`\n=== Restore ${rows.length} of ${ids.length} rows from their own LegiScan bill (${apply ? "APPLY" : "dry-run"}) ===`);
  const plans = [];
  for (const row of rows) {
    try { plans.push(await planRestore(row)); }
    catch (e) { plans.push({ row, tag: `${row.state} ${row.bill_number}`, hold: `LegiScan: ${e.message.slice(0, 80)}` }); }
    printPlan(plans[plans.length - 1]);
  }
  if (PLAN_OUT) writeFileSync(PLAN_OUT, JSON.stringify(plans, null, 1));
  const ready = plans.filter((p) => !p.hold);
  console.log(`\n${ready.length} ready · ${plans.length - ready.length} held · ${legiscan.calls} LegiScan calls`);
  if (!apply) { console.log("(dry-run: pass --apply to write)"); return { ready: ready.length, written: 0 }; }
  let written = 0;
  for (const p of ready) {
    try { await applyRestore(p); written++; console.log(`  ✓ ${p.tag}`); }
    catch (e) { console.log(`  ✗ ${e.message.slice(0, 160)}`); }
  }
  console.log(`\n✓ ${written} of ${ready.length} rows restored`);
  return { ready: ready.length, written };
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

const startedAt = new Date().toISOString();
if (RESTORE_IDS.length) {
  // Every run spends LegiScan calls, dry-run or not, so every run is recorded
  // for the month's meter (lib/legiscan-budget.mjs).
  let result = null, failure = null;
  try { result = await restore(RESTORE_IDS, APPLY); } catch (e) { failure = e; }
  await sb.from("scraper_runs").insert({
    source: "audit_bill_session_drift",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status: failure ? "error" : "success",
    notes: `restore ${RESTORE_IDS.length} row(s)${APPLY ? ` --apply: ${result?.written ?? 0} written` : ` dry-run: ${result?.ready ?? 0} ready`} · legiscan_calls=${legiscan.calls}${failure ? ` · ${failure.message.slice(0, 120)}` : ""}`,
  }).then(() => undefined, () => undefined);
  if (failure) throw failure;
} else if (DECONFLATE_ID) await deconflate(DECONFLATE_ID, APPLY);
else if (VERIFY) await verifyAndRepair(APPLY);
else await report();
// The nightly job runs --verify: one row a run, so the staleness pager sees it
// and the month's LegiScan meter counts its calls.
if (VERIFY && !DECONFLATE_ID) {
  await sb.from("scraper_runs").insert({
    source: "audit_bill_session_drift",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status: "success",
    notes: `verify${APPLY ? " --apply" : ""} · legiscan_calls=${legiscan.calls}`,
  }).then(() => undefined, () => undefined);
}
