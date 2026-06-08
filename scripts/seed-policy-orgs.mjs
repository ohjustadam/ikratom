#!/usr/bin/env node
/**
 * seed-policy-orgs.mjs — load the confirmed org-census roster into policy_orgs
 * (migration 0181). Dedupes by normalized name (the raw census has FDA/VIVAZEN/
 * etc. appearing multiple times), keeping the highest-confidence / most-evidenced
 * record. Re-runnable: upserts on slug, so re-seeding after the gap-fill pass
 * just adds/updates rows.
 *
 * Source: private/org-census-confirmed.json (written by the census workflow).
 *
 *   node --env-file=.env.local scripts/seed-policy-orgs.mjs           # dry-run
 *   node --env-file=.env.local scripts/seed-policy-orgs.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const PRUNE = process.argv.includes("--prune"); // delete DB rows not in the deduped seed set
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const rows = JSON.parse(readFileSync("private/org-census-confirmed.json", "utf8"));
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slugify = (s) =>
  String(s || "org").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "org";
const CONF = { high: 3, medium: 2, low: 1 };

// Dedupe by canonical WEBSITE first (strongest identity — catches "7-HOPE
// Alliance" vs "7-HOPE Alliance (Dr. Ross…)"), falling back to normalized name.
// Keep the strongest record: highest confidence, then the shortest (cleanest) name.
const canonKey = (o) => {
  const w = String(o.website || "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase();
  return w || norm(o.name);
};
const byKey = new Map();
for (const o of rows) {
  const k = canonKey(o);
  if (!k) continue;
  const prev = byKey.get(k);
  const better =
    !prev ||
    (CONF[o.confidence] || 0) > (CONF[prev.confidence] || 0) ||
    ((CONF[o.confidence] || 0) === (CONF[prev.confidence] || 0) && String(o.name || "").length < String(prev.name || "").length);
  if (better) byKey.set(k, o);
}
const uniq = [...byKey.values()];

const seen = new Set();
const seedRows = uniq.map((o) => {
  let slug = slugify(o.name);
  let s = slug, i = 2;
  while (seen.has(s)) s = `${slug}-${i++}`;
  seen.add(s);
  return {
    slug: s,
    name: o.name,
    stance: o.stance || "unclear",
    org_type: o.type || null,
    website: o.website || null,
    summary: o.notes || null,
    evidence: o.evidence || [],
    confidence: o.confidence || null,
    confirmed: !!o.confirmed,
    active: o.active !== false,
    // research-sourced — flag for owner confirmation before it's treated as canon
    needs_review: (o.confidence || "low") !== "high",
  };
});

const byStance = {};
for (const r of seedRows) byStance[r.stance] = (byStance[r.stance] || 0) + 1;
console.log(`${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"}: ${seedRows.length} unique orgs (from ${rows.length} confirmed census rows)`);
console.log("by stance:", JSON.stringify(byStance));

if (!APPLY) {
  for (const r of seedRows.slice(0, 10)) console.log(`  ${r.slug.padEnd(36)} ${r.stance.padEnd(12)} ${r.confidence ?? "-"}`);
  console.log("\n(dry-run — re-run with --apply to write)");
  process.exit(0);
}

let ok = 0, fail = 0;
for (const r of seedRows) {
  const { error } = await sb.from("policy_orgs").upsert({ ...r, updated_at: new Date().toISOString() }, { onConflict: "slug" });
  if (error) { console.error(`  ✗ ${r.slug}: ${error.message}`); fail++; } else ok++;
}
console.log(`\n✅ Seeded ${ok} policy orgs (${fail} failed).`);

if (PRUNE) {
  const keep = new Set(seedRows.map((r) => r.slug));
  const { data: existing } = await sb.from("policy_orgs").select("slug");
  const orphans = (existing ?? []).map((r) => r.slug).filter((s) => !keep.has(s));
  if (orphans.length) {
    const { error } = await sb.from("policy_orgs").delete().in("slug", orphans);
    console.log(error ? `prune failed: ${error.message}` : `🧹 pruned ${orphans.length} orphan/dupe rows`);
  } else console.log("no orphans to prune.");
}
process.exit(fail ? 1 : 0);
