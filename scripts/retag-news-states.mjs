#!/usr/bin/env node
/**
 * Backfill for the news state-tagging fix (scripts/lib/news-state.mjs).
 * Re-reads recent news_items and moves a story whose headline leaves its
 * tagged state out and names exactly one other state ("Why did TN ban
 * kratom?" filed under LA), or, when the headline names no state, whose body
 * clearly belongs to another one ("Oxford police investigate 2 university
 * student deaths" from Mississippi Today). New rows are tagged at insert
 * (headline, since 2026-10-23) and at body extraction (since 2026-10-29), so
 * this only cleans the backlog.
 *
 *   node --env-file=.env.local scripts/retag-news-states.mjs              # dry run, 120 days
 *   node --env-file=.env.local scripts/retag-news-states.mjs --apply --days 365
 *
 * Every applied change is printed (id, from -> to, headline) so it can be
 * reversed by hand.
 */
import { createClient } from "@supabase/supabase-js";
import { newsStateFromBody } from "./lib/news-state.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const dIdx = args.indexOf("--days");
const DAYS = dIdx >= 0 ? parseInt(args[dIdx + 1], 10) : 120;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

const moves = [];
// 500 a page: body_paragraphs makes rows heavy.
for (let from = 0; ; from += 500) {
  // .order() is required with .range(): without it pages overlap (954 phantom
  // duplicates on 2026-10-13, memory supabase-postgrest-1000-row-cap).
  const { data, error } = await sb.from("news_items")
    .select("id, state, title, source_name, body_paragraphs")
    .not("state", "is", null)
    .gte("published_at", since)
    // push-state-news pushes stories <12h old; leave the last day alone so a
    // retag can never fire a push on its own.
    .lt("published_at", new Date(Date.now() - 86_400_000).toISOString())
    .order("id", { ascending: true })
    .range(from, from + 499);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) {
    const to = newsStateFromBody({ title: r.title ?? "", paragraphs: r.body_paragraphs, source: r.source_name, scope: r.state });
    if (to && to !== r.state) moves.push({ ...r, to });
  }
  if (!data || data.length < 500) break;
}

const byPair = {};
for (const m of moves) byPair[`${m.state}->${m.to}`] = (byPair[`${m.state}->${m.to}`] ?? 0) + 1;
console.log(`${moves.length} misfiled headline(s) in the last ${DAYS} days.`);
console.log(Object.entries(byPair).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "));

let applied = 0;
for (const m of moves) {
  console.log(`${APPLY ? "move" : "would move"} ${m.id} ${m.state} -> ${m.to}  ${String(m.title).slice(0, 90)}`);
  if (!APPLY) continue;
  const { error } = await sb.from("news_items").update({ state: m.to }).eq("id", m.id).eq("state", m.state);
  if (!error) applied++;
}
if (APPLY) console.log(`Applied ${applied}/${moves.length}.`);
