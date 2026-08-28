import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TourTooltip } from "@/modules/tour/TourTooltip";
import { getTourSeen } from "@/modules/tour/actions";
import { BopWatchSummary } from "@/modules/bop/BopWatchSummary";
import { SignUpNudge } from "@/components/SignUpNudge";
import { PageShareWithAttribution } from "@/components/PageShareWithAttribution";
import { EnablePushNudge } from "@/components/EnablePushNudge";
import { frontmatterString } from "@/lib/frontmatter";

import Link from "next/link";
export const metadata = { title: "Pulse — live policy feed" };
// Force dynamic so newly-inserted alerts and breaking events appear on
// next refresh — the alerts table is the live war room and stale page
// caches there hurt advocacy speed.
export const dynamic = "force-dynamic";

type Alert = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  locality: string;
  source_url: string | null;
  campaign_id: string | null;
  occurs_at: string | null;
  expires_at: string | null;
  created_at: string;
  bill_id: string | null;
};
type Campaign = {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  state: string | null;
  active: boolean;
  mobilization_type: string | null;
  ends_at: string | null;
};
type Briefing = { slug: string; title: string; subtitle: string | null; published: string | null };

const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  bill_event:        { label: "Legislation", cls: "bg-emerald-950/40 text-emerald-300 border-emerald-700/40" },
  bop_hearing:       { label: "BoP",         cls: "bg-purple-950/40 text-purple-300 border-purple-700/40" },
  ag_enforcement:    { label: "AG Action",   cls: "bg-amber-950/40 text-amber-300 border-amber-700/40" },
  fda_action:        { label: "FDA",         cls: "bg-amber-950/40 text-amber-300 border-amber-700/40" },
  dea_action:        { label: "DEA",         cls: "bg-red-950/40 text-red-300 border-red-700/40" },
  court_ruling:      { label: "Court",       cls: "bg-blue-950/40 text-blue-300 border-blue-700/40" },
  news_break:        { label: "News",        cls: "bg-zinc-900 text-zinc-300 border-zinc-700" },
  intel_tip:         { label: "Intel tip",   cls: "bg-pink-950/40 text-pink-300 border-pink-700/40" },
  scraper_stale:     { label: "Pipeline",    cls: "bg-zinc-900 text-zinc-500 border-zinc-800" },
  briefing_published: { label: "Briefing",   cls: "bg-emerald-950/40 text-emerald-300 border-emerald-700/40" },
};

const SEV_DOT: Record<string, string> = {
  critical: "bg-red-500 animate-pulse",
  alert: "bg-amber-400",
  watch: "bg-emerald-400",
  routine: "bg-zinc-600",
};

type PulseSnapshot = {
  alerts: Alert[];
  billCommitteeByBillId: Record<string, string>;
  otherCampaigns: Campaign[];
  nationalNews: NewsItem[];
  topStateNews: NewsItem[];
};

/**
 * Shared public snapshot of the pulse feed (5-min revalidate), keyed by the
 * optional ?state= filter (normalized 2-letter code or null). Everyone sees
 * the same alerts / news / campaign list, so these reads are served from one
 * cached snapshot instead of re-hitting the DB on every visit and crawl.
 * COOKIELESS service-role client — unstable_cache can't use the request-bound
 * cookie client. Because service-role bypasses RLS, every query keeps (or
 * adds) the exact filters the public RLS policies enforce: approved-only
 * alerts, active-only news, active-only campaigns. Public-safe columns only.
 */
