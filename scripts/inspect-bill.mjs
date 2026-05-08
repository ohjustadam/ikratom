#!/usr/bin/env node
/**
 * Quick read-only diagnostic for a single bill row + its history /
 * amendments / sync cadence. Use to triage "this bill's summary feels
 * stale or incomplete":
 *
 *   node --env-file=.env.local scripts/inspect-bill.mjs <bill-id>
 *
 * Prints a structured dump of the bill, its sponsors, history entries,
 * sessions (if scoped multi-session), and last enrichment timestamp.
 */
import { createClient } from "@supabase/supabase-js";

const id = process.argv[2];
if (!id) {
  console.error("Usage: scripts/inspect-bill.mjs <bill-id>");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: bill, error: berr } = await supabase
  .from("bills")
  .select("*")
  .eq("id", id)
  .single();
if (berr || !bill) {
  console.error("Bill not found:", berr?.message);
  process.exit(1);
}

console.log("=== bills row ===");
const headerKeys = ["id", "state", "bill_number", "title", "status", "last_action", "last_action_at", "session", "session_id", "active", "scope", "created_at", "updated_at"];
for (const k of headerKeys) {
  if (k in bill) console.log(`  ${k}: ${formatVal(bill[k])}`);
}

console.log("\n=== summary fields ===");
for (const k of Object.keys(bill).filter((k) => /summary|description|deep|analysis|impact|amend/i.test(k))) {
  const v = bill[k];
  if (v == null) continue;
  if (typeof v === "string" && v.length > 200) {
    console.log(`  ${k} (${v.length} chars):`);
    console.log("    " + v.replaceAll("\n", "\n    ").slice(0, 600) + (v.length > 600 ? "\n    …(truncated)" : ""));
  } else if (typeof v === "object") {
    console.log(`  ${k}: ${JSON.stringify(v).slice(0, 400)}`);
  } else {
    console.log(`  ${k}: ${v}`);
  }
}

// Try sponsors
const { data: sponsors } = await supabase
  .from("bill_sponsors")
  .select("legislator_id, sponsor_type, primary, position")
  .eq("bill_id", id);
if (sponsors && sponsors.length > 0) {
  console.log(`\n=== sponsors (${sponsors.length}) ===`);
  for (const s of sponsors) console.log(`  ${s.sponsor_type ?? "?"}${s.primary ? "*" : ""}: ${s.legislator_id} (${s.position ?? "n/a"})`);
}

// History (if there's a bill_history table)
const { data: history, error: histErr } = await supabase
  .from("bill_history")
  .select("*")
  .eq("bill_id", id)
  .order("action_date", { ascending: true });
if (!histErr && history && history.length > 0) {
  console.log(`\n=== history (${history.length}) ===`);
  for (const h of history) {
    console.log(`  ${h.action_date ?? "?"}  ${h.chamber ?? ""}  ${h.action ?? h.description ?? ""}`);
  }
} else if (histErr) {
  console.log(`\n(history table query failed: ${histErr.message})`);
}

// Versions / amendments table if it exists
for (const t of ["bill_versions", "bill_amendments", "bill_texts"]) {
  const { data, error } = await supabase.from(t).select("*").eq("bill_id", id).order("created_at", { ascending: true });
  if (!error && data && data.length > 0) {
    console.log(`\n=== ${t} (${data.length}) ===`);
    for (const r of data) {
      const cols = Object.entries(r)
        .filter(([k]) => !/^id$|^created_at$|^updated_at$|^bill_id$/.test(k))
        .map(([k, v]) => `${k}=${typeof v === "string" && v.length > 60 ? v.slice(0, 60) + "…" : v}`)
        .join(", ");
      console.log(`  ${r.created_at ?? "?"}  ${cols}`);
    }
  }
}

function formatVal(v) {
  if (v == null) return "(null)";
  if (typeof v === "string" && v.length > 80) return v.slice(0, 80) + "…";
  return v;
}
