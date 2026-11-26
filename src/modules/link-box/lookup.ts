import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  billNumberSpellings, billRefs, matchPlace, pickBill, sameStoryTitle, stateFromUrl, statesInText,
  titleSearchTerms, type AlertHit, type BillHit, type Found, type StoryHit,
} from "@/lib/link-box";
import type { Inspected } from "./inspect";

/**
 * The duplicate check's database side. Service role, because a tip still
 * waiting for a moderator is not publicly readable and must still count as
 * "we already have this". Only ids, titles and statuses leave this module.
 */
const STORY = "id, title, source_name, duplicate_of, bill_id, state, active";
const ALERT = "id, title, moderation_status, bill_id, locality";
export const BILL =
  "id, state, bill_number, title, status, active, scope, locality, last_action, last_action_at, session_sine_die, " +
  "local_meta, kratom_relevance, targets_natural_leaf, targets_synthetic_only, summary, summary_ai, advocacy_callout, " +
  "relevance_confidence, session_id, deep_analyzed_at";

export type FullBill = BillHit & {
  locality: string | null; summary: string | null; summary_ai: string | null; advocacy_callout: string | null;
  relevance_confidence: number | null; session_id: string | null; deep_analyzed_at: string | null;
};

const rows = <T,>(r: { data: unknown }) => ((r.data ?? []) as T[]);

export async function findExisting(sb: SupabaseClient, ins: Inspected): Promise<Found> {
  const s = ins.spellings;
  const [byUrl, byResolved, alerts, billSrc, billOfficial] = await Promise.all([
    sb.from("news_items").select(STORY).in("url", s).limit(5),
    sb.from("news_items").select(STORY).in("resolved_url", s).limit(5),
    sb.from("policy_alerts").select(ALERT).in("source_url", s).limit(5),
    sb.from("bills").select(BILL).in("source_url", s).limit(3),
    sb.from("bills").select(BILL).in("official_url", s).limit(3),
  ]);
  let urlStories = [...rows<StoryHit>(byUrl), ...rows<StoryHit>(byResolved)];

  // A syndicated twin points at its keeper (#1190); show the keeper.
  const twin = urlStories.find((h) => h.duplicate_of && h.active !== false);
  if (twin && !urlStories.some((h) => !h.duplicate_of && h.active !== false)) {
    const { data } = await sb.from("news_items").select(STORY).eq("id", twin.duplicate_of!).maybeSingle();
    if (data) urlStories = [data as StoryHit, ...urlStories];
  }

  let titleStories: StoryHit[] = [];
  const terms = titleSearchTerms(ins.meta.title);
  if (terms.length >= 3) {
    const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const { data } = await sb.from("news_items").select(STORY)
      .textSearch("search_tsv", terms.join(" "), { type: "plain", config: "english" })
      .gte("published_at", since).limit(25);
    titleStories = ((data ?? []) as StoryHit[]).filter((r) => sameStoryTitle(ins.meta.title, r.title));
  }

  return {
    urlStories,
    urlAlerts: rows<AlertHit>(alerts),
    urlBills: [...rows<BillHit>(billSrc), ...rows<BillHit>(billOfficial)],
    titleStories,
  };
}

/**
 * The tracked bill or ordinance a NEW link is about, if it names exactly one:
 * a bill number plus its state, or a town/county we track an ordinance for.
 */
export async function findBillFor(sb: SupabaseClient, ins: Inspected, extraState?: string | null): Promise<FullBill | null> {
  const text = [ins.meta.title, ins.meta.description].filter(Boolean).join(" \n ");
  const states = new Set(statesInText(text));
  for (const u of [ins.url, ins.publisherUrl]) {
    const st = stateFromUrl(u);
    if (st) states.add(st);
  }
  if (extraState && /^[A-Z]{2}$/.test(extraState)) states.add(extraState);
  if (!states.size || states.size > 3) return null;

  let decoded = ins.url;
  try { decoded = decodeURIComponent(ins.url); } catch { /* a malformed escape: use it as given */ }
  const refs = billRefs(`${text} ${decoded} ${ins.publisherUrl}`);
  if (refs.length) {
    const { data } = await sb.from("bills").select(BILL).eq("active", true)
      .in("state", [...states]).in("bill_number", refs.flatMap(billNumberSpellings)).limit(10);
    const hit = pickBill((data ?? []) as unknown as FullBill[]);
    if (hit) return hit;
  }

  const { data: local } = await sb.from("bills").select(BILL).eq("active", true)
    .in("scope", ["municipal", "county"]).in("state", [...states]).limit(150);
  return pickBill(matchPlace(text, (local ?? []) as unknown as FullBill[]));
}
