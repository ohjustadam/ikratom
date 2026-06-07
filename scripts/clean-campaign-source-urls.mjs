#!/usr/bin/env node
/**
 * Backfill: strip Google-News redirect URLs out of EXISTING campaign templates.
 *
 * PR #506 cleaned up the alert page, the DraftResponsePanel, and FUTURE
 * auto-campaign generation — but campaigns generated before it still have a raw
 * `Source: https://news.google.com/...` line baked into their stored
 * subject/body template, which is what users paste into letters to officials.
 *
 * Strategy (owner choice 2026-06-06: "Publisher URL"): replace the Google
 * redirect with the clean publisher URL recovered from the linked news article
 * (news_items.resolved_url), falling back to our own clean alert page when no
 * usable publisher URL exists. We reject `/embed/` video-player URLs — those are
 * not a readable source for an official — and fall back to the alert page there.
 *   1. Clean publisher URL (e.g. https://www.tulsaworld.com/...).
 *   2. Else our alert page: /alerts/<id>.
 *   3. Else the bare platform URL.
 *
 * READ-ONLY by default (dry-run). Pass --apply to write.
 *   node --env-file=.env.local scripts/clean-campaign-source-urls.mjs           # dry-run
 *   node --env-file=.env.local scripts/clean-campaign-source-urls.mjs --apply   # write
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";
const PAGE = 1000;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const GOOGLE_RE = /https?:\/\/(?:news\.google\.com|(?:www\.)?google\.com\/url)\S*/i;
const HAS_GOOGLE = (s) => !!s && GOOGLE_RE.test(s);
const isGoogle = (u) => !!u && /^https?:\/\/(?:news\.google\.com|(?:www\.)?google\.com\/url)/i.test(u);
/** A publisher URL we'd actually want an official to read (not a Google redirect, not a bare embed). */
const isUsablePublisher = (u) => !!u && !isGoogle(u) && !/\/embed\//i.test(u);

function cleanText(text, pubUrl, alertUrl) {
  if (!text) return text;
  const sourceReplacement = pubUrl ? `Source: ${pubUrl}` : `More detail: ${alertUrl}`;
  const bareReplacement = pubUrl || alertUrl;
  return text
    .replace(/Source:\s*https?:\/\/(?:news\.google\.com|(?:www\.)?google\.com\/url)\S*/gi, sourceReplacement)
    .replace(/https?:\/\/(?:news\.google\.com|(?:www\.)?google\.com\/url)\S*/gi, bareReplacement);
}

function firstGoogle(text) {
  const m = (text || "").match(GOOGLE_RE);
  return m ? m[0] : null;
}

async function fetchAllAffected() {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("campaigns")
      .select("id, slug, title, subject_template, body_template")
      .or("body_template.ilike.%google.com%,subject_template.ilike.%google.com%")
      .range(from, from + PAGE - 1);
    if (error) { console.error("query failed:", error.message); process.exit(1); }
    all.push(...(data ?? []).filter((c) => HAS_GOOGLE(c.body_template) || HAS_GOOGLE(c.subject_template)));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

async function main() {
  console.log(`\n${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — cleaning Google redirects from campaign templates\n`);

  const affected = await fetchAllAffected();
  if (affected.length === 0) {
    console.log("✓ No campaigns carry a Google redirect. Nothing to do.");
    return;
  }
  console.log(`Found ${affected.length} campaign(s) with a Google redirect.\n`);

  let usedPublisher = 0, usedAlertPage = 0, usedPlatform = 0, changed = 0, unchanged = 0, updateErrors = 0;
  let i = 0;

  for (const c of affected) {
    i++;
    const { data: alert } = await sb
      .from("policy_alerts")
      .select("id, source_url")
      .eq("campaign_id", c.id)
      .limit(1)
      .maybeSingle();

    let pubUrl = null;
    if (alert?.id) {
      const { data: news } = await sb
        .from("news_items")
        .select("resolved_url, url")
        .eq("policy_alert_id", alert.id)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      pubUrl = [news?.resolved_url, news?.url].find(isUsablePublisher) || null;
    }
    if (!pubUrl && alert?.source_url && isUsablePublisher(alert.source_url)) pubUrl = alert.source_url;

    const alertUrl = alert?.id ? `${SITE}/alerts/${alert.id}` : SITE;
    if (pubUrl) usedPublisher++; else if (alert?.id) usedAlertPage++; else usedPlatform++;

    const newBody = cleanText(c.body_template, pubUrl, alertUrl);
    const newSubject = cleanText(c.subject_template, pubUrl, alertUrl);
    const didChange = newBody !== c.body_template || newSubject !== c.subject_template;
    if (didChange) changed++; else unchanged++;

    // Print a handful of samples so the dry-run is readable, plus periodic progress.
    if (i <= 12) {
      console.log(`• [${c.slug}]`);
      console.log(`    found:   ${firstGoogle(c.body_template) || firstGoogle(c.subject_template)}`);
      console.log(`    replace → ${pubUrl ? `publisher: ${pubUrl}` : `alert page: ${alertUrl}`}`);
    } else if (APPLY && i % 250 === 0) {
      console.log(`    …processed ${i}/${affected.length}`);
    }

    if (APPLY && didChange) {
      const { error: upErr } = await sb
        .from("campaigns")
        .update({ body_template: newBody, subject_template: newSubject })
        .eq("id", c.id);
      if (upErr) { updateErrors++; console.log(`    ✗ [${c.slug}] update failed: ${upErr.message}`); }
    }
  }

  console.log(
    `\nSummary: ${affected.length} affected — ${usedPublisher} via publisher URL, ` +
      `${usedAlertPage} via alert page, ${usedPlatform} via platform link.`,
  );
  console.log(`  ${changed} would change, ${unchanged} no net change.` + (APPLY ? ` ${updateErrors} update errors.` : ""));
  if (!APPLY) console.log(`\nDry-run only. Re-run with --apply to write these changes.`);
  else console.log(`\n✓ Apply complete.`);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
