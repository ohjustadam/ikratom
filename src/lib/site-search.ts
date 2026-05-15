/**
 * Site-wide search across the main content types.
 *
 * Owner directive 2026-05-15: "site wide dynmic search bar with filtering
 * options that can be used on any page... protect ourselves from
 * potential threats, is it possible to do without the ddos risk site wide?"
 *
 * Design: pure Postgres ilike queries against the existing tables, no
 * LLM in the path. Cheap per-query (DB does index scans + small unions),
 * and the existing rate-limit (src/lib/rate-limit.ts) caps abuse at the
 * IP-bucket level.
 *
 * Future: when we have budget, swap in pre-computed tsvector columns
 * per table + a SECURITY DEFINER RPC that does the UNION ALL in SQL.
 * For now, parallel TS queries are simpler to reason about + fast enough
 * at our row counts (8k legislators is the biggest table).
 */

import { createClient } from "./supabase/server";

export type SiteSearchHit = {
  kind: "bill" | "paper" | "legislator" | "campaign" | "thread";
  /** Stable URL to navigate to. */
  href: string;
  /** Heading text — what the user sees first. */
  title: string;
  /** One-line subtitle / context. */
  subtitle: string | null;
  /** Optional richer snippet (truncated body / summary). */
  snippet: string | null;
  /** Tag pills shown next to the title — e.g. state, year. */
  pills: string[];
};

export type SiteSearchKind = SiteSearchHit["kind"];

const PER_TABLE_LIMIT = 6;

/**
 * Sanitize for ilike — escape Postgres pattern characters AND limit
 * length. Returns null if the query is too short.
 */
function buildPattern(q: string): string | null {
  const trimmed = q.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return null;
  // Escape the ilike meta-chars % and _ as well as \ used for ilike escape
  const esc = trimmed.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `%${esc}%`;
}

/**
 * Run the parallel queries. Caller is responsible for rate-limiting
 * BEFORE invoking this — see /app/search/page.tsx for the wrapper.
 */
