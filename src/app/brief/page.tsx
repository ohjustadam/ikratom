import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrGenerateBriefSummary } from "@/modules/brief/summary";
import { computeBillMomentum, MOMENTUM_LABEL, MOMENTUM_TONE } from "@/lib/bill-momentum";
import BriefAudioButton from "./BriefAudioButton";

export const metadata = {
  title: "Daily brief — what's moving in kratom policy",
  description:
    "Personalized digest: alerts in your state, bills you watch, news on tracked legislators, active operations near you. Pull-mode tracking burden converted to push-mode reading.",
};
export const dynamic = "force-dynamic";

/**
 * /brief — Daily Advocate Brief MVP.
 *
 * Single consolidated page that surfaces, for the signed-in user:
 *
 *   1. Open action surface — campaigns + operation-response routes for
 *      active operations in their state. The "do this now" header.
 *   2. State heat — critical/alert severity policy_alerts in their
 *      state from the last 7 days.
 *   3. Watched-bill movements — status changes on bills they subscribed
 *      to (bill_subscriptions) in the last 7 days.
 *   4. Active operations — clusters with bills touched in last 30 days
 *      in their state.
 *
 * Anon visitors get a national-scope version (no personalization).
 *
 * Defensive on every section so a single failing query (RLS hiccup,
 * pre-migration deploy, missing subscription table) degrades that
 * one section instead of 500-ing the whole page.
 *
 * MVP scope: live-computed, no storage. v2 will add daily push
 * delivery (cron writes the digest to a daily_briefs table + fires
 * web-push to opted-in users with a deep link to the snapshot).
 */