const getPulseSnapshot = unstable_cache(
  async (stateFilter: string | null): Promise<PulseSnapshot> => {
    const supabase = createServiceRoleClient();

    // Pull alerts. Severity-gated zones (critical / alert / watch). We
    // don't expose 'routine' on the main feed — too noisy.
    // If ?state= is set, scope the locality filter.
    // Freshness gate: ingested in last 30 days (covers the active intel
    // window). Stale alerts past 30d only surface via /alerts/[id]
    // direct URL or /states/[code] archive.
    const since30dIso = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const since14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    let alertsQuery = supabase
      .from("policy_alerts")
      .select("id, kind, severity, title, body, locality, source_url, campaign_id, occurs_at, expires_at, created_at, bill_id")
      .eq("moderation_status", "approved")
      .in("severity", ["critical", "alert", "watch"])
      .gte("created_at", since30dIso);
    if (stateFilter) {
      alertsQuery = alertsQuery.or(`locality.eq.${stateFilter},locality.ilike.%, ${stateFilter}`);
    }

    // Alerts + the two viewer-independent news panels fire concurrently.
    // False-positive defense on news: exclude items whose article-body fetch
    // proved the kratom keyword only existed in a related-stories sidebar
    // (body_has_kratom_keyword = false). Items not yet verified (NULL) are
    // kept visible so we don't blackout fresh news while the verifier
    // worker catches up — fetch failures are NULL too, same treatment.
    // See migration 0103 + scripts/verify-news-body.mjs.
    const [alertsRes, nationalRes, topStateRes] = await Promise.all([
      alertsQuery
        .order("severity", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(60), // larger pull — many drop after real-event-date filter
      supabase
        .from("news_items")
        .select("id, title, url, source_name, state, published_at, ai_relevance_score")
        .eq("active", true)
        .or("state.is.null,policy_event_kind.in.(fda_action,dea_action,federal)")
        .gte("ai_relevance_score", 0.75)
        .gte("published_at", since14d)
        .not("body_has_kratom_keyword", "is", false)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(5),
      supabase
        .from("news_items")
        .select("id, title, url, source_name, state, published_at, ai_relevance_score")
        .eq("active", true)
        .not("state", "is", null)
        .gte("ai_relevance_score", 0.85)
        .gte("published_at", since14d)
        .not("body_has_kratom_keyword", "is", false)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(5),
    ]);
    const allRecentAlerts = (alertsRes.data ?? []) as Alert[];

    // Second-pass: resolve REAL event date per alert (same logic as
    // push-critical-alerts.mjs from PR #199) and bucket into
    //   - 'fresh' (event in last 14d) — shown in critical/alert sections
    //   - 'recent' (14-30d, but fresh ingest) — shown in watch section
    // This stops 'Today's breaking' from displaying 100-day-old news
    // that just got classified today.
    const alertIds = allRecentAlerts.map((a) => a.id);
    const billIdsToFetch = allRecentAlerts.map((a) => a.bill_id).filter(Boolean) as string[];
    const newsByAlertId = new Map<string, string>();   // alert_id → news published_at
    const billLastActionByBillId = new Map<string, string>();
    const billCommitteeByBillId: Record<string, string> = {};

    await Promise.all([
      (async () => {
        if (alertIds.length === 0) return;
        const { data: newsLinks } = await supabase
          .from("news_items")
          .select("policy_alert_id, published_at")
          .in("policy_alert_id", alertIds)
          .eq("active", true)
          .order("published_at", { ascending: false });
        for (const n of (newsLinks ?? []) as Array<{ policy_alert_id: string; published_at: string }>) {
          if (n.policy_alert_id && !newsByAlertId.has(n.policy_alert_id)) {
            newsByAlertId.set(n.policy_alert_id, n.published_at);
          }
        }
      })(),
      (async () => {
        if (billIdsToFetch.length === 0) return;
        // Pull last_action_at (used for event-age bucketing) + current
        // committee assignment (used for the per-viewer "Your rep decides"
        // chip in the page component). Wrapped in try/catch so the page
        // degrades gracefully on pre-migration deploys where
        // current_committee_name doesn't exist as a column yet.
        try {
          const { data: bills } = await supabase
            .from("bills")
            .select("id, last_action_at, current_committee_name")
            .in("id", billIdsToFetch);
          for (const b of (bills ?? []) as Array<{ id: string; last_action_at: string | null; current_committee_name: string | null }>) {
            if (b.last_action_at) billLastActionByBillId.set(b.id, b.last_action_at);
            if (b.current_committee_name) billCommitteeByBillId[b.id] = b.current_committee_name;
          }
        } catch {
          // Pre-migration fallback: query without the new column.
          const { data: bills } = await supabase
            .from("bills")
            .select("id, last_action_at")
            .in("id", billIdsToFetch);
          for (const b of (bills ?? []) as Array<{ id: string; last_action_at: string | null }>) {
            if (b.last_action_at) billLastActionByBillId.set(b.id, b.last_action_at);
          }
        }
      })(),
    ]);

    function resolveEventAgeDays(a: Alert): number {
      let eventDate: Date | null = a.occurs_at ? new Date(a.occurs_at) : null;
      if (!eventDate) {
        const newsPub = newsByAlertId.get(a.id);
        if (newsPub) eventDate = new Date(newsPub);
      }
      if (!eventDate && a.bill_id) {
        const billPub = billLastActionByBillId.get(a.bill_id);
        if (billPub) eventDate = new Date(billPub);
      }
      if (!eventDate) eventDate = new Date(a.created_at);
      return Math.floor((Date.now() - eventDate.getTime()) / 86_400_000);
    }
    const FRESH_DAYS = 14;
    const alerts = allRecentAlerts.filter((a) => resolveEventAgeDays(a) <= FRESH_DAYS);

    // Other active campaigns (bill-driven, hand-built) — top 5 by recency.
    // Active-only filter matches the public RLS view exactly, so this is
    // identical for every viewer and safe to snapshot.
    const alertCampaignIds = alerts.map((a) => a.campaign_id).filter(Boolean) as string[];
    const { data: otherCampaigns } = await supabase
      .from("campaigns")
      .select("id, slug, title, blurb, state, active, mobilization_type, ends_at")
      .eq("active", true)
      .not("id", "in", `(${alertCampaignIds.length ? alertCampaignIds.map((id) => `"${id}"`).join(",") : '""'})`)
      .order("created_at", { ascending: false })
      .limit(5);

    return {
      alerts,
      billCommitteeByBillId,
      otherCampaigns: (otherCampaigns ?? []) as Campaign[],
      nationalNews: (nationalRes.data ?? []) as NewsItem[],
      topStateNews: (topStateRes.data ?? []) as NewsItem[],
    };
  },
  ["pulse-snapshot"],
  { revalidate: 300 },
);

// Viewer's-state news panel, cached per state code (≤51 keys, 5-min
// revalidate). The DATA is public and identical for everyone looking at a
// given state — only the choice of WHICH state is per-viewer (profile or
// ?state=), and that stays in the request path. active=true mirrors the
// public RLS read policy the request-bound client used to get for free.
const getStateNews = unstable_cache(
  async (state: string): Promise<NewsItem[]> => {
    const supabase = createServiceRoleClient();
    const since14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("news_items")
      .select("id, title, url, source_name, state, published_at, ai_relevance_score")
      .eq("active", true)
      .eq("state", state)
      .gte("ai_relevance_score", 0.7)
      .gte("published_at", since14d)
      .not("body_has_kratom_keyword", "is", false)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(5);
    return (data ?? []) as NewsItem[];
  },
  ["pulse-state-news"],
  { revalidate: 300 },
);

export default async function PulsePage({
  searchParams,
}: {
  searchParams?: Promise<{ tip_submitted?: string; state?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const tipSubmitted = sp.tip_submitted === "1";
  // ?state=NY filters the whole page to that state — both alerts (via
  // locality match) and news. Shareable links like /pulse?state=CA
  // give advocates a way to focus on a specific state and send the
  // URL to local organizers.
  const requestedState = sp.state ? sp.state.toUpperCase() : null;
  const isValidState = requestedState && /^[A-Z]{2}$/.test(requestedState);
  const supabase = await createClient();

  // All the viewer-independent reads (alerts pipeline + event-age
  // bucketing, national/top-state news, other active campaigns) come from
  // one shared cached snapshot — see getPulseSnapshot above. Everything
  // keyed on the CURRENT VIEWER (auth, profile, rep leverage, tour state,
  // alert-linked campaign visibility) stays on the request-bound client.
  const stateFilter = isValidState ? requestedState : null;
  const {
    alerts,
    billCommitteeByBillId,
    otherCampaigns,
    nationalNews,
    topStateNews: cachedTopStateNews,
  } = await getPulseSnapshot(stateFilter);

  const critical = alerts.filter((a) => a.severity === "critical");
  const alert = alerts.filter((a) => a.severity === "alert");
  const watch = alerts.filter((a) => a.severity === "watch");

  // myLeverageBillIds is populated AFTER user + viewerProfile resolve
  // (further down). Declared as let so the alert-card render can read
  // it; the value is filled in below.
  const myLeverageBillIds: Set<string> = new Set();

  // Active campaigns linked to alerts (the ones we just auto-generated).
  // Deliberately UNCACHED on the request-bound client: campaign visibility
  // is role-dependent — public RLS only exposes active campaigns, while
  // admins/creators also see in-review ones (that's what renders the
  // "campaign in admin review" badge on alert cards). A shared service-role
  // snapshot would either leak review-state to the public or drop the badge.
  const alertCampaignIds = alerts.map((a) => a.campaign_id).filter(Boolean) as string[];
  const { data: alertCampaigns } = alertCampaignIds.length
    ? await supabase
        .from("campaigns")
        .select("id, slug, title, blurb, state, active, mobilization_type, ends_at")
        .in("id", alertCampaignIds)
    : { data: [] as Campaign[] };

  const { data: { user } } = await supabase.auth.getUser();
  let profileState: string | null = null;
  type ViewerProfile = {
    state: string | null;
    congressional_district: string | null;
    state_senate_district: string | null;
    state_house_district: string | null;
    city: string | null;
    county: string | null;
  };
  let viewerProfile: ViewerProfile | null = null;
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("state, congressional_district, state_senate_district, state_house_district, city, county")
      .eq("id", user.id)
      .single();
    viewerProfile = (prof as unknown) as ViewerProfile | null;
    profileState = viewerProfile?.state ?? null;
  }
  // ?state= overrides profile state for "view a different state" link sharing
  const viewerState: string | null = isValidState ? requestedState : profileState;

  // Cross-reference: which of the alerts are about bills currently
  // sitting in a committee where the viewer has a representative?
  // These get the ⚡ "Your rep decides" chip — the structural-leverage
  // signal the platform exists to surface.
  //
  // Requires: viewer signed in, has profile state, has reps resolved
  // via getUserLegislators, AND those reps have at least one committee
  // assignment matching one of the alert-linked bills'
  // current_committee_name. Empty set when any missing — the chip just
  // doesn't render. Wrapped in try/catch so failures degrade silently.
  if (user && viewerProfile?.state && Object.keys(billCommitteeByBillId).length > 0) {
    try {
      const { getUserLegislators } = await import("@/lib/legislators");
      const { committeesMatch } = await import("@/lib/bill-committee");
      const reps = await getUserLegislators(supabase, viewerProfile);
      if (reps.length > 0) {
        const { data: assignments } = await supabase
          .from("legislator_committees")
          .select("committee_name")
          .in("legislator_id", reps.map((r) => r.id));
        const myCommitteeNames = (assignments ?? []).map(
          (a) => (a as { committee_name: string }).committee_name,
        );
        if (myCommitteeNames.length > 0) {
          for (const [billId, committeeName] of Object.entries(billCommitteeByBillId)) {
            if (myCommitteeNames.some((mc) => committeesMatch(committeeName, mc))) {
              myLeverageBillIds.add(billId);
            }
          }
        }
      }
    } catch {
      // best-effort: chips just won't show
    }
  }

  // First-visit tooltip state — fires once per surface
  const tourSeen = await getTourSeen();
  const seenPulseNews = !!tourSeen["pulse-news"];

  // Most-critical news — national + top-state panels come from the cached
  // snapshot above; the viewer's-state panel is cached per state code (see
  // getStateNews). Same visibility rules as before: localNews only when the
  // viewer has a state, topStateNews only when they don't.
  const localNews = viewerState ? await getStateNews(viewerState) : null;
  const topStateNews = viewerState ? null : cachedTopStateNews;

  // Briefings — auto-discovered from src/content/briefings/
  const briefingsDir = path.join(process.cwd(), "src", "content", "briefings");
  const briefings: Briefing[] = fs.existsSync(briefingsDir)
    ? fs
        .readdirSync(briefingsDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => {
          const { data } = matter(fs.readFileSync(path.join(briefingsDir, f), "utf8"));
          return {
            slug: f.replace(/\.md$/, ""),
            title: frontmatterString(data.title) ?? f,
            subtitle: frontmatterString(data.subtitle),
            published: frontmatterString(data.published),
          };
        })
        .sort((a, b) => (a.published && b.published ? (a.published < b.published ? 1 : -1) : 0))
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      {tipSubmitted && (
        <div className="mb-6 rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-4">
          <p className="text-sm font-semibold text-emerald-300">
            ✓ Thanks — your tip is in the queue
          </p>
          <p className="mt-1 text-xs text-emerald-200/80">
            An admin reviews submitted tips and publishes the verified ones to /pulse.
            You&apos;ll see your tip here once it&apos;s approved.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/alerts/my-tips"
              className="rounded-md border border-emerald-700/50 px-3 py-1 text-xs text-emerald-300 hover:border-emerald-500"
            >
              See my submitted tips →
            </Link>
            <Link
              href="/alerts/submit"
              className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-emerald-500"
            >
              Submit another
            </Link>
          </div>
        </div>
      )}

      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            ◉ live policy feed
          </p>
          <h1 className="mt-2 text-4xl font-bold leading-tight">Pulse</h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Every kratom-policy event the platform is tracking — federal, state,
            board-of-pharmacy, news, and advocate intel — sorted by urgency.
            Action campaigns are linked directly from each alert.
          </p>
          {isValidState && (
            <p className="mt-2 inline-flex items-baseline gap-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 px-3 py-1 text-xs">
              <span className="font-mono font-bold text-emerald-300">{requestedState}</span>
              <span className="text-zinc-300">— filtered to this state only</span>
              <a href="/pulse" className="text-emerald-400 hover:underline">clear filter →</a>
            </p>
          )}
        </div>
        <div className="hidden flex-col items-end gap-2 sm:flex">
          <div className="flex gap-2">
            <a
              href="/calendar"
              className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-emerald-500 hover:text-emerald-300"
            >
              📅 Calendar
            </a>
            <PageShareWithAttribution
              path="/pulse"
              title="iKratom Pulse — live kratom policy feed"
              summary="Every kratom-policy event the platform is tracking, sorted by urgency. Federal, state, BoP, news, advocate intel."
            />
            <Link
              href="/alerts/submit"
              className="rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-500 hover:bg-emerald-950/40"
            >
              + Submit a tip
            </Link>
          </div>
          <span className="text-[10px] font-mono text-zinc-600">
            synced {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC
          </span>
        </div>
      </header>

      <div className="mb-6 flex sm:hidden">
        <Link
          href="/alerts/submit"
          className="block w-full rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-2 text-center text-sm font-semibold text-emerald-300 transition hover:border-emerald-500 hover:bg-emerald-950/40"
        >
          + Submit a tip
        </Link>
      </div>

      {alerts.length === 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
          <p className="text-sm text-zinc-400">No active policy events right now.</p>
          <p className="mt-1 text-xs text-zinc-600">
            New alerts surface here automatically as the news + bill pipeline catches them.
          </p>
        </div>
      )}

      {/* MOST CRITICAL NEWS — condensed view, refreshes every cron tick.
          Two columns: national/federal news on the left, the viewer's
          state on the right (or top-relevance state news if no profile). */}
      <TourTooltip
        surface="pulse-news"
        alreadySeen={seenPulseNews}
        title="📰 Most Critical News"
        body="National + your state's biggest kratom-policy stories, refreshed every hour. National on the left, your state on the right. Click any card to read the full story in a new tab."
        anchorSelector="#pulse-news-section"
      />

      {/* BoP Watch summary — the administrative-path-to-a-ban watch.
          Reads via public RPCs so it works for signed-out users too.
          Empty state is the common case right now (no kratom-related
          BoP activity); shows real findings when they appear. */}
      <div className="mb-6">
        <BopWatchSummary />
      </div>

      {/* Signup nudge for anonymous /pulse viewers — pulse is the
          highest-intent surface (live policy feed); push converts well. */}
      <SignUpNudge
        context="pulse"
        stateCode={requestedState ?? undefined}
        className="mb-6"
      />
      <EnablePushNudge
        context="pulse"
        stateCode={requestedState ?? undefined}
        className="mb-6"
      />

      {((nationalNews?.length ?? 0) > 0 || (localNews?.length ?? 0) > 0 || (topStateNews?.length ?? 0) > 0) && (
        <section id="pulse-news-section" className="mb-8 grid gap-4 lg:grid-cols-2">
          {/* National */}
          {(nationalNews?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-purple-700/40 bg-purple-950/10 p-4">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-purple-300">
                  🇺🇸 National / Federal — most critical
                </h2>
                <Link href="/news?scope=federal" className="text-[10px] text-purple-400 hover:underline">
                  See all →
                </Link>
              </div>
              <NewsList items={nationalNews ?? []} accent="purple" />

            </div>
          )}

          {/* Local (viewer's state) OR top-state if no profile */}
          {((localNews?.length ?? 0) > 0 || (topStateNews?.length ?? 0) > 0) && (
            <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-4">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                  {viewerState
                    ? `📍 ${viewerState} — your state`
                    : "📍 State-level — most critical"}
                </h2>
                <a
                  href={viewerState ? `/news?state=${viewerState}` : "/news"}
                  className="text-[10px] text-emerald-400 hover:underline"
                >
                  See all →
                </a>
              </div>
              <NewsList items={(localNews?.length ?? 0) > 0 ? (localNews ?? []) : (topStateNews ?? [])} accent="emerald" />

              {!viewerState && (
                <p className="mt-3 text-[10px] text-zinc-500">
                  Sign in to see news from your state first.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {critical.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-red-300">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            Today&apos;s breaking
            <span className="text-[10px] font-normal normal-case text-zinc-500">
              · upcoming votes / hearings / urgent decisions
            </span>
          </h2>
          <div className="space-y-3">
            {critical.map((a) => (
              <AlertCard key={a.id} alert={a} campaign={alertCampaigns?.find((c) => c.id === a.campaign_id) as Campaign | undefined} isMyLeverage={!!a.bill_id && myLeverageBillIds.has(a.bill_id)} />
            ))}
          </div>
        </section>
      )}

      {alert.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-amber-300">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
            This week
            <span className="text-[10px] font-normal normal-case text-zinc-500">
              · recent decisions, near-term events
            </span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {alert.map((a) => (
              <AlertCard key={a.id} alert={a} campaign={alertCampaigns?.find((c) => c.id === a.campaign_id) as Campaign | undefined} compact />
            ))}
          </div>
        </section>
      )}

      {(otherCampaigns ?? []).length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-emerald-300">
            Active campaigns
          </h2>
          <ul className="space-y-2">
            {(otherCampaigns ?? []).map((c) => (
              <li key={c.id}>
                <a
                  href={`/campaigns/${c.slug}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 hover:border-emerald-500"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-zinc-100">{c.title}</span>
                    {c.blurb && <span className="ml-2 text-xs text-zinc-500">{c.blurb}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-emerald-400">Open →</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {briefings.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-400">
            Background briefings
          </h2>
          <ul className="space-y-2">
            {briefings.map((b) => (
              <li key={b.slug}>
                <a
                  href={`/briefings/${b.slug}`}
                  className="block rounded-md border border-zinc-800 bg-zinc-950/40 p-3 hover:border-emerald-500"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {b.published && <span className="font-mono text-zinc-500">{b.published}</span>}
                    <span className="font-semibold text-zinc-100">{b.title}</span>
                  </div>
                  {b.subtitle && <p className="mt-1 text-xs text-zinc-500">{b.subtitle}</p>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {watch.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-emerald-400">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            Watch list
            <span className="text-[10px] font-normal normal-case text-zinc-500">
              · ongoing context, monitor
            </span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {watch.map((a) => (
              <AlertCard key={a.id} alert={a} compact isMyLeverage={!!a.bill_id && myLeverageBillIds.has(a.bill_id)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AlertCard({ alert, campaign, compact, isMyLeverage }: { alert: Alert; campaign?: Campaign; compact?: boolean; isMyLeverage?: boolean }) {
  const kindMeta = KIND_BADGE[alert.kind] ?? KIND_BADGE.news_break;
  const sevDot = SEV_DOT[alert.severity] ?? "bg-zinc-600";
  const occursDate = alert.occurs_at ? new Date(alert.occurs_at).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) : null;
  // Always-available "when did this enter the feed" stamp — critical for
  // the watch list where occurs_at is usually null (ongoing context, not
  // a scheduled event). Relative format for recency, absolute past 7d.
  const createdAt = new Date(alert.created_at);
  const ageMs = Date.now() - createdAt.getTime();
  const ageHours = Math.floor(ageMs / 3_600_000);
  const ageDays = Math.floor(ageMs / 86_400_000);
  const createdLabel =
    ageHours < 1 ? "just now" :
    ageHours < 24 ? `${ageHours}h ago` :
    ageDays < 7 ? `${ageDays}d ago` :
    createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const createdAbs = createdAt.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  return (
    <article
      id={`alert-${alert.id}`}
      className={`scroll-mt-20 rounded-lg border p-4 ${
        alert.severity === "critical"
          ? "border-red-700/50 bg-red-950/10"
          : alert.severity === "alert"
          ? "border-amber-700/40 bg-amber-950/10"
          : "border-zinc-800 bg-zinc-950/40"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${sevDot}`} />
        <span className={`rounded border px-2 py-0.5 font-mono uppercase ${kindMeta.cls}`}>
          {kindMeta.label}
        </span>
        {isMyLeverage && (
          <span
            className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950"
            title="Your representative sits on the committee currently deciding this bill — your call carries outsized weight here."
          >
            ⚡ Your rep decides
          </span>
        )}
        <span className="font-mono text-zinc-500">{alert.locality}</span>
        {occursDate && (
          <span className="text-zinc-400" title="When the event occurs">
            📅 {occursDate}
          </span>
        )}
        <span
          className="text-zinc-500"
          title={`Added ${createdAbs}`}
        >
          · added {createdLabel}
        </span>
      </div>
      <h3 className={`font-semibold leading-snug ${compact ? "text-sm" : "text-base"}`}>
        <a href={`/alerts/${alert.id}`} className="hover:text-emerald-400 hover:underline">
          {alert.title}
        </a>
      </h3>
      {!compact && alert.body && (
        <p className="mt-2 line-clamp-3 text-sm text-zinc-400">
          {alert.body.split(/\n+/).find((p) => p.trim().length > 0)?.replace(/^\*\*[^*]+\*\*:?\s*/, "")}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {campaign?.active ? (
          <a
            href={`/campaigns/${campaign.slug}`}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            ⚡ Take action →
          </a>
        ) : campaign ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-700/40 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-300">
            campaign in admin review
          </span>
        ) : null}
        {alert.bill_id && (
          <a
            href={`/bills/${alert.bill_id}`}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
          >
            View bill
          </a>
        )}
        {alert.source_url && (
          <a
            href={alert.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
          >
            Source ↗
          </a>
        )}
      </div>
    </article>
  );
}

type NewsItem = {
  id: string;
  title: string;
  url: string | null;
  source_name: string | null;
  state: string | null;
  published_at: string | null;
  ai_relevance_score: number | null;
};

function NewsList({ items, accent }: { items: NewsItem[]; accent: "purple" | "emerald" }) {
  const accentBorder = accent === "purple" ? "hover:border-purple-500" : "hover:border-emerald-500";
  const scorePill = accent === "purple" ? "bg-purple-950/40 text-purple-300" : "bg-emerald-950/40 text-emerald-300";
  return (
    <ul className="space-y-2">
      {items.map((n) => (
        <li key={n.id}>
          <a
            href={n.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={`block rounded border border-zinc-800 bg-zinc-950/60 p-3 transition ${accentBorder}`}
          >
            <div className="flex items-baseline gap-2">
              {n.state && (
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                  {n.state}
                </span>
              )}
              <p className="flex-1 text-sm font-medium leading-snug text-zinc-100">
                {n.title}
              </p>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
              {n.source_name && <span>{n.source_name}</span>}
              {n.published_at && (
                <span>· {new Date(n.published_at).toLocaleDateString()}</span>
              )}
              {typeof n.ai_relevance_score === "number" && (
                <span className={`ml-auto rounded px-1.5 py-0.5 ${scorePill}`}>
                  {Math.round(n.ai_relevance_score * 100)}% relevant
                </span>
              )}
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
