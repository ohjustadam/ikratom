#!/usr/bin/env node
/**
 * sync-legiscan-datasets.mjs — bulk bill backfill from LegiScan DATASETS.
 *
 * The heal for incomplete/stale bill data. Instead of per-bill API calls
 * (quota-burning, and our old sync only REFRESHED known bills — never
 * discovered missing ones), this pulls an ENTIRE state-session as one ZIP
 * (getDatasetList → getDataset), unzips it (yauzl), and ingests every
 * KRATOM-relevant bill with its FULL action timeline — fixing both the
 * "missing bills" holes (OK KCPA etc.) and the "just introduced / no
 * tracker" gap (we had zero bill_actions rows because the LegiScan key was
 * empty and that was our only timeline source).
 *
 * Discovery + freshness + session hygiene in one pass:
 *   - DISCOVERS bills (inserts ones we never had), keyed by legiscan_bill_id
 *     (globally unique per session → multi-session safe, no migration).
 *   - Captures status (STATUS_MAP), last_action/last_action_at, session_id,
 *     source_url, committee, and the full history → bill_actions.
 *   - SESSION HYGIENE: active=true only for the state's CURRENT session or
 *     enacted laws; older non-enacted bills (e.g. CA AB 2365, 2023-24) →
 *     active=false. Fixes "dead bill shown active".
 *   - kratom_relevance defaults to 'neutral' on NEW bills (classify-bill-
 *     substance.mjs refines to anti/pro after); NEVER overwrites an existing
 *     bill's curated relevance/title/summary — only freshness fields.
 *
 * Run on the BOX (bulk download + unzip). LegiScan free tier 30k/mo.
 *   node --env-file=.env.local scripts/sync-legiscan-datasets.mjs --state CA --dry-run
 *   node --env-file=.env.local scripts/sync-legiscan-datasets.mjs --state OK --since 2019
 *   node --env-file=.env.local scripts/sync-legiscan-datasets.mjs --all --since 2023
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { terminalStatusFromAction } from "./lib/bill-status.mjs";
const require = createRequire(import.meta.url);
const yauzl = require("yauzl");

const KEY = process.env.LEGISCAN_API_KEY;
if (!KEY) { console.log("sync-legiscan-datasets: LEGISCAN_API_KEY empty — nothing to do."); process.exit(0); }

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); const v = args[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : null; };
const num = (v, d) => { const n = parseInt(v ?? "", 10); return Number.isFinite(n) ? n : d; };
const STATE = arg("--state");
const ALL = args.includes("--all");
const SINCE = num(arg("--since"), 2023);       // earliest session year_end to ingest
const DRY = args.includes("--dry-run");
if (!STATE && !ALL) { console.error("Usage: --state XX | --all  [--since YYYY] [--dry-run]"); process.exit(1); }

const STATUS_MAP = { 1: "introduced", 2: "in_committee", 3: "in_committee", 4: "passed_chamber", 5: "passed_chamber", 6: "enacted", 7: "vetoed", 8: "dead", 9: "dead", 10: "dead" };
const KW = /\b(kratom|mitragyn|mitragyna speciosa|7-?hydroxy|7-?oh\b|hydroxymitragynine)\b/i;
const ALL_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const t0 = Date.now();
const api = async (params) => {
  const r = await fetch(`https://api.legiscan.com/?key=${KEY}&${params}`, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`LegiScan ${r.status}`);
  return r.json();
};

// Unzip a base64 dataset → array of parsed bill objects.
function unzipBills(b64) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(b64, "base64");
    const bills = [];
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on("entry", (entry) => {
        if (!/\/bill\/[^/]+\.json$/i.test(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (e, rs) => {
          if (e) return zip.readEntry();
          const chunks = [];
          rs.on("data", (c) => chunks.push(c));
          rs.on("end", () => { try { const j = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (j?.bill) bills.push(j.bill); } catch {} zip.readEntry(); });
          rs.on("error", () => zip.readEntry());
        });
      });
      zip.on("end", () => resolve(bills));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

// LegiScan numbers are unspaced ("AB1088","HB1784"); the rest of the app +
// existing rows + campaign topic_keys use the SPACED form ("AB 1088"). Match
// that so we UPDATE existing rows instead of creating "AB1088" duplicates.
const normalizeBillNumber = (s) => {
  const t = String(s ?? "").replace(/\s+/g, "").toUpperCase();
  const m = t.match(/^([A-Z]+)(\d.*)$/);
  return m ? `${m[1]} ${m[2]}` : t;
};
const isKratom = (b) => KW.test(`${b.title ?? ""} ${b.description ?? ""} ${(b.subjects ?? []).map((s) => s.subject_name).join(" ")}`);
const latestHistory = (b) => (b.history ?? []).filter((h) => h.date).sort((a, c) => a.date.localeCompare(c.date)).slice(-1)[0] ?? null;

let totalBills = 0, inserted = 0, updated = 0, actionsUpserted = 0, deactivated = 0, errored = 0, skipped = 0;

async function ingestState(state) {
  const list = (await api(`op=getDatasetList&state=${state}`)).datasetlist ?? [];
  const sessions = list.filter((d) => (d.year_end ?? 0) >= SINCE).sort((a, b) => (b.year_end ?? 0) - (a.year_end ?? 0));
  if (!sessions.length) { console.log(`  ${state}: no sessions since ${SINCE}`); return; }
  const currentSessionId = sessions[0].session_id; // newest year_end = current
  console.log(`\n[${state}] ${sessions.length} session(s) since ${SINCE} (current=${currentSessionId})`);

  for (const ses of sessions) {
    let bills;
    try {
      const ds = await api(`op=getDataset&id=${ses.session_id}&access_key=${ses.access_key}`);
      bills = await unzipBills(ds.dataset.zip);
    } catch (e) { console.log(`  ⚠ session ${ses.session_id}: ${e.message}`); errored++; continue; }
    const kratom = bills.filter(isKratom);
    console.log(`  session ${ses.session_id} (${ses.session_name?.slice(0,30)}): ${bills.length} bills, ${kratom.length} kratom`);
    totalBills += bills.length;

    for (const b of kratom) {
      try {
        const last = latestHistory(b);
        // LegiScan's numeric code under-reports enactment (returns 4=Passed for
        // bills whose action says "became law"/"approved by governor"/"enacted").
        // Promote to the action-derived terminal state when the code is still
        // non-terminal, so this heal can't revert backfill-bill-status.mjs.
        const codeStatus = STATUS_MAP[b.status] ?? "introduced";
        const actionTerminal = terminalStatusFromAction(last?.action);
        const status = actionTerminal && !["enacted", "vetoed", "dead"].includes(codeStatus)
          ? actionTerminal
          : codeStatus;
        const isCurrent = ses.session_id === currentSessionId;
        const active = isCurrent || status === "enacted";
        const billNumber = normalizeBillNumber(b.bill_number);
        const sourceUrl = b.state_link || b.url || null;
        const committee = b.committee?.name ?? b.pending_committee_id ? (b.committee?.name ?? null) : null;

        // Match by legiscan_bill_id (canonical) → else claim an existing
        // OpenStates-created row (same state+number, no legiscan id yet) so we
        // UPDATE it rather than DUPLICATE. limit(1) avoids maybeSingle throwing.
        let existing = (await sb.from("bills").select("id, active").eq("legiscan_bill_id", b.bill_id).limit(1)).data?.[0] ?? null;
        if (!existing) {
          existing = (await sb.from("bills").select("id, active").eq("state", state).eq("bill_number", billNumber).is("legiscan_bill_id", null).limit(1)).data?.[0] ?? null;
        }
        // Cross-session collision: a (state, bill_number) row from a NEWER
        // session already exists (we process newest-first), and the schema's
        // bills_state_number_uniq forbids a second. Keep the newer one, skip
        // this older same-number bill (rare; logged so it's not silent).
        if (!existing) {
          const collide = (await sb.from("bills").select("id, session_id").eq("state", state).eq("bill_number", billNumber).limit(1)).data?.[0] ?? null;
          if (collide) { skipped++; console.log(`    ↷ skip ${billNumber} (number reused; kept newer session ${collide.session_id})`); continue; }
        }
        const freshness = {
          status, last_action: last?.action?.slice(0, 800) ?? null, last_action_at: last?.date ?? null,
          session_id: String(ses.session_id), source_url: sourceUrl, official_url: sourceUrl,
          legiscan_bill_id: b.bill_id, active, current_committee_name: committee, last_synced_at: new Date().toISOString(),
        };

        let billId = existing?.id;
        if (existing) {
          if (existing.active && !active) deactivated++;
          if (!DRY) await sb.from("bills").update(freshness).eq("id", existing.id);
          updated++;
        } else {
          const row = { state, bill_number: billNumber, title: (b.title ?? "").slice(0, 500), summary: (b.description ?? "").slice(0, 4000), scope: "state", kratom_relevance: "neutral", relevance_confidence: 0, ...freshness };
          if (!DRY) {
            const { data: ins, error } = await sb.from("bills").insert(row).select("id").single();
            if (error) { console.log(`    ✗ insert ${billNumber}: ${error.message.slice(0,80)}`); errored++; continue; }
            billId = ins.id;
          }
          inserted++;
        }

        // Full timeline → bill_actions (the "no tracker" fix).
        if (billId && !DRY) {
          const actionRows = (b.history ?? []).filter((h) => h.date && h.action).map((h) => ({
            bill_id: billId, action_date: h.date, description: String(h.action).slice(0, 800),
            chamber: h.chamber === "S" ? "Senate" : h.chamber === "H" ? "House" : h.chamber ?? null,
            source: "legiscan_dataset", raw_json: h,
          }));
          if (actionRows.length) {
            const { data: ins2 } = await sb.from("bill_actions").upsert(actionRows, { onConflict: "bill_id,action_date,description", ignoreDuplicates: true }).select("id");
            actionsUpserted += ins2?.length ?? 0;
          }
        }
      } catch (e) { console.log(`    ✗ ${b.bill_number}: ${(e.message||"").slice(0,80)}`); errored++; }
    }
    await new Promise((r) => setTimeout(r, 1200)); // gentle between sessions
  }
}

const states = ALL ? ALL_STATES : [STATE.toUpperCase()];
for (const s of states) {
  try { await ingestState(s); } catch (e) { console.log(`[${s}] FAILED: ${e.message}`); errored++; }
}

console.log(`\nDone${DRY ? " [DRY]" : ""}. states=${states.length} scanned=${totalBills} | kratom: inserted=${inserted} updated=${updated} actions+=${actionsUpserted} deactivated=${deactivated} skipped=${skipped} errored=${errored}`);
if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "legiscan_datasets", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      status: errored > 0 && inserted + updated === 0 ? "fail" : "success",
      rows_added: inserted, rows_updated: updated,
      notes: `states=${states.length} inserted=${inserted} updated=${updated} actions=${actionsUpserted} deactivated=${deactivated} errored=${errored} since=${SINCE}`,
    });
  } catch { /* best-effort */ }
}
process.exit(0);
