#!/usr/bin/env node
/**
 * verify-official-emails.mjs — check AI-extracted official emails against
 * the page they were extracted from.
 *
 * Why: a member's letter to the mayor of Rensselaer, NY bounced with "550
 * 5.4.1 Recipient address rejected: Access denied" (2026-11-03). That is
 * Microsoft's answer for a mailbox that does not exist, not a .gov block. The
 * site masks its addresses with Cloudflare ("[email protected]"), the
 * extractor saw only the mask, and the model guessed jddefranco@ for
 * john.defrancesco@. officials-extract.mjs now keeps only addresses shown on
 * the page; this script cleans up the rows saved before that.
 *
 * For each active official whose provenance says "Extracted from ..." and
 * whose email is not in the saved snippet, it fetches the source page (Cloudflare
 * masking decoded) and:
 *   - email on the page          → kept, with a "checked" note
 *   - one address on the page that carries the official's surname → swapped in
 *   - neither                    → email cleared (the old value stays in the note)
 *   - page unreachable           → left alone
 * Every change appends to verified_sources_md, so each one can be undone.
 *
 * Usage: node --env-file=.env.local scripts/verify-official-emails.mjs [--apply] [--limit N]
 */
import { createClient } from "@supabase/supabase-js";
import { fetchPageText } from "./lib/page-text.mjs";
import { emailOnPage } from "./lib/officials-extract.mjs";

const APPLY = process.argv.includes("--apply");
const limIdx = process.argv.indexOf("--limit");
const LIMIT = limIdx > 0 ? Number(process.argv[limIdx + 1]) : 5000;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const today = new Date().toISOString().slice(0, 10);
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** The one address on the page whose local part carries the official's surname, or null. */
function surnameMatch(fullName, pageText, domain) {
  const surname = String(fullName ?? "").trim().split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  if (surname.length < 3) return null;
  const found = new Set((String(pageText).match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()));
  const hits = [...found].filter((e) => e.split("@")[0].replace(/[^a-z]/g, "").includes(surname)
    && (!domain || e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`)));
  return hits.length === 1 ? hits[0] : null;
}

async function load() {
  const rows = [];
  for (let from = 0; rows.length < LIMIT; from += 1000) {
    const { data, error } = await sb.from("legislators")
      .select("id, full_name, email, verified_sources_md")
      .eq("active", true).not("email", "is", null).ilike("verified_sources_md", "%Extracted from%")
      .order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows.slice(0, LIMIT);
}

const rows = await load();
const counts = { checked: rows.length, inSnippet: 0, noSource: 0, unreachable: 0, verified: 0, replaced: 0, removed: 0 };
const bySource = new Map();
for (const r of rows) {
  const md = String(r.verified_sources_md ?? "");
  const snippet = /Verifier snippet: "([\s\S]*?)"\s*(?:\n|$)/.exec(md)?.[1] ?? "";
  if (emailOnPage(r.email, snippet)) { counts.inSnippet++; continue; }
  const src = /- Source: (\S+)/.exec(md)?.[1];
  if (!src) { counts.noSource++; continue; }
  if (!bySource.has(src)) bySource.set(src, []);
  bySource.get(src).push(r);
}

const changes = [];
for (const [url, list] of bySource) {
  const text = await fetchPageText(url, { timeoutMs: 20_000, maxChars: 400_000, render: false }).catch(() => null);
  if (!text) { counts.unreachable += list.length; continue; }
  for (const r of list) {
    const old = String(r.email).toLowerCase();
    let email = r.email, note;
    if (emailOnPage(old, text)) {
      counts.verified++;
      note = `- Email checked on the source page, ${today}`;
    } else {
      const swap = surnameMatch(r.full_name, text, old.split("@")[1]);
      if (swap) { counts.replaced++; email = swap; note = `- Email ${old} replaced ${today} with the address the source page shows`; }
      else { counts.removed++; email = null; note = `- Email ${old} removed ${today}: not on the source page (an AI guess)`; }
    }
    changes.push({ id: r.id, name: r.full_name, old, email, md: `${String(r.verified_sources_md ?? "").trimEnd()}\n${note}` });
  }
}

for (const c of changes.filter((x) => x.email !== x.old).slice(0, 40)) console.log(`  ${c.name}: ${c.old} → ${c.email ?? "(cleared)"}`);
console.log(JSON.stringify(counts));
if (!APPLY) { console.log("dry run: pass --apply to write"); process.exit(0); }

let written = 0;
for (const c of changes) {
  const { error } = await sb.from("legislators").update({ email: c.email, verified_sources_md: c.md }).eq("id", c.id);
  if (!error) written++;
}
await sb.from("scraper_runs").insert({
  source: "verify_official_emails", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
  status: "success", rows_updated: written,
  notes: `checked ${counts.checked} · verified ${counts.verified} · replaced ${counts.replaced} · removed ${counts.removed} · unreachable ${counts.unreachable}`,
}).then(() => undefined, () => undefined);
console.log(`wrote ${written} of ${changes.length}`);