export default async function BriefPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  // Viewer state — defaults a lot of the digest scope. Anon → null.
  let viewerState: string | null = null;
  let viewerName: string | null = null;
  if (user) {
    const { data } = await sb
      .from("profiles")
      .select("state, full_name")
      .eq("id", user.id)
      .maybeSingle();
    if (data) {
      viewerState = (data as { state: string | null }).state;
      viewerName = (data as { full_name: string | null }).full_name;
    }
  }

  // 7-day cutoff used by multiple sections
  const ALERT_HORIZON = 7;
  const cutoff7 = new Date(Date.now() - ALERT_HORIZON * 86400 * 1000).toISOString();
  const cutoff30 = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  // ── 1. State alerts (critical + alert severity, last 7 days)
  type Alert = { id: string; kind: string; severity: string; title: string; locality: string; created_at: string; source_url: string | null };
  let stateAlerts: Alert[] = [];
  try {
    let q = sb.from("policy_alerts")
      .select("id, kind, severity, title, locality, created_at, source_url")
      .in("severity", ["critical", "alert"])
      .eq("moderation_status", "approved")
      .gte("created_at", cutoff7)
      .order("created_at", { ascending: false })
      .limit(20);
    if (viewerState) q = q.eq("locality", viewerState);
    const { data } = await q;
    stateAlerts = (data ?? []) as Alert[];
  } catch { /* defensive */ }

  // ── 1b. National + other-state alerts (so home-state isn't a silo).
  // Same 7-day window, excludes the user's own state when set.
  let nationalAlerts: Alert[] = [];
  try {
    let q = sb.from("policy_alerts")
      .select("id, kind, severity, title, locality, created_at, source_url")
      .in("severity", ["critical", "alert"])
      .eq("moderation_status", "approved")
      .gte("created_at", cutoff7)
      .order("created_at", { ascending: false })
      .limit(12);
    if (viewerState) q = q.neq("locality", viewerState);
    const { data } = await q;
    // Dedupe by title — the news-driven alert pipeline can create
    // multiple policy_alert rows for the same syndicated article.
    const seen = new Set<string>();
    nationalAlerts = ((data ?? []) as Alert[]).filter((a) => {
      const key = (a.title ?? "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch { /* defensive */ }

  // ── 2. Watched-bill movements (status changes in last 7 days)
  type WatchedBill = {
    id: string; state: string; bill_number: string; title: string | null;
    status: string | null; last_action: string | null; last_action_at: string | null;
    kratom_relevance: string | null;
    current_committee_name: string | null; active: boolean | null;
  };
  let watchedBills: WatchedBill[] = [];
  if (user) {
    try {
      const { data: subs } = await sb
        .from("bill_subscriptions")
        .select("bill_id")
        .eq("user_id", user.id);
      const billIds = (subs ?? []).map((s: { bill_id: string }) => s.bill_id);
      if (billIds.length > 0) {
        const { data } = await sb
          .from("bills")
          .select("id, state, bill_number, title, status, last_action, last_action_at, kratom_relevance, current_committee_name, active")
          .in("id", billIds)
          .gte("last_action_at", cutoff7.slice(0, 10))
          .order("last_action_at", { ascending: false });
        watchedBills = (data ?? []) as WatchedBill[];
      }
    } catch { /* defensive */ }
  }

  // ── 3. Active operations in state (clusters with bills last touched ≤30d)
  type ActiveOp = { slug: string; name: string; posture: string; bills: number; states: number };
  let activeOps: ActiveOp[] = [];
  try {
    let q = sb.from("bill_cluster_members")
      .select("bill_clusters!inner(slug, name, posture), bills!inner(state, last_action_at, active)")
      .eq("bills.active", true)
      .gte("bills.last_action_at", cutoff30);
    if (viewerState) q = q.eq("bills.state", viewerState);
    const { data } = await q;
    type Row = {
      bill_clusters: { slug: string; name: string; posture: string } | Array<{ slug: string; name: string; posture: string }> | null;
      bills: { state: string } | Array<{ state: string }> | null;
    };
    const norm = <T,>(x: T | T[] | null): T | null => Array.isArray(x) ? x[0] ?? null : x;
    const agg = new Map<string, ActiveOp & { state_set: Set<string> }>();
    for (const r of (data ?? []) as Row[]) {
      const cl = norm(r.bill_clusters);
      const bl = norm(r.bills);
      if (!cl || !bl) continue;
      const cur = agg.get(cl.slug) ?? {
        slug: cl.slug, name: cl.name, posture: cl.posture,
        bills: 0, states: 0, state_set: new Set<string>(),
      };
      cur.bills += 1;
      cur.state_set.add(bl.state);
      agg.set(cl.slug, cur);
    }
    activeOps = [...agg.values()]
      .map((x) => ({ slug: x.slug, name: x.name, posture: x.posture, bills: x.bills, states: x.state_set.size }))
      .sort((a, b) => b.bills - a.bills);
  } catch { /* defensive */ }

  // ── 4. Open campaigns in state — surface as the "do this now" CTA
  type OpenCampaign = { slug: string; title: string; blurb: string | null; state: string | null };
  let openCampaigns: OpenCampaign[] = [];
  try {
    let q = sb.from("campaigns")
      .select("slug, title, blurb, state")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(6);
    if (viewerState) q = q.or(`state.is.null,state.eq.${viewerState}`);
    const { data } = await q;
    openCampaigns = (data ?? []) as OpenCampaign[];
  } catch { /* defensive */ }

  // ── Fresh news — published in last 36 hours, classified as
  // kratom-relevant. Filtered on `published_at` (NOT scraped_at)
  // so 6-month-old articles surfaced by Google News RSS today
  // don't pollute the briefing. State-scoped for signed-in users,
  // national for everyone else.
  type NewsItem = {
    id: string; title: string; url: string; source_name: string | null;
    state: string | null; published_at: string; summary: string | null;
  };
  let freshNews: NewsItem[] = [];
  const cutoff36hDate = new Date(Date.now() - 36 * 3600 * 1000).toISOString().slice(0, 10);
  try {
    let nq = sb.from("news_items")
      .select("id, title, url, source_name, state, published_at, summary")
      .gte("published_at", cutoff36hDate)
      .not("policy_classified_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(15);
    if (viewerState) nq = nq.or(`state.eq.${viewerState},state.is.null,state.eq.FED`);
    const { data } = await nq;
    // Same dedupe-by-url as nationalNews below.
    const seen = new Set<string>();
    freshNews = ((data ?? []) as NewsItem[]).filter((n) => {
      const key = (n.url || n.title).trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch { /* defensive */ }

  // Cross-state news — same 36h window, items NOT in the home-state
  // bucket. Renders in the "Across the country" section below.
  let nationalNews: NewsItem[] = [];
  try {
    let nq = sb.from("news_items")
      .select("id, title, url, source_name, state, published_at, summary")
      .gte("published_at", cutoff36hDate)
      .not("policy_classified_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(15);
    if (viewerState) nq = nq.neq("state", viewerState);
    const { data } = await nq;
    // Dedupe by canonical url — Google News RSS surfaces the same
    // article under multiple per-state queries, producing exact-dupe
    // rows in news_items. Keep the first occurrence per URL.
    const seen = new Set<string>();
    nationalNews = ((data ?? []) as NewsItem[]).filter((n) => {
      const key = (n.url || n.title).trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch { /* defensive */ }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // ── AI day-summary paragraph. Cached per (scope, date) via
  // daily_brief_summaries table so we hit the LLM at most once per
  // scope per day. Defensive — if generation fails we render
  // without the paragraph rather than blocking the whole page.
  const STATE_NAMES: Record<string, string> = {
    AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",
    DE:"Delaware",DC:"District of Columbia",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",
    IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",
    MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",
    NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
    OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
    SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",
    WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
  };
  const aiScope = viewerState ?? "national";
  const aiSummary = await getOrGenerateBriefSummary({
    scope: aiScope,
    state_label: viewerState ? STATE_NAMES[viewerState] ?? viewerState : null,
    alerts_critical: stateAlerts.filter((a) => a.severity === "critical").length,
    alerts_warn: stateAlerts.filter((a) => a.severity === "alert").length,
    recent_alert_titles: stateAlerts.slice(0, 5).map((a) => a.title),
    bills_moved: watchedBills.length,
    recent_bill_lines: watchedBills.slice(0, 5).map((b) =>
      `${b.state} ${b.bill_number} — ${b.status ?? "—"} (${b.last_action_at ?? "—"})`),
    active_ops: activeOps.length,
    active_op_names: activeOps.slice(0, 5).map((op) => op.name.split("—")[0].trim().split("(")[0].trim()),
  });

  const greeting = viewerName?.trim()
    ? `Good morning, ${viewerName.trim().split(" ")[0]}`
    : viewerState
    ? `Today in ${viewerState}`
    : "Today across the platform";

  // Build the read-aloud script. Pure-text — no markdown, no emoji-
  // heavy sections, sentence-cased so SpeechSynthesis sounds natural.
  const stateName = viewerState ? STATE_NAMES[viewerState] ?? viewerState : null;
  const audioParts: string[] = [];
  audioParts.push(`${greeting}. Here's your iKratom daily brief for ${today}.`);
  if (aiSummary?.summary) audioParts.push(aiSummary.summary);
  if (stateAlerts.length > 0) {
    audioParts.push(`${stateAlerts.length} active alert${stateAlerts.length === 1 ? "" : "s"}${stateName ? ` in ${stateName}` : ""}.`);
    for (const a of stateAlerts.slice(0, 3)) audioParts.push(a.title.replace(/[—–]/g, "-"));
  }
  if (freshNews.length > 0) {
    audioParts.push(`Today's headlines${stateName ? ` for ${stateName}` : ""}: ${freshNews.slice(0, 5).map((n) => n.title).join(". ")}.`);
  }
  if (nationalAlerts.length > 0) {
    audioParts.push(`Across the country: ${nationalAlerts.slice(0, 3).map((a) => `${a.locality || "federal"}, ${a.title}`).join(". ")}.`);
  }
  audioParts.push("That's the brief. Tap a card to dive deeper, or visit ikratom.org for the full picture.");
  const audioScript = audioParts.join(" ");

  // Check whether a pre-rendered MP3 of today's brief exists. The cron
  // (scripts/render-daily-brief-audio.mjs) renders it once per day with
  // Edge TTS's Christopher Neural voice — far better than the browser-
  // native SpeechSynthesis fallback, especially on Windows where neural
  // voices may not be installed.
  const todayKey = new Date().toISOString().slice(0, 10);
  let audioUrl: string | null = null;
  try {
    const { data: files } = await sb.storage
      .from("daily-brief-audio")
      .list(todayKey, { limit: 1, search: "national.mp3" });
    if (files && files.length > 0) {
      const { data: pub } = sb.storage
        .from("daily-brief-audio")
        .getPublicUrl(`${todayKey}/national.mp3`);
      audioUrl = pub.publicUrl;
    }
  } catch { /* bucket may not exist on legacy deploys — fall back to SpeechSynthesis */ }

  const isEmpty =
    stateAlerts.length === 0 &&
    watchedBills.length === 0 &&
    activeOps.length === 0 &&
    openCampaigns.length === 0 &&
    freshNews.length === 0 &&
    nationalAlerts.length === 0 &&
    nationalNews.length === 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Daily brief
        </p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-3xl font-bold sm:text-4xl">{greeting}</h1>
          <BriefAudioButton script={audioScript} audioUrl={audioUrl} />
        </div>
        <p className="mt-2 text-sm text-zinc-400">{today}</p>
        {!user && (
          <p className="mt-3 rounded-md border border-amber-700/40 bg-amber-950/10 p-3 text-[11px] text-amber-200">
            💡 <Link href="/login" className="font-semibold underline">Sign in</Link> for a state-scoped, watched-bill-aware version. Anon sees national-scope signals only.
          </p>
        )}
      </header>

      {/* AI day-summary paragraph */}
      {aiSummary && (
        <section className="mb-6 rounded-lg border border-emerald-700/30 bg-gradient-to-br from-emerald-950/30 to-zinc-950/40 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
            🧠 Today, in plain English
          </p>
          <p className="text-[13px] leading-relaxed text-zinc-100">
            {aiSummary.summary}
          </p>
          <p className="mt-2 text-[9px] text-zinc-600">
            {aiSummary.cached ? "Cached for today" : "Just generated"}
            {aiSummary.provider && ` · ${aiSummary.provider}`} · auto-synthesized from the signals below
          </p>
        </section>
      )}

      {isEmpty && (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-6 text-center text-sm text-zinc-400">
          Nothing requiring attention right now in your scope. Quiet is good.
        </p>
      )}

      {/* 1. Action CTAs */}
      {(openCampaigns.length > 0 || activeOps.length > 0) && (
        <section className="mb-8 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-emerald-300">
            ⚡ Do this now
          </h2>
          <ul className="space-y-2">
            {openCampaigns.slice(0, 3).map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/campaigns/${c.slug}`}
                  className="block rounded-md border border-emerald-700/30 bg-emerald-950/10 px-3 py-2 text-[12px] hover:border-emerald-500"
                >
                  <div className="font-semibold text-emerald-100">📨 {c.title}</div>
                  {c.blurb && <div className="mt-0.5 text-[11px] text-zinc-400">{c.blurb}</div>}
                </Link>
              </li>
            ))}
            {activeOps.slice(0, 3).map((op) => (
              <li key={op.slug}>
                <Link
                  href={`/campaigns/operation/${op.slug}`}
                  className="block rounded-md border border-rose-700/30 bg-rose-950/10 px-3 py-2 text-[12px] hover:border-rose-500"
                >
                  <div className="font-semibold text-rose-100">
                    🕸 Respond to {op.name.split("—")[0].trim().split("(")[0].trim()}
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-400">
                    <strong>{op.bills}</strong> active bill{op.bills === 1 ? "" : "s"}
                    {op.states > 1 && <> across <strong>{op.states}</strong> states</>}
                    {" "}in the last 30 days
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 2. State alerts */}
      {stateAlerts.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-red-300">
            🚨 {viewerState ? `${viewerState} alerts` : "Critical alerts"} · last {ALERT_HORIZON} days
          </h2>
          <ul className="space-y-2">
            {stateAlerts.map((a) => {
              const daysAgo = Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86_400_000);
              return (
                <li key={a.id}>
                  <Link
                    href={`/alerts/${a.id}`}
                    className={`block rounded border px-3 py-2 text-[11px] transition hover:border-emerald-500 ${
                      a.severity === "critical"
                        ? "border-red-700/40 bg-red-950/10 text-red-100"
                        : "border-amber-700/30 bg-amber-950/10 text-amber-100"
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span>{a.severity === "critical" ? "🚨" : "⚠️"}</span>
                      <span className="font-mono text-[9px] uppercase text-zinc-400">{a.locality}</span>
                      <span className="font-semibold">{a.title}</span>
                      <span className="ml-auto text-[10px] text-zinc-500">
                        {daysAgo === 0 ? "today" : daysAgo === 1 ? "1d ago" : `${daysAgo}d ago`}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] text-zinc-500">
            Full alert feed at <Link href="/pulse" className="text-emerald-400 hover:underline">/pulse</Link>.
          </p>
        </section>
      )}

      {/* News briefing — published in last 36h, filtered by published_at
          so old articles re-surfaced by Google News don't pollute the
          briefing. The tap-target for the daily push notification. */}
      {freshNews.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
            🗞 Today&apos;s news briefing · {freshNews.length} fresh article{freshNews.length === 1 ? "" : "s"}
          </h2>
          <ul className="space-y-2">
            {freshNews.map((n) => {
              const pubDate = new Date(n.published_at);
              const hoursAgo = Math.floor((Date.now() - pubDate.getTime()) / 3600000);
              const ago = hoursAgo < 1 ? "just now" : hoursAgo < 24 ? `${hoursAgo}h ago` : `${Math.floor(hoursAgo / 24)}d ago`;
              return (
                <li key={n.id}>
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 hover:border-emerald-500"
                  >
                    <p className="text-[13px] font-semibold text-zinc-100">
                      {n.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[10px] text-zinc-500">
                      {n.state && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono uppercase text-zinc-400">
                          {n.state}
                        </span>
                      )}
                      {n.source_name && <span>{n.source_name}</span>}
                      <span>· {ago}</span>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] text-zinc-500">
            Filtered to articles published in last 36h (not just newly indexed). Full archive at <Link href="/news" className="text-emerald-400 hover:underline">/news</Link>.
          </p>
        </section>
      )}

      {/* 3. Watched-bill movements */}
      {watchedBills.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
            📋 Watched bills · moved in last {ALERT_HORIZON} days
          </h2>
          <ul className="space-y-1.5">
            {watchedBills.map((b) => (
              <li key={b.id}>
                <Link href={`/bills/${b.id}`} className="block rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px] hover:border-emerald-500">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono font-semibold text-zinc-100">{b.state} {b.bill_number}</span>
                    {b.kratom_relevance === "anti" && (
                      <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-[10px] text-red-300">Anti</span>
                    )}
                    {b.kratom_relevance === "pro" && (
                      <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300">Pro</span>
                    )}
                    {b.status && <span className="text-[10px] text-zinc-500">[{b.status}]</span>}
                    {(() => {
                      const m = computeBillMomentum({
                        last_action_at: b.last_action_at,
                        status: b.status,
                        current_committee_name: b.current_committee_name,
                        sponsor_count: 0,
                        cluster_count: 0,
                        recent_news_mentions: 0,
                        active: b.active !== false,
                      });
                      return (
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${MOMENTUM_TONE[m.label]}`}
                          title={m.rationale}
                        >
                          {MOMENTUM_LABEL[m.label]}
                        </span>
                      );
                    })()}
                    {b.last_action_at && (
                      <span className="ml-auto text-[10px] text-zinc-500">{b.last_action_at}</span>
                    )}
                  </div>
                  {b.title && <p className="mt-0.5 text-[11px] text-zinc-300">{b.title.slice(0, 100)}{b.title.length > 100 ? "…" : ""}</p>}
                  {b.last_action && <p className="mt-0.5 text-[10px] text-zinc-500">{b.last_action}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {user && watchedBills.length === 0 && (
        <section className="mb-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-400">
          <p className="font-semibold text-zinc-300">📋 You aren&apos;t watching any bills.</p>
          <p className="mt-1">
            Visit any <Link href="/bills" className="text-emerald-400 hover:underline">bill page</Link> and click &quot;Watch&quot; — the brief will surface status changes here when they happen.
          </p>
        </section>
      )}

      {/* 4. Active operations */}
      {activeOps.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
            🕸 {viewerState ? `Active operations in ${viewerState}` : "Most active operations"} · last 30 days
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {activeOps.slice(0, 6).map((op) => (
              <li key={op.slug}>
                <Link href={`/intel/operations/${op.slug}`} className="block rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px] hover:border-emerald-500">
                  <div className="font-semibold text-zinc-100">
                    {op.name.split("—")[0].trim().split("(")[0].trim()}
                  </div>
                  <div className="mt-0.5 text-[10px] text-zinc-400">
                    <strong className="font-mono text-zinc-200">{op.bills}</strong> bill{op.bills === 1 ? "" : "s"}
                    {op.states > 1 && (
                      <> · <strong className="font-mono text-zinc-200">{op.states}</strong> states</>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 5. Across the country — never let the home-state filter silo
            the user. Alerts + news from everywhere else, lightly styled. */}
      {(nationalAlerts.length > 0 || nationalNews.length > 0) && (
        <section className="mb-8 rounded-lg border border-zinc-800/70 bg-zinc-950/30 p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
            🌎 Across the country
          </h2>
          {nationalAlerts.length > 0 && (
            <>
              <p className="mb-2 text-[11px] font-semibold text-zinc-400">Other-state alerts · last {ALERT_HORIZON}d</p>
              <ul className="mb-3 space-y-1">
                {nationalAlerts.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-[11px]">
                    <span className="mt-0.5 rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                      {a.locality || "FED"}
                    </span>
                    <span className={a.severity === "critical" ? "text-red-300" : "text-amber-200"}>
                      {a.severity === "critical" ? "🚨" : "⚠️"}
                    </span>
                    <Link href={`/alerts/${a.id}`} className="flex-1 text-zinc-200 hover:text-emerald-300">
                      {a.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {nationalNews.length > 0 && (
            <>
              <p className="mb-2 text-[11px] font-semibold text-zinc-400">News from other states · last 36h</p>
              <ul className="space-y-1">
                {nationalNews.map((n) => {
                  const hoursAgo = Math.floor((Date.now() - new Date(n.published_at).getTime()) / 3_600_000);
                  const ago = hoursAgo < 1 ? "just now" : hoursAgo < 24 ? `${hoursAgo}h ago` : `${Math.floor(hoursAgo / 24)}d ago`;
                  return (
                    <li key={n.id} className="flex items-baseline gap-2 text-[11px]">
                      {n.state && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                          {n.state}
                        </span>
                      )}
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="flex-1 text-zinc-200 hover:text-emerald-300">
                        {n.title}
                      </a>
                      <span className="text-[10px] text-zinc-500">{ago}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      <footer className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[10px] text-zinc-500">
        <p>
          <strong className="text-zinc-300">MVP brief.</strong> Live-computed every visit. Push delivery + daily snapshot history coming next — when shipped, you&apos;ll see today&apos;s brief in your phone&apos;s notifications without opening the site.
        </p>
      </footer>
    </div>
  );
}
