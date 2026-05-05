import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Daily auto-sync cron — wakes once per day, refreshes news + bills.
 *
 * Triggered by Vercel Cron (vercel.json) at 7:00 AM ET. Verified via the
 * CRON_SECRET header so randos can't trigger it.
 *
 * What it does:
 *  - Fetches Google News RSS for every state + federal (2026+ articles only)
 *  - Refreshes OpenStates bills for every state
 *
 * Note: Ollama enrichment can't run on Vercel (it lives on the user's machine).
 *       Run `npm run enrich:news` locally when convenient — it picks up where
 *       this cron leaves off.
 */

// We don't set maxDuration — uses plan default (60s on Hobby, 300s on Pro).
// The route fans out states in parallel and bails out on individual failures
// so we always finish within the cap, even if some scopes get skipped.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",
  FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",
  IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
  OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",
  SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",
  VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",
  WY:"Wyoming",
} as const;

type State = keyof typeof STATE_NAMES;

export async function GET(request: NextRequest) {
  // Auth: Vercel Cron sends the CRON_SECRET in the Authorization header
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Lazy-load supabase client (server-only)
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const startedAt = Date.now();
  const log: { step: string; result: unknown }[] = [];

  // ============================================================
  // Run news + bills in parallel batches so we finish under the
  // serverless duration cap (60s Hobby / 300s Pro).
  // ============================================================
  async function batchAll<T>(items: T[], concurrency: number, fn: (item: T) => Promise<unknown>) {
    const queue = [...items];
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) return;
        try { await fn(item); } catch { /* swallow */ }
      }
    });
    await Promise.all(workers);
  }

  // News (51 scopes)
  const newsResults: { scope: string; count: number }[] = [];
  await batchAll(["FED", ...Object.keys(STATE_NAMES)] as ("FED" | State)[], 8, async (scope) => {
    try {
      const count = await syncNewsScope(scope, supabase);
      newsResults.push({ scope, count });
    } catch (e) {
      newsResults.push({ scope, count: 0 });
      void e;
    }
  });
  log.push({ step: "news", result: { scopes: newsResults.length, total: newsResults.reduce((a, b) => a + b.count, 0) } });

  // Bills (50 states) — lower concurrency since OpenStates rate-limits harder
  const billsResults: { state: string; count: number }[] = [];
  await batchAll(Object.keys(STATE_NAMES) as State[], 4, async (state) => {
    try {
      const count = await syncBillsForState(state, supabase);
      billsResults.push({ state, count });
    } catch {
      billsResults.push({ state, count: 0 });
    }
  });
  log.push({ step: "bills", result: { states: billsResults.length, total: billsResults.reduce((a, b) => a + b.count, 0) } });

  // Auto-create campaigns for newly-detected anti-kratom bills. This fires
  // the existing notify_users_for_campaign trigger so matched users get
  // an in-app notification within seconds of the cron run finishing.
  try {
    const { autoCreateCampaignsForNewAntiBills } = await import("@/modules/campaigns/auto-create");
    const auto = await autoCreateCampaignsForNewAntiBills(supabase);
    log.push({ step: "auto_campaigns", result: auto });
  } catch (e) {
    log.push({ step: "auto_campaigns", result: { error: String(e) } });
  }

  const elapsedMs = Date.now() - startedAt;
  return NextResponse.json({
    ok: true,
    elapsed_seconds: Math.round(elapsedMs / 1000),
    log,
  });
}

// ---------- helpers (inlined; we don't import scripts since Vercel is serverless) ----------

function rssUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:1y&hl=en-US&gl=US&ceid=US:en`;
}

function parseRss(xml: string): { title: string; url: string; published_at: string | null; source_name: string | null }[] {
  const items: { title: string; url: string; published_at: string | null; source_name: string | null }[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml))) {
    const block = m[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1];
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
    const sourceMatch = block.match(/<source [^>]*>([\s\S]*?)<\/source>/);
    if (title && link) {
      items.push({
        title: decodeEntities(title.trim()),
        url: link.trim(),
        published_at: pubDate ? new Date(pubDate).toISOString() : null,
        source_name: sourceMatch ? decodeEntities(sourceMatch[1].trim()) : null,
      });
    }
  }
  return items;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

async function syncNewsScope(scope: "FED" | State, supabase: SupabaseClient): Promise<number> {
  const isFed = scope === "FED";
  const stateName = isFed ? null : STATE_NAMES[scope as State];
  const queries = isFed
    ? [`kratom legislation`, `mitragynine FDA`, `kratom Congress bill`]
    : [`kratom ${stateName}`, `kratom ban ${stateName}`];

  const items = new Map<string, { title: string; url: string; published_at: string | null; source_name: string | null }>();
  for (const q of queries) {
    try {
      const res = await fetch(rssUrl(q), { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const xml = await res.text();
      for (const item of parseRss(xml)) {
        if (item.published_at && new Date(item.published_at).getUTCFullYear() < 2026) continue;
        if (!items.has(item.url)) items.set(item.url, item);
      }
    } catch { continue; }
  }
  if (items.size === 0) return 0;

  const cap = (s: string | null, n: number) => (s ? String(s).slice(0, n).trim() || null : null);
  const rows = Array.from(items.values()).map((i) => ({
    state: isFed ? null : (scope as string),
    title: cap(i.title, 300),
    summary: null,
    url: cap(i.url, 1000),
    source_name: cap(i.source_name, 100),
    published_at: i.published_at,
    kratom_topic: null,
    ai_relevance_score: 0.5,
  })).filter((r) => r.url && /^https?:\/\//.test(r.url));

  const { data } = await supabase.from("news_items").upsert(rows, { onConflict: "url", ignoreDuplicates: true }).select("id");
  return data?.length ?? 0;
}

async function syncBillsForState(state: State, supabase: SupabaseClient): Promise<number> {
  const apiKey = process.env.OPENSTATES_API_KEY;
  if (!apiKey) return 0;

  const url = new URL("https://v3.openstates.org/bills");
  url.searchParams.set("jurisdiction", state.toLowerCase());
  url.searchParams.set("q", "kratom");
  url.searchParams.set("per_page", "20");
  url.searchParams.set("sort", "updated_desc");
  url.searchParams.set("include", "abstracts");

  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return 0;
  const data = await res.json() as { results?: Array<{ id: string; identifier: string; title: string; abstracts?: { abstract: string }[]; latest_action_description?: string; latest_action_date?: string; openstates_url?: string }> };
  const results = data.results ?? [];
  if (results.length === 0) return 0;

  const cap = (s: string | null | undefined, n: number) => (s ? String(s).slice(0, n).trim() || null : null);
  function classify(title: string, abstract: string | null): string {
    const text = `${title} ${abstract ?? ""}`.toLowerCase();
    const ban = /\b(ban|prohibit|schedule|criminaliz|controlled substance)\b/.test(text);
    const protect = /\b(protect|regulat|age limit|consumer protection|kcpa|labeling|standards)\b/.test(text);
    const sevenOh = /\b(7-?oh|7-hydroxy)\b/.test(text);
    if (ban && !protect) return "anti";
    if (ban && sevenOh) return "anti";
    if (protect && !ban) return "pro";
    return "neutral";
  }
  function statusFromBill(b: { latest_action_description?: string }): string {
    const a = (b.latest_action_description ?? "").toLowerCase();
    if (a.includes("signed") || a.includes("became law") || a.includes("enacted")) return "enacted";
    if (a.includes("died") || a.includes("withdrawn") || a.includes("failed")) return "dead";
    if (a.includes("passed") || a.includes("third reading")) return "passed_chamber";
    if (a.includes("committee") || a.includes("referred")) return "committee";
    return "introduced";
  }

  const seen = new Map<string, ReturnType<typeof rowFromBill>>();
  function rowFromBill(b: { id: string; identifier: string; title: string; abstracts?: { abstract: string }[]; latest_action_description?: string; latest_action_date?: string; openstates_url?: string }) {
    const abstract = b.abstracts?.[0]?.abstract ?? null;
    return {
      state: state as string,
      bill_number: cap(b.identifier, 60) ?? "—",
      title: cap(b.title, 500),
      summary: cap(abstract, 5000),
      status: statusFromBill(b),
      kratom_relevance: classify(b.title, abstract),
      last_action: cap(b.latest_action_description ?? null, 500),
      last_action_at: b.latest_action_date ?? null,
      source_url: b.openstates_url ?? null,
      active: true,
      last_synced_at: new Date().toISOString(),
    };
  }
  for (const b of results) {
    const row = rowFromBill(b);
    const key = `${row.state}::${row.bill_number}`;
    const existing = seen.get(key);
    if (!existing || (row.summary?.length ?? 0) > (existing.summary?.length ?? 0)) {
      seen.set(key, row);
    }
  }
  const deduped = Array.from(seen.values());
  await supabase.from("bills").upsert(deduped, { onConflict: "state,bill_number" });
  return deduped.length;
}
