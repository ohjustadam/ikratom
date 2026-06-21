#!/usr/bin/env node
/**
 * extract-sunset-dates.mjs — fill bills.sunset_date from explicit sunset /
 * expiration / auto-repeal clauses in a bill's own text.
 *
 * Most kratom bills are permanent bans/scheduling and carry NO sunset, so this
 * is low-yield by design — it only sets a date when the text states one
 * explicitly (e.g. "this act expires on July 1, 2028", "shall be repealed
 * effective December 31, 2027"). It never guesses. Coverage fills in over time
 * as bills with real sunset clauses appear; /calendar + .ics surface them.
 *
 * Scans title + summary_ai + summary_long (the text we already store). Only
 * accepts a date that sits within ~120 chars of a sunset keyword AND parses to
 * a real calendar date. Writes only when bills.sunset_date is currently null
 * (never clobbers an admin-set value).
 *
 * READ-ONLY by default (dry-run). Pass --apply to write (owner-gated prod write).
 *   node --env-file=.env.local scripts/extract-sunset-dates.mjs            # dry-run
 *   node --env-file=.env.local scripts/extract-sunset-dates.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SUNSET = /\b(sunset|expire(?:s|d)?|repeal(?:ed)?|terminat(?:e|es|ion))\b/i;
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

// Find an explicit date within ~120 chars after a sunset keyword. Accepts
// "Month DD, YYYY", "MM/DD/YYYY", "YYYY-MM-DD". Returns ISO yyyy-mm-dd or null.
function findSunsetDate(text) {
  if (!text) return null;
  const m = SUNSET.exec(text);
  if (!m) return null;
  const window = text.slice(m.index, m.index + 140);
  let d;
  // Month DD, YYYY
  if ((d = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(20\d{2})\b/i.exec(window))) {
    const mo = MONTHS[d[1].toLowerCase()];
    return iso(+d[3], mo, +d[2]);
  }
  // MM/DD/YYYY
  if ((d = /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(20\d{2})\b/.exec(window))) return iso(+d[3], +d[1], +d[2]);
  // YYYY-MM-DD
  if ((d = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/.exec(window))) return iso(+d[1], +d[2], +d[3]);
  return null;
}
const iso = (y, mo, da) => {
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
};

async function main() {
  console.log(`\n${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — extracting bills.sunset_date from explicit sunset clauses\n`);
  const found = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("bills")
      .select("id, state, bill_number, title, summary_ai, summary_long, sunset_date")
      .eq("active", true).is("sunset_date", null)
      .range(from, from + 999);
    if (error) { console.error(error.message); process.exit(1); }
    for (const b of data ?? []) {
      const date = findSunsetDate([b.title, b.summary_ai, b.summary_long].filter(Boolean).join("  "));
      if (date) found.push({ id: b.id, label: `${b.state} ${b.bill_number}`, date });
    }
    if (!data || data.length < 1000) break;
  }

  console.log(`${found.length} bill(s) with an explicit sunset date:`);
  for (const f of found) console.log(`  ${f.label} → ${f.date}`);

  let ok = 0, err = 0;
  if (APPLY) {
    for (const f of found) {
      const { error } = await sb.from("bills").update({ sunset_date: f.date }).eq("id", f.id).is("sunset_date", null);
      if (error) { err++; console.log(`  ✗ ${f.label}: ${error.message?.slice(0, 70)}`); } else ok++;
    }
    console.log(`\n✓ ${ok} set, ${err} errors.`);
    try {
      await sb.from("scraper_runs").insert({
        source: "extract_sunset_dates", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
        status: err > 0 ? "error" : "success", rows_updated: ok, notes: `${ok} sunset dates set`,
      });
    } catch { /* best-effort */ }
  } else {
    console.log(`\nDry-run only. Re-run with --apply to write.`);
  }
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
