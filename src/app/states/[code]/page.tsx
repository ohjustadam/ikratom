import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignUpNudge } from "@/components/SignUpNudge";
import { EnablePushNudge } from "@/components/EnablePushNudge";

export const dynamic = "force-dynamic";

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"D.C.",
  FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",
  IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
  OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",
  SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",
  VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",
  WY:"Wyoming",
};

type Props = { params: Promise<{ code: string }> };

const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";

export async function generateMetadata({ params }: Props) {
  const { code } = await params;
  const codeUpper = code.toUpperCase();
  const stateName = STATE_NAMES[codeUpper];
  if (!stateName) return { title: "State · iKratom" };
  return {
    title: `${stateName} kratom policy — bills, meetings, calls · iKratom`,
    description: `Every kratom-policy event in ${stateName}: bills, hearings, municipal meetings, recent alerts. Take action with one-click calls + emails.`,
    openGraph: {
      title: `${stateName} kratom advocacy hub`,
      description: `Every kratom-policy event in ${stateName} — bills, hearings, municipal meetings, news.`,
      url: `${SITE}/states/${codeUpper}`,
      siteName: "iKratom",
    },
  };
}

/**
 * /states/[code] — single-state aggregated landing page.
 *
 * Pulls everything relevant to a single state in one place:
 *   - Active bills (anti / pro)
 *   - Upcoming approved municipal_meetings (next 90d)
 *   - Recent approved policy_alerts (last 30d)
 *   - Active campaigns
 *   - Link to state briefing
 *   - Calendar / pulse cross-links scoped to this state
 *
 * Designed to be shareable: someone organizing in TX can send
 * https://www.ikratom.org/states/TX to allies and it's a full picture
 * of TX policy state.
 */
