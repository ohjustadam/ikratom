#!/usr/bin/env node
/**
 * extract-news-events.mjs — calendar auto-sync from news.
 *
 * Mines already-scraped kratom news articles for FUTURE-dated civic
 * events (city-council votes, board-of-pharmacy hearings, public-comment
 * deadlines, "ban takes effect" dates) and seeds them into
 * municipal_meetings so they show on /calendar and fire the existing
 * 7d/3d/1d meeting reminders.
 *
 * Complements discover-municipal-meetings.mjs:
 *   - discover-municipal-meetings searches the WEB per-state via Gemini
 *     grounding to find upcoming meetings.
 *   - THIS script reads the event dates already stated in news articles
 *     we ingested (a council article that says "the council votes June
 *     12") — catching events the grounding search misses, and tying each
 *     to its source article. No grounding call needed (the date is in
 *     the text), so it uses the cheap multi-provider router, not the
 *     quota-limited Gemini-grounding path.
 *
 * Seeded rows land as moderation_status='pending_review' — same as
 * discover-municipal-meetings — so an admin approves before they hit the
 * public calendar / fire reminders. Keeps AI-extracted dates from
 * polluting the live calendar.
 *
 * Cost: $0 (free-tier router).
 *
 * Run:
 *   node --env-file=.env.local scripts/extract-news-events.mjs
 *   node --env-file=.env.local scripts/extract-news-events.mjs --limit 30 --days 10
 *   node --env-file=.env.local scripts/extract-news-events.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { aiRouter } from "./lib/ai-router.mjs";
import { makeFailGuard } from "./lib/batch-guard.mjs";
import { reconcileLocality } from "./lib/geo-resolver.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const LIMIT = parseInt(arg("--limit") ?? "40", 10);
const DAYS = parseInt(arg("--days") ?? "10", 10);
const PROVIDER = arg("--provider");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const STATE_RE = /^[A-Z]{2}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

const SYSTEM = `You extract FUTURE civic/government events from a kratom-policy news article. Return STRICT JSON only — no prose, no markdown fences.

An "event" is a specific dated government proceeding the public could attend or act on:
- a city/county council meeting or vote
- a board of pharmacy / health board hearing
- a state legislative committee hearing or floor vote
- a public-comment deadline
- a law/ban effective date

Output shape:
{
  "events": [
    {
      "event_date": "YYYY-MM-DD",            // the date it happens; REQUIRED
      "event_time_local": "18:00" | null,     // 24h local time if stated, else null
      "body_name": "Normal Town Council" | "Ohio Board of Pharmacy" | null,
      "locality_name": "Normal" | "Nassau County" | null,  // city/county WITHOUT state; null if state-level
      "state_code": "IL" | null,               // 2-letter; null if unknown
      "kind": "council_vote" | "hearing" | "comment_deadline" | "effective_date" | "other",
      "agenda_excerpt": "≤200 chars of what's on the agenda re: kratom",
      "confidence": 0.0-1.0
    }
  ]
}

Rules:
- ONLY events with a concrete calendar date (a full YYYY-MM-DD). Ignore vague references ("next month", "this fall", "soon").
- ONLY events dated in the FUTURE relative to the article's publication. If the article describes something that already happened, do not include it.
- If no concrete future event is mentioned, return {"events": []}.
- Do not invent dates. If the article says "July 1" with no year, infer the year ONLY if unambiguous from the publish date; otherwise omit the event.
- Output ONLY the JSON object.`;

async function extractEvents(item) {
  const user = `Article published: ${(item.published_at ?? "").slice(0, 10)}\nState bucket: ${item.state ?? "—"}\nHeadline: ${item.title}\nSummary: ${item.summary ?? ""}\nExcerpt: ${(item.body_extract_excerpt ?? "").slice(0, 1500)}`;
  const { parsed, provider } = await aiRouter({
    systemPrompt: SYSTEM,
    userPrompt: user,
    maxTokens: 700,
    providerOverride: PROVIDER,
    verbose: false,
  });
  return { parsed, provider };
}

const t0 = Date.now();
console.log(`Extract-news-events${DRY ? " [DRY]" : ""} — last ${DAYS}d, limit ${LIMIT}`);

const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
const { data: items, error } = await sb
  .from("news_items")
  .select("id, title, summary, body_extract_excerpt, state, published_at, url, source_name")
  .not("policy_classified_at", "is", null)
  .is("events_extracted_at", null)
  .is("duplicate_of", null)
  .eq("active", true)
  .not("body_has_kratom_keyword", "is", false)
  .gte("scraped_at", since)
  .order("published_at", { ascending: false, nullsFirst: false })
  .limit(LIMIT);

if (error) { console.error("query failed:", error.message); process.exit(1); }
console.log(`  ${items.length} unprocessed classified article(s)`);

const nowMs = Date.now();
let processed = 0, inserted = 0, dupes = 0, withEvents = 0, failed = 0;
const guard = makeFailGuard();

for (const item of items) {
  let ex;
  try {
    ex = await extractEvents(item);
    guard.ok(); // AI call succeeded — reset the failure streak
  } catch (e) {
    console.log(`  ✗ ${item.id.slice(0, 8)} extract failed (retry next run): ${e.message?.slice(0, 80)}`);
    failed++;
    if (guard.fail(e)) {
      console.log(`  ⛔ ${guard.failures} consecutive failures — AI providers exhausted; stopping early to preserve quota.`);
      break;
    }
    continue; // don't stamp — retry
  }
  const events = Array.isArray(ex.parsed?.events) ? ex.parsed.events : [];
  const future = events.filter((e) => {
    if (!e.event_date || !ISO_DATE_RE.test(e.event_date)) return false;
    const t = Date.parse(`${e.event_date}T${(e.event_time_local && /^\d{2}:\d{2}$/.test(e.event_time_local)) ? e.event_time_local : "12:00"}:00Z`);
    return Number.isFinite(t) && t > nowMs;
  });

  if (future.length > 0) {
    withEvents++;
    console.log(`\n  ${item.id.slice(0, 8)} [${ex.provider}] "${item.title.slice(0, 50)}" → ${future.length} future event(s)`);
  }

  for (const e of future) {
    // Gazetteer-backed reconciliation: the AI's state_code (and the per-state
    // scrape bucket) are only CANDIDATES — the resolver decides, never emitting
    // a state the gazetteer contradicts. Better an undercount than a mislabel.
    const { locality: resolvedState, corroborated } = reconcileLocality({
      aiLocality: e.state_code,
      scopeState: item.state,
      text: `${item.title ?? ""} ${e.agenda_excerpt ?? ""}`,
      title: item.title,
    });
    // A municipal meeting needs a concrete state; FED/ALL aren't seedable here.
    const state = STATE_RE.test(resolvedState) ? resolvedState : null;
    if (!state) { console.log(`     · skip event (no resolvable state): ${e.event_date} ${e.body_name ?? ""}`); continue; }

    const meetingAt = `${e.event_date}T${(e.event_time_local && /^\d{2}:\d{2}$/.test(e.event_time_local)) ? e.event_time_local : "12:00"}:00Z`;
    // Don't pair a specific "City, ST" locality with an unverified state — a
    // city under a guessed-wrong state is a mislabel. Drop to state-level when
    // the resolver couldn't corroborate.
    const locality = (e.locality_name && corroborated) ? `${e.locality_name.trim()}, ${state}` : null;
    if (e.locality_name && !corroborated) {
      console.log(`     · locality-guard: dropping "${e.locality_name.trim()}, ${state}" (uncorroborated) → state-level row`);
    }
    const conf = Number.isFinite(e.confidence) ? Math.max(0, Math.min(1, e.confidence)) : null;

    console.log(`     • ${e.event_date} ${e.kind} ${e.body_name ?? ""} (${locality ?? state})  conf=${conf ?? "?"}`);
    if (DRY) continue;

    const row = {
      state,
      locality,
      body_name: e.body_name ? String(e.body_name).slice(0, 200) : null,
      meeting_at: meetingAt,
      format: "unknown",
      agenda_text: e.agenda_excerpt ? String(e.agenda_excerpt).slice(0, 1000) : null,
      discovered_via: "news_article",
      source_url: item.url?.slice(0, 500) ?? null,
      kratom_relevance: "pending",
      ai_confidence: conf,
      ai_notes: `Extracted from news "${item.title?.slice(0, 100)}" (${item.source_name ?? "source"}); kind=${e.kind}`,
      moderation_status: "pending_review",
    };
    const { error: insErr } = await sb.from("municipal_meetings").insert(row);
    if (insErr) {
      if (insErr.code === "23505") { dupes++; console.log("       ⏭  already on calendar"); }
      else console.log(`       ⚠ insert failed: ${insErr.message?.slice(0, 100)}`);
    } else {
      inserted++;
    }
  }

  // Stamp processed (extraction succeeded — events found or not).
  if (!DRY) await sb.from("news_items").update({ events_extracted_at: new Date().toISOString() }).eq("id", item.id);
  processed++;
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — processed ${processed}, articles-with-events ${withEvents}, calendar rows inserted ${inserted}, dupes ${dupes}, failed ${failed}.`);

if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "extract_news_events",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: guard.status(processed),
      rows_added: inserted,
      notes: `processed ${processed} · with-events ${withEvents} · inserted ${inserted} · dupes ${dupes} · failed ${failed}`,
      error_message: guard.note(),
    });
  } catch { /* best-effort */ }
}
