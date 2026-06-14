#!/usr/bin/env node
/**
 * Collapse duplicate news-story policy_alerts (the /pulse "same story shown N
 * times" bug) and migrate canonical keys to the new day-less form.
 *
 * BACKGROUND: migration 0202 dropped the trailing day from the news-story
 * dedupe key so re-publishes of one story collide on ux_policy_alerts_dedupe_
 * approved. That fixes brand-new stories going forward, but:
 *   1. Stories already duplicated in the DB (keyed news:title:locality:DAY,
 *      one per day) still show repeatedly on /pulse.
 *   2. An existing canonical still carries a day in its key, so a FUTURE
 *      re-publish of that same story computes the day-less key and DOESN'T
 *      collide → a fresh dupe.
 *
 * This script fixes both. For every approved alert whose key starts `news:`,
 * it strips the trailing `:YYYY-MM-DD` to get the new key, groups by it, and:
 *   - keeps the EARLIEST alert per group as canonical (matches 0079 + the
 *     go-forward unique-index behavior where the first insert wins),
 *   - demotes the rest to moderation_status='rejected' (vanish from /pulse +
 *     Discord), stamping a note + discord_posted_at so they never re-post,
 *   - rewrites the canonical's dedupe_key to the day-less form so future
 *     re-publishes of the same story collide.
 * Singletons just get their key rewritten. Non-news keys (bill/bop/stale/intel/
 * fallback) keep their day and are left untouched.
 *
 * READ-ONLY by default (dry-run). Pass --apply to write (owner-gated prod write).
 *   node --env-file=.env.local scripts/merge-duplicate-alerts.mjs           # dry-run
 *   node --env-file=.env.local scripts/merge-duplicate-alerts.mjs --apply   # write
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PAGE = 1000;
const DAY_SUFFIX = /:\d{4}-\d{2}-\d{2}$/;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function fetchApprovedNewsAlerts() {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("policy_alerts")
      .select("id, created_at, dedupe_key, moderation_note, discord_posted_at, campaign_id, title, locality")
      .eq("moderation_status", "approved")
      .like("dedupe_key", "news:%")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error("query failed:", error.message); process.exit(1); }
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

async function main() {
  console.log(`\n${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — collapsing duplicate news alerts + migrating keys to day-less form\n`);

  const alerts = await fetchApprovedNewsAlerts();
  console.log(`${alerts.length} approved news-keyed alert(s).\n`);

  // Group by the new (day-less) key.
  const groups = new Map();
  for (const a of alerts) {
    const newKey = a.dedupe_key.replace(DAY_SUFFIX, "");
    if (!groups.has(newKey)) groups.set(newKey, []);
    groups.get(newKey).push(a);
  }

  let collapseGroups = 0, demoted = 0, keyRewrites = 0, errors = 0;
  const examples = [];

  for (const [newKey, rows] of groups) {
    // EARLIEST is canonical (already sorted asc by the query, but re-sort
    // defensively by created_at then id for a stable tiebreak).
    rows.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 :
      (a.id < b.id ? -1 : 1)));
    const canonical = rows[0];
    const dupes = rows.slice(1);

    if (dupes.length > 0) {
      collapseGroups++;
      if (examples.length < 15) examples.push({ newKey, n: rows.length, title: canonical.title });
    }

    // Demote dupes FIRST so the canonical key-rewrite can't collide on the
    // approved partial unique index.
    for (const d of dupes) {
      demoted++;
      if (APPLY) {
        const note = (d.moderation_note ? d.moderation_note + "\n" : "") +
          "auto-collapsed dupe via 0202 merge-duplicate-alerts (day-less news key)";
        const { error } = await sb.from("policy_alerts").update({
          moderation_status: "rejected",
          moderation_note: note,
          discord_posted_at: d.discord_posted_at ?? new Date().toISOString(),
          moderated_at: new Date().toISOString(),
        }).eq("id", d.id);
        if (error) { errors++; console.log(`    ✗ demote ${d.id.slice(0, 8)} failed: ${error.message}`); }
      }
    }

    // Rewrite the canonical key to the day-less form (so future re-publishes
    // collide). Skip if it's already day-less.
    if (canonical.dedupe_key !== newKey) {
      keyRewrites++;
      if (APPLY) {
        const { error } = await sb.from("policy_alerts").update({ dedupe_key: newKey }).eq("id", canonical.id);
        if (error) { errors++; console.log(`    ✗ rekey ${canonical.id.slice(0, 8)} failed: ${error.message}`); }
      }
    }
  }

  console.log("Top collapse groups (count × story):");
  for (const e of examples) console.log(`  ${String(e.n).padStart(3)}×  ${(e.title ?? "").slice(0, 70)}`);

  console.log(`\nSummary: ${alerts.length} approved news alerts → ${groups.size} distinct stories.`);
  console.log(`  ${collapseGroups} stories had duplicates · ${demoted} alerts would be demoted · ${keyRewrites} canonical keys rewritten day-less.`);
  if (APPLY) {
    console.log(`\n✓ Apply complete. ${demoted - errors} demoted ok, ${keyRewrites} rekeyed, ${errors} errors.`);
    try {
      await sb.from("scraper_runs").insert({
        source: "merge_duplicate_alerts",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: errors > 0 ? "error" : demoted > 0 ? "success" : "empty",
        rows_updated: demoted + keyRewrites,
        notes: `${demoted} demoted, ${keyRewrites} rekeyed, ${collapseGroups} stories collapsed, ${errors} errors`,
      });
    } catch { /* best-effort */ }
  } else {
    console.log(`\nDry-run only. Re-run with --apply to write (owner-gated).`);
  }
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