export default async function StatePage({ params }: Props) {
  const { code } = await params;
  const codeUpper = code.toUpperCase();
  const stateName = STATE_NAMES[codeUpper];
  if (!stateName) notFound();

  const supabase = await createClient();
  const now = new Date();
  const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const horizon = new Date(now.getTime() + 90 * 86_400_000).toISOString();

  // "Truly active" threshold: last legislative action within the past 12
  // months. Anything older is almost certainly from a closed session and
  // showing it as 'active' is misleading. Owner directive 2026-05-14:
  // 'are all 20 of those active bills under new york truly active bills?
  // there is no telling the difference between what is what.'
  const ACTIVE_WINDOW_DAYS = 365;
  const activeSince = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 86_400_000).toISOString();
  // Past-meeting window: meetings in the last 14 days are still narratively
  // 'live' — the Suffolk County vote happened 2 days ago and is the central
  // active fight in NY right now; showing it on /states/NY is essential.
  const pastMeetingWindow = new Date(now.getTime() - 14 * 86_400_000).toISOString();

  // News window: last 60 days of kratom coverage tagged to this state.
  // Wider window than the 30d alert window because news context can be
  // a few months stale and still valuable for organizing.
  const newsSince = new Date(now.getTime() - 60 * 86_400_000).toISOString();

  const [bills, meetings, pastMeetings, alerts, campaigns, briefing, newsRaw, takebackBill] = await Promise.all([
    supabase
      .from("bills")
      .select("id, bill_number, title, status, kratom_relevance, last_action, last_action_at, scope, locality")
      .eq("state", codeUpper)
      .eq("active", true)
      .in("kratom_relevance", ["anti", "pro"])
      .neq("status", "dead")
      .gte("last_action_at", activeSince)
      .order("last_action_at", { ascending: false, nullsFirst: false })
      .limit(40),
    supabase
      .from("municipal_meetings")
      .select("id, locality, body_name, meeting_at, zoom_url, agenda_url")
      .eq("state", codeUpper)
      .eq("moderation_status", "approved")
      .gte("meeting_at", now.toISOString())
      .lte("meeting_at", horizon)
      .order("meeting_at", { ascending: true })
      .limit(15),
    // Past meetings within last 14 days — important for things like the
    // Suffolk County vote that happened 2 days ago and is the live fight.
    supabase
      .from("municipal_meetings")
      .select("id, locality, body_name, meeting_at, kratom_relevance, agenda_url")
      .eq("state", codeUpper)
      .eq("moderation_status", "approved")
      .eq("kratom_relevance", "confirmed")
      .gte("meeting_at", pastMeetingWindow)
      .lt("meeting_at", now.toISOString())
      .order("meeting_at", { ascending: false })
      .limit(5),
    supabase
      .from("policy_alerts")
      .select("id, kind, severity, title, body, locality, created_at, occurs_at, bill_id, source_url")
      .or(`locality.eq.${codeUpper},locality.ilike.%, ${codeUpper}`)
      .eq("moderation_status", "approved")
      .in("severity", ["critical", "alert"])
      .gte("created_at", since30d)
      .order("created_at", { ascending: false })
      .limit(30),  // larger pull — many drop after real-event-date filter
    supabase
      .from("campaigns")
      .select("id, slug, title, blurb")
      .eq("state", codeUpper)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("state_briefings")
      .select("state, published_at")
      .eq("state", codeUpper)
      .maybeSingle(),
    supabase
      .from("news_items")
      .select("id, title, source_name, url, published_at, summary")
      .eq("state", codeUpper)
      .eq("active", true)
      .gte("published_at", newsSince)
      .order("published_at", { ascending: false })
      .limit(40),
    // Takeback-status check: does this state have curated banned-state
    // intel? If opposition_summary_md is populated for an active enacted
    // (or imminent) state-scope bill, surface the link to its takeback
    // plan from the page header.
    supabase
      .from("bills")
      .select("id, status, bill_number")
      .eq("state", codeUpper)
      .eq("active", true)
      .eq("scope", "state")
      .eq("kratom_relevance", "anti")
      .in("status", ["enacted", "passed_chamber"])
      .not("opposition_summary_md", "is", null)
      .order("status", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  // Real-event-date filter for alerts — match the freshness logic
  // from PRs #199 + #203 so this page doesn't surface 100-day-old
  // news as 'recent alerts' just because the alert row was
  // classified today.
  const rawAlerts = (alerts.data ?? []) as Array<{
    id: string; kind: string; severity: string; title: string; body: string | null;
    locality: string; created_at: string; occurs_at: string | null;
    bill_id: string | null; source_url: string | null;
  }>;
  const alertIds = rawAlerts.map((a) => a.id);
  const newsByAlertId = new Map<string, string>();
  if (alertIds.length > 0) {
    const { data: newsLinks } = await supabase
      .from("news_items")
      .select("policy_alert_id, published_at")
      .in("policy_alert_id", alertIds);
    for (const n of (newsLinks ?? []) as Array<{ policy_alert_id: string; published_at: string }>) {
      if (n.policy_alert_id && !newsByAlertId.has(n.policy_alert_id)) {
        newsByAlertId.set(n.policy_alert_id, n.published_at);
      }
    }
  }
  const billIds = rawAlerts.map((a) => a.bill_id).filter(Boolean) as string[];
  const billLastActionByBillId = new Map<string, string>();
  if (billIds.length > 0) {
    const { data: bs } = await supabase
      .from("bills")
      .select("id, last_action_at")
      .in("id", billIds);
    for (const b of (bs ?? []) as Array<{ id: string; last_action_at: string | null }>) {
      if (b.last_action_at) billLastActionByBillId.set(b.id, b.last_action_at);
    }
  }
  // Dedup news items — News12 affiliates and Newsday echo-posts produce
  // 3-5+ identical-title rows per real story. Strip outlet suffixes then
  // collapse to one entry (keep earliest published as canonical = the
  // originating outlet).
  type NewsItem = {
    id: string; title: string; source_name: string | null; url: string;
    published_at: string | null; summary: string | null;
  };
  const rawNews = (newsRaw.data ?? []) as NewsItem[];
  const normalizeNewsTitle = (t: string) =>
    t.toLowerCase()
     .replace(/\s*[-—|]\s*[a-z0-9 .'’&]+$/i, "")
     .replace(/\s+/g, " ")
     .trim();
  const seenNews = new Map<string, NewsItem>();
  for (const n of rawNews) {
    const key = normalizeNewsTitle(n.title);
    const existing = seenNews.get(key);
    if (!existing) { seenNews.set(key, n); continue; }
    const aT = existing.published_at ? new Date(existing.published_at).getTime() : Infinity;
    const bT = n.published_at ? new Date(n.published_at).getTime() : Infinity;
    if (bT < aT) seenNews.set(key, n);
  }
  const news = [...seenNews.values()]
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, 12);

  const STATE_FRESH_DAYS = 30;
  const STATE_FRESH_MS = STATE_FRESH_DAYS * 86_400_000;
  const freshAlerts = rawAlerts.filter((a) => {
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
    return Date.now() - eventDate.getTime() <= STATE_FRESH_MS;
  }).slice(0, 10);

  // Bucket bills: county/municipal-scope active fights surface FIRST
  // because they're concrete + actionable (a vote is happening soon
  // in your county vs an abstract state-bill-in-committee). State-scope
  // bills are split into "moving recently" (last 90 days) vs "tracked
  // but quiet" so the page doesn't drown a hot local fight under a
  // pile of stale state-scope bills.
  type BillRow = {
    id: string; bill_number: string; title: string | null; status: string | null;
    kratom_relevance: string | null; last_action: string | null; last_action_at: string | null;
    scope: string | null; locality: string | null;
  };
  const allBills = (bills.data ?? []) as BillRow[];
  const RECENT_STATE_DAYS = 90;
  const recentCutoff = Date.now() - RECENT_STATE_DAYS * 86_400_000;
  const localFights = allBills.filter(b => b.scope === "county" || b.scope === "municipal");
  const movingStateBills = allBills.filter(b =>
    b.scope === "state"
    && b.last_action_at != null
    && new Date(b.last_action_at).getTime() >= recentCutoff
  );
  const quietStateBills = allBills.filter(b =>
    b.scope === "state"
    && (b.last_action_at == null || new Date(b.last_action_at).getTime() < recentCutoff)
  );

  const totalSignals = allBills.length
    + (meetings.data?.length ?? 0)
    + (pastMeetings.data?.length ?? 0)
    + freshAlerts.length
    + (campaigns.data?.length ?? 0);

  // Schema.org WebPage with CollectionPage mainEntity — describes this
  // as a state-policy hub for AI summarizers and search engines. The
  // mainEntity carries the actual content classification so AI agents
  // can answer 'what's happening with kratom in TX?' by citing us.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `Kratom policy in ${stateName}`,
    description: `Every active kratom-policy signal we're tracking for ${stateName}: bills, hearings, municipal meetings, alerts, campaigns.`,
    url: `${SITE}/states/${codeUpper}`,
    inLanguage: "en-US",
    isAccessibleForFree: true,
    isPartOf: { "@type": "WebSite", name: "iKratom", url: SITE },
    about: {
      "@type": "AdministrativeArea",
      name: stateName,
      identifier: codeUpper,
      addressCountry: "US",
    },
    mainEntity: {
      "@type": "CollectionPage",
      numberOfItems: totalSignals,
      itemListElement: [
        ...((bills.data ?? []).slice(0, 5).map((b: { id: string; bill_number: string; title: string | null }) => ({
          "@type": "Legislation",
          name: `${codeUpper} ${b.bill_number}`,
          description: b.title?.slice(0, 200),
          url: `${SITE}/bills/${b.id}`,
          legislationJurisdiction: { "@type": "AdministrativeArea", name: stateName },
        }))),
        ...((meetings.data ?? []).slice(0, 5).map((m: { id: string; locality: string | null; body_name: string | null; meeting_at: string }) => ({
          "@type": "Event",
          name: `${m.locality ?? codeUpper} ${m.body_name ?? "meeting"}`,
          startDate: m.meeting_at,
          url: `${SITE}/meetings/${m.id}`,
        }))),
      ],
    },
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Link href="/states" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← All states
      </Link>

      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📍 {codeUpper} · {stateName}
        </p>
        <h1 className="mt-2 text-4xl font-bold">Kratom policy in {stateName}</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every active signal we&apos;re tracking for {stateName}: bills, hearings,
          municipal meetings, recent alerts, and the campaigns where you can
          take one-click action.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {totalSignals === 0 && (
            <span className="rounded border border-amber-700/40 bg-amber-950/15 px-3 py-1 text-amber-300">
              ⚠ No active signals in {codeUpper} right now — quiet is good.
            </span>
          )}
          {briefing.data?.published_at && (
            <Link
              href={`/briefings/state/${codeUpper}`}
              className="rounded border border-emerald-700/40 bg-emerald-950/15 px-3 py-1 text-emerald-300 hover:border-emerald-500"
            >
              📋 Full briefing
            </Link>
          )}
          <Link
            href={`/states/${codeUpper}/briefing`}
            className="rounded border border-emerald-500 bg-emerald-950/20 px-3 py-1 font-semibold text-emerald-300 hover:bg-emerald-950/40"
            data-event="open_state_briefing"
          >
            ◉ Intel briefing
          </Link>
          <Link
            href={`/calendar?state=${codeUpper}`}
            className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 hover:border-emerald-500"
          >
            📅 Calendar
          </Link>
          <Link
            href={`/pulse?state=${codeUpper}`}
            className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 hover:border-emerald-500"
          >
            🚨 Live pulse
          </Link>
          <Link
            href={`/calls?state=${codeUpper}`}
            className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 hover:border-emerald-500"
          >
            📞 Call targets
          </Link>
          <Link
            href={`/calendar/feed.ics?state=${codeUpper}`}
            className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 hover:border-emerald-500"
          >
            🔔 Subscribe to {codeUpper} calendar
          </Link>
        </div>
      </header>

      {/* Takeback intel banner — fires only for the 7 banning states
          (where opposition_summary_md is editorially populated). Surfaces
          the curated repeal plan directly from the state landing so an
          organizer in AL/AR/IN/RI/VT/WI/TN sees it without clicking
          through to /banned first. */}
      {takebackBill?.data && (
        <Link
          href={`/bills/${takebackBill.data.id}`}
          className="mb-6 block rounded-lg border-2 border-amber-700/50 bg-amber-950/15 p-4 hover:border-amber-400"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
              🎯 Takeback plan
            </span>
            <span className="text-[10px] text-zinc-500">
              {takebackBill.data.status === "passed_chamber" ? "imminent ban" : "enacted ban"} · {takebackBill.data.bill_number}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-zinc-100">
            {stateName} has curated repeal intel — who pushed the ban + named legislators + phased action plan
          </p>
          <p className="mt-1 text-[11px] text-amber-300">Open the full plan →</p>
        </Link>
      )}

      {/* Signup nudge — only renders for anonymous visitors. The state
          hub is a high-intent surface (someone deliberately landed on
          /states/TX), so the value prop is concrete: be the first TX
          advocate notified when something happens. */}
      <SignUpNudge context="state" stateCode={codeUpper} className="mb-8" />
      <EnablePushNudge context="state" stateCode={codeUpper} className="mb-8" />

      {/* Active campaigns first — primary CTA */}
      {(campaigns.data ?? []).length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-emerald-300">
            Active campaigns
          </h2>
          <ul className="space-y-2">
            {(campaigns.data ?? []).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/campaigns/${c.slug}`}
                  className="block rounded-md border border-emerald-700/40 bg-emerald-950/15 p-4 hover:border-emerald-500"
                >
                  <p className="font-semibold text-zinc-100">{c.title}</p>
                  {c.blurb && <p className="mt-1 text-sm text-zinc-400">{c.blurb}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Local fights — county/municipal-scope active battles. Pinned at
          the top because they're concrete + actionable (e.g. Suffolk
          County Resolution 1279-2026 currently tabled; users in NY need
          to see this prominently). */}
      {localFights.length > 0 && (
        <section className="mb-8 rounded-lg border-2 border-red-700/40 bg-gradient-to-br from-red-950/20 to-zinc-950/40 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-red-300">
              🚨 Active local fights · {localFights.length}
            </h2>
            <span className="text-[10px] text-zinc-500">county + city ordinances</span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">
            County and city-level kratom-ordinance fights happening in {stateName} right now. These are the moments where a small number of votes decides the outcome.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {localFights.map((b) => {
              const daysAgo = b.last_action_at ? Math.floor((Date.now() - new Date(b.last_action_at).getTime()) / 86_400_000) : null;
              return (
                <li key={b.id}>
                  <Link
                    href={`/bills/${b.id}`}
                    className="block rounded-md border-2 border-red-700/40 bg-zinc-950/60 p-3 hover:border-red-400"
                  >
                    <p className="flex flex-wrap items-baseline gap-2">
                      <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-300">
                        {b.scope}
                      </span>
                      <span className="font-mono text-xs font-bold text-zinc-100">{b.bill_number}</span>
                      {daysAgo != null && (
                        <span className="ml-auto text-[10px] text-zinc-500">{daysAgo}d ago</span>
                      )}
                    </p>
                    {b.locality && (
                      <p className="mt-1 text-xs font-semibold text-zinc-200">{b.locality}</p>
                    )}
                    {b.title && <p className="mt-1 line-clamp-2 text-[11px] text-zinc-400">{b.title}</p>}
                    {b.last_action && (
                      <p className="mt-1 text-[10px] text-zinc-600 line-clamp-1">{b.last_action}</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* State bills MOVING — last 90 days of legislative activity. */}
      {movingStateBills.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-300">
            State bills moving · {movingStateBills.length}
          </h2>
          <p className="mb-3 text-[11px] text-zinc-500">
            State-scope bills with legislative activity in the last 90 days.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {movingStateBills.map((b) => {
              const daysAgo = b.last_action_at ? Math.floor((Date.now() - new Date(b.last_action_at).getTime()) / 86_400_000) : null;
              return (
                <li key={b.id}>
                  <Link
                    href={`/bills/${b.id}`}
                    className={`block rounded-md border p-3 hover:border-emerald-500 ${
                      b.kratom_relevance === "anti"
                        ? "border-red-700/40 bg-red-950/10"
                        : "border-emerald-700/40 bg-emerald-950/10"
                    }`}
                  >
                    <p className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-bold text-zinc-100">{b.bill_number}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        b.kratom_relevance === "anti" ? "bg-red-950/40 text-red-300" : "bg-emerald-950/40 text-emerald-300"
                      }`}>
                        {b.kratom_relevance === "anti" ? "🚫 restrictive" : "✅ supportive"}
                      </span>
                      <span className="ml-auto text-[10px] text-zinc-500">{b.status}{daysAgo != null && ` · ${daysAgo}d`}</span>
                    </p>
                    {b.title && <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{b.title}</p>}
                    {b.last_action && (
                      <p className="mt-1 text-[10px] text-zinc-600">{b.last_action}</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* State bills TRACKED but quiet — collapsed by default so the
          page leads with what's actually moving. */}
      {quietStateBills.length > 0 && (
        <section className="mb-8">
          <details className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
              Tracked but quiet (90+ days no action) · {quietStateBills.length}
            </summary>
            <p className="mt-2 text-[11px] text-zinc-500">
              These bills exist in the {stateName} legislature&apos;s system but haven&apos;t moved in 3+ months. Likely from a closed session or in a holding pattern. Useful context; not urgent.
            </p>
            <ul className="mt-3 grid gap-1 sm:grid-cols-2">
              {quietStateBills.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/bills/${b.id}`}
                    className="block rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px] hover:border-zinc-600"
                  >
                    <span className="font-mono text-zinc-300">{b.bill_number}</span>
                    <span className={`ml-2 rounded px-1 py-0.5 text-[9px] uppercase ${
                      b.kratom_relevance === "anti" ? "text-red-400" : "text-emerald-400"
                    }`}>
                      {b.kratom_relevance}
                    </span>
                    {b.title && <span className="ml-2 text-zinc-500">— {b.title.slice(0, 60)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {/* Recent past meetings (last 14 days, kratom-confirmed). Critical
          for the Suffolk County case: vote happened 2 days ago. The page
          would otherwise miss it entirely (the "next 90 days" filter only
          shows future meetings). */}
      {(pastMeetings.data ?? []).length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-orange-300">
            Just happened · last 14 days
          </h2>
          <ul className="space-y-2">
            {(pastMeetings.data ?? []).map((m: { id: string; locality: string | null; body_name: string | null; meeting_at: string; agenda_url: string | null }) => {
              const when = new Date(m.meeting_at);
              const daysAgo = Math.floor((Date.now() - when.getTime()) / 86_400_000);
              return (
                <li key={m.id}>
                  <Link
                    href={`/meetings/${m.id}`}
                    className="block rounded-md border border-orange-700/40 bg-orange-950/15 p-3 hover:border-orange-500"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="rounded bg-orange-900/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-orange-300">
                        {daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`}
                      </span>
                      <span className="font-semibold text-zinc-100">
                        {m.locality}{m.body_name ? ` · ${m.body_name}` : ""}
                      </span>
                      <span className="ml-auto text-[10px] text-zinc-500">
                        {when.toLocaleString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-zinc-500">
                      Recent local meeting where kratom appeared on the agenda. Click for outcome + follow-up coverage.
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Upcoming meetings */}
      {(meetings.data ?? []).length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-amber-300">
            Upcoming meetings · next 90 days
          </h2>
          <ul className="space-y-2">
            {(meetings.data ?? []).map((m) => {
              const when = new Date(m.meeting_at);
              const days = Math.ceil((when.getTime() - Date.now()) / 86_400_000);
              return (
                <li key={m.id}>
                  <Link
                    href={`/meetings/${m.id}`}
                    className="block rounded-md border border-amber-700/30 bg-amber-950/10 p-3 hover:border-amber-500"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                        in {days}d
                      </span>
                      <span className="font-semibold text-zinc-100">
                        {m.locality}{m.body_name ? ` · ${m.body_name}` : ""}
                      </span>
                      <span className="ml-auto text-[10px] text-zinc-500">
                        {when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Recent alerts */}
      {freshAlerts.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-red-300">
            Recent alerts · last 30 days
          </h2>
          <ul className="space-y-2">
            {freshAlerts.map((a) => {
              const when = new Date(a.created_at);
              const daysAgo = Math.floor((Date.now() - when.getTime()) / 86_400_000);
              return (
                <li key={a.id} className={`rounded-md border p-3 ${
                  a.severity === "critical"
                    ? "border-red-700/40 bg-red-950/10"
                    : "border-amber-700/30 bg-amber-950/10"
                }`}>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xs ${a.severity === "critical" ? "text-red-300" : "text-amber-300"}`}>
                      {a.severity === "critical" ? "🚨" : "⚠️"}
                    </span>
                    <p className="flex-1 text-sm font-semibold text-zinc-100">{a.title}</p>
                    <span className="text-[10px] text-zinc-500">{daysAgo}d ago</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* News coverage in this state — last 60d, deduped across syndicates.
          Same chain logic as /bills/[id] but state-wide rather than bill-
          scoped. Owner directive 2026-05-14: 'we have so much information
          that has context to correlate to each other... putting them
          together and telling their stories.' */}
      {news.length > 0 && (
        <section className="mb-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
              📰 News in {stateName} · {news.length}
            </h2>
            <span className="text-[10px] text-zinc-500">last 60 days, deduped</span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            Every news article we&apos;ve indexed mentioning kratom + {stateName}. Collapsed across syndicates (News12 affiliates, AOL/MSN echoes) to one entry per real story.
          </p>
          <ul className="mt-3 space-y-2">
            {news.map((n) => (
              <li key={n.id}>
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-md border border-zinc-800 bg-zinc-950/60 p-3 hover:border-emerald-500"
                >
                  <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    {n.source_name && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                        {n.source_name}
                      </span>
                    )}
                    {n.published_at && (
                      <span className="text-zinc-500">
                        {new Date(n.published_at).toLocaleDateString()}
                      </span>
                    )}
                    <span className="ml-auto text-emerald-400">read →</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-zinc-100 line-clamp-2">
                    {n.title}
                  </p>
                  {n.summary && (
                    <p className="mt-1 text-[11px] text-zinc-500 line-clamp-2">
                      {n.summary.slice(0, 200)}
                    </p>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-zinc-200">Want to organize in {stateName}?</p>
        <p className="mt-1">
          Sign up, pick &ldquo;{stateName}&rdquo; in your profile, and you&apos;ll get
          push notifications the moment a bill moves, a hearing is announced,
          or a city council puts kratom on the agenda.
          {" "}<Link href="/signup" className="font-semibold text-emerald-400 hover:underline">
            Join iKratom →
          </Link>
        </p>
      </footer>
    </div>
  );
}
