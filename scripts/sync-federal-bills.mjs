#!/usr/bin/env node
/**
 * sync-federal-bills.mjs — finds kratom bills in the current Congress.
 *
 * Every other bill feed is state-scoped: the OpenStates keyword sync and the
 * LegiScan datasets skip Congress, and sync-bills-via-legiscan only refreshes
 * bills we already hold. On 2026-11-03 we tracked none of the four
 * 119th-Congress kratom bills (H.R. 8000, the END 7-OH Act, among them), and
 * our four "active" federal bills had died with the 117th and 118th.
 *
 * One LegiScan getSearch per keyword (3 calls a run), state=US, current
 * Congress. A new bill is inserted as scope='federal' with relevance
 * 'neutral', which classify-bill-substance.mjs refines; a known one gets its
 * latest action and status. Bills of an earlier Congress that never became
 * law are retired with a note (reversible).
 *
 *   node --env-file=.env.local scripts/sync-federal-bills.mjs [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import { runWithLogging } from "./lib/scraper-run.mjs";
import { deriveStatusFromAction } from "./lib/bill-status.mjs";
import { congressFor, federalBillNumber } from "./lib/federal-bills.mjs";
import { budgetAllows, createLegiscanClient, legiscanCallsThisMonth } from "./lib/legiscan-budget.mjs";

const DRY = process.argv.includes("--dry-run");
const KEY = process.env.LEGISCAN_API_KEY;
if (!KEY) { console.log("sync-federal-bills: LEGISCAN_API_KEY empty — nothing to do."); process.exit(0); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const QUERIES = ["kratom", "mitragynine", "hydroxymitragynine"];
await runWithLogging({ source: "sync_federal_bills", supabase: sb }, async () => {
  const used = await legiscanCallsThisMonth(sb);
  if (!budgetAllows(used, "essential")) return { rowsAdded: 0, rowsUpdated: 0, notes: `LegiScan budget spent (${used}); skipped. legiscan_calls=0` };
  const ls = createLegiscanClient(KEY, { maxCalls: QUERIES.length });
  const congress = String(congressFor(new Date().getUTCFullYear()));

  const hits = new Map();
  for (const query of QUERIES) {
    const data = await ls.call("getSearch", { state: "US", year: 2, query });
    for (const [k, r] of Object.entries(data.searchresult ?? {})) if (k !== "summary" && r.bill_id) hits.set(r.bill_id, r);
  }

  let added = 0, updated = 0;
  for (const r of hits.values()) {
    const billNumber = federalBillNumber(r.bill_number);
    if (!billNumber) { console.log(`  ? unknown prefix ${r.bill_number}`); continue; }
    const fresh = {
      last_action: (r.last_action ?? "").slice(0, 800) || null,
      last_action_at: r.last_action_date || null,
      status: deriveStatusFromAction(r.last_action),
      legiscan_bill_id: r.bill_id,
      session_id: congress,
      active: true,
      last_synced_at: new Date().toISOString(),
    };
    const { data: rows } = await sb.from("bills").select("id, status")
      .or(`legiscan_bill_id.eq.${r.bill_id},and(state.eq.US,bill_number.eq.${billNumber},session_id.eq.${congress})`).limit(1);
    const existing = rows?.[0];
    if (existing) {
      // Never walk an enacted or vetoed bill back to an earlier stage.
      if (["enacted", "vetoed"].includes(existing.status)) delete fresh.status;
      if (!DRY) await sb.from("bills").update(fresh).eq("id", existing.id);
      updated++;
    } else {
      const url = (r.url ?? "").replace(/^http:/, "https:") || null;
      const row = { state: "US", bill_number: billNumber, title: (r.title ?? "").slice(0, 500), scope: "federal",
        kratom_relevance: "neutral", relevance_confidence: 0, source_url: url, official_url: url, ...fresh };
      console.log(`  + ${billNumber} ${row.title.slice(0, 80)}`);
      if (!DRY) {
        const { error } = await sb.from("bills").insert(row);
        if (error) { console.log(`  ✗ ${billNumber}: ${error.message.slice(0, 100)}`); continue; }
      }
      added++;
    }
  }

  // A Congress that ended took its unpassed bills with it.
  const { data: stale } = await sb.from("bills").select("id, bill_number, session_id, status")
    .eq("state", "US").eq("active", true).neq("session_id", congress).neq("status", "enacted");
  const today = new Date().toISOString().slice(0, 10);
  for (const b of stale ?? []) {
    console.log(`  - retire ${b.bill_number} (Congress ${b.session_id})`);
    if (!DRY) await sb.from("bills").update({ active: false,
      verification_note: `Auto-retired by sync-federal-bills ${today}: Congress ${b.session_id} ended without passage. Reversible.` }).eq("id", b.id);
  }

  console.log(`${DRY ? "DRY-RUN" : "APPLIED"}: ${hits.size} found, ${added} new, ${updated} refreshed, ${stale?.length ?? 0} retired`);
  return { rowsAdded: DRY ? 0 : added, rowsUpdated: DRY ? 0 : updated + (stale?.length ?? 0),
    notes: `found ${hits.size}, new ${added}, refreshed ${updated}, retired ${stale?.length ?? 0} legiscan_calls=${ls.calls}${DRY ? " [dry-run]" : ""}` };
});
