/**
 * audit-local-term-ends.mjs — clear local term-end dates that no source states.
 * The officials-turnover engine, part (e).
 *
 * A wrong term end does real harm in both directions: one that has "passed"
 * makes refresh-local-rosters.mjs re-queue sitting officials as departed, and
 * one far in the future hides a turnover. Two shapes were found on 2026-10-23
 * among the 27 local officials whose term ended on a January 1:
 *   - Legistar's "no end date" placeholder, 2099-01-01, stored as a date
 *     (Oklahoma County's three commissioners);
 *   - a year-only "Term expires 2027" stored as 2027-01-01 (Jefferson City MO,
 *     whose council terms really end in April; the NH and MA county officers).
 * Both writers are fixed (legistarEndDate, termEndOrNull). This repairs what
 * they already wrote: a placeholder year is cleared; a January 1 from a
 * non-Legistar source is kept only when the official's source page prints
 * that day, and cleared when the row has no source at all. A page that fails
 * to load is left alone and reported — unverified is not the same as wrong.
 * Each cleared row gets a dated line in verified_sources_md.
 *
 *   node --env-file=.env.local scripts/audit-local-term-ends.mjs            # report
 *   node --env-file=.env.local scripts/audit-local-term-ends.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { termEndOrNull } from "./lib/officials-extract.mjs";
import { legistarEndDate } from "./lib/legistar-officials.mjs";

const APPLY = process.argv.includes("--apply");
const today = new Date().toISOString().slice(0, 10);
const UA = "iKratomBot/1.0 (https://www.ikratom.org; contact@ikratom.org)";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data, error } = await sb.from("legislators")
  .select("id, state, locality, full_name, term_end_date, verified_sources_md")
  .eq("active", true).in("level", ["county", "municipal"]).not("term_end_date", "is", null).limit(5000);
if (error) throw error;

const pageText = new Map();
async function textOf(url) {
  if (pageText.has(url)) return pageText.get(url);
  let text = null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (r.ok) text = (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  } catch { /* unreachable: leave the row alone */ }
  pageText.set(url, text);
  return text;
}

const clears = [], kept = [], unreachable = [];
for (const r of data) {
  const src = /Source:\s*(https?:\/\/\S+)/i.exec(r.verified_sources_md ?? "")?.[1];
  const legistar = /legistar\.com/i.test(src ?? "");
  if (legistar || /^\d{4}/.test(r.term_end_date) && Number(r.term_end_date.slice(0, 4)) >= 2090) {
    if (legistarEndDate(r.term_end_date) === null) clears.push({ r, why: "a placeholder year, not a term end" });
    continue; // otherwise a date Legistar's office record publishes
  }
  if (!r.term_end_date.endsWith("-01-01")) continue;
  if (!src) { clears.push({ r, why: "no source states it" }); continue; }
  const text = await textOf(src);
  if (text == null) { unreachable.push(r); continue; }
  if (termEndOrNull(r.term_end_date, text)) kept.push(r);
  else clears.push({ r, why: `the source (${src}) gives no such day` });
}

for (const { r, why } of clears) console.log(`  ✗ ${r.state} ${r.locality} · ${r.full_name}: ${r.term_end_date} — ${why}`);
for (const r of kept) console.log(`  ✓ ${r.state} ${r.locality} · ${r.full_name}: ${r.term_end_date} printed on the source`);
for (const r of unreachable) console.log(`  ? ${r.state} ${r.locality} · ${r.full_name}: source unreachable, left as is`);

let applied = 0;
if (APPLY) {
  for (const { r, why } of clears) {
    const line = `- term_end_date ${r.term_end_date} cleared ${today}: ${why} (audit-local-term-ends).`;
    const { error: e } = await sb.from("legislators").update({
      term_end_date: null, verified_sources_md: [r.verified_sources_md, line].filter(Boolean).join("\n"),
    }).eq("id", r.id).eq("term_end_date", r.term_end_date);
    if (!e) applied++;
  }
}
console.log(`${APPLY ? "" : "REPORT "}checked ${data.length} local term ends · clear ${clears.length} (applied ${applied}) · kept ${kept.length} · unreachable ${unreachable.length}`);