export async function searchSite(query: string, opts: {
  kinds?: SiteSearchKind[];
  state?: string;
} = {}): Promise<{ hits: SiteSearchHit[]; tooShort: boolean }> {
  const pattern = buildPattern(query);
  if (!pattern) return { hits: [], tooShort: true };

  const sb = await createClient();
  const want = (k: SiteSearchKind) => !opts.kinds || opts.kinds.includes(k);
  const state = opts.state?.trim().toUpperCase().slice(0, 2) || null;

  const tasks: Promise<SiteSearchHit[]>[] = [];

  // Bills
  if (want("bill")) {
    tasks.push((async () => {
      let q = sb.from("bills")
        .select("id, state, bill_number, title, summary, status, last_action_at")
        .eq("active", true)
        .or(`title.ilike.${pattern},summary.ilike.${pattern},bill_number.ilike.${pattern}`)
        .order("last_action_at", { ascending: false, nullsFirst: false })
        .limit(PER_TABLE_LIMIT);
      if (state) q = q.eq("state", state);
      const { data } = await q;
      return (data ?? []).map((b): SiteSearchHit => ({
        kind: "bill",
        href: `/bills/${b.state}/${b.id}`,
        title: `${b.bill_number} — ${b.title}`,
        subtitle: b.status ? `Status: ${b.status}` : null,
        snippet: b.summary?.slice(0, 200) ?? null,
        pills: [b.state, ...(b.status ? [b.status] : [])],
      }));
    })());
  }

  // Research papers
  if (want("paper")) {
    tasks.push((async () => {
      const { data } = await sb.from("research_papers")
        .select("id, title, abstract, journal, publication_year, authors")
        .eq("is_active", true)
        .or(`title.ilike.${pattern},abstract.ilike.${pattern},journal.ilike.${pattern}`)
        .order("publication_year", { ascending: false, nullsFirst: false })
        .limit(PER_TABLE_LIMIT);
      return (data ?? []).map((p): SiteSearchHit => ({
        kind: "paper",
        href: `/research/${p.id}`,
        title: p.title,
        subtitle: [p.journal, p.publication_year].filter(Boolean).join(" · ") || null,
        snippet: (p.abstract as string | null)?.slice(0, 200) ?? null,
        pills: ["research", ...((p.authors as string[] | null)?.slice(0, 1) ?? [])],
      }));
    })());
  }

  // Legislators — name match only (we don't want to expose private fields)
  if (want("legislator")) {
    tasks.push((async () => {
      let q = sb.from("legislators")
        .select("id, full_name, role, state, district, party")
        .eq("active", true)
        .ilike("full_name", pattern)
        .order("full_name", { ascending: true })
        .limit(PER_TABLE_LIMIT);
      if (state) q = q.eq("state", state);
      const { data } = await q;
      return (data ?? []).map((l): SiteSearchHit => ({
        kind: "legislator",
        href: `/legislators/${l.state}#${l.id}`,
        title: l.full_name,
        subtitle: [l.role, l.district ? `District ${l.district}` : null, l.party].filter(Boolean).join(" · "),
        snippet: null,
        pills: [l.state, l.party].filter(Boolean) as string[],
      }));
    })());
  }

  // Campaigns
  if (want("campaign")) {
    tasks.push((async () => {
      let q = sb.from("campaigns")
        .select("id, slug, title, blurb, body_md, state, active")
        .eq("active", true)
        .or(`title.ilike.${pattern},blurb.ilike.${pattern},body_md.ilike.${pattern}`)
        .limit(PER_TABLE_LIMIT);
      if (state) q = q.eq("state", state);
      const { data } = await q;
      return (data ?? []).map((c): SiteSearchHit => ({
        kind: "campaign",
        href: `/campaigns/${c.slug}`,
        title: c.title,
        subtitle: c.blurb?.slice(0, 120) ?? null,
        snippet: c.body_md?.slice(0, 200) ?? null,
        pills: [c.state, "campaign"].filter(Boolean) as string[],
      }));
    })());
  }

  // Forum threads — public ones only
  if (want("thread")) {
    tasks.push((async () => {
      let q = sb.from("forum_threads")
        .select("id, state, title, body, locked, residents_only, post_count, upvote_count")
        .or(`title.ilike.${pattern},body.ilike.${pattern}`)
        .eq("residents_only", false) // public threads only — privacy
        .order("upvote_count", { ascending: false })
        .limit(PER_TABLE_LIMIT);
      if (state) q = q.eq("state", state);
      const { data } = await q;
      return (data ?? []).map((t): SiteSearchHit => ({
        kind: "thread",
        href: `/forum/${t.state}/${t.id}`,
        title: t.title,
        subtitle: `${t.post_count ?? 0} posts · ${t.upvote_count ?? 0} upvotes`,
        snippet: t.body?.slice(0, 200) ?? null,
        pills: [t.state, "discussion"].filter(Boolean) as string[],
      }));
    })());
  }

  const results = await Promise.all(tasks);
  const hits = results.flat();

  // Light client-side rank: exact-prefix > word-boundary > substring.
  // (Postgres ilike doesn't give us a rank, so we approximate.)
  const lower = query.trim().toLowerCase();
  function rank(h: SiteSearchHit): number {
    const t = h.title.toLowerCase();
    if (t === lower) return 100;
    if (t.startsWith(lower)) return 80;
    if (new RegExp(`\\b${escapeRegex(lower)}`).test(t)) return 60;
    if (t.includes(lower)) return 40;
    if ((h.subtitle ?? "").toLowerCase().includes(lower)) return 30;
    if ((h.snippet ?? "").toLowerCase().includes(lower)) return 20;
    return 10;
  }
  hits.sort((a, b) => rank(b) - rank(a));
  return { hits, tooShort: false };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const SITE_SEARCH_KIND_LABELS: Record<SiteSearchKind, string> = {
  bill: "Bill",
  paper: "Research paper",
  legislator: "Legislator",
  campaign: "Campaign",
  thread: "Discussion",
};

export const SITE_SEARCH_KIND_EMOJI: Record<SiteSearchKind, string> = {
  bill: "📜",
  paper: "🔬",
  legislator: "🏛",
  campaign: "📣",
  thread: "💬",
};
