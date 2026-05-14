import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  const [bills, meetings, alerts, campaigns, briefing] = await Promise.all([
    supabase
      .from("bills")
      .select("id, bill_number, title, status, kratom_relevance, last_action, last_action_at")
      .eq("state", codeUpper)
      .eq("active", true)
      .in("kratom_relevance", ["anti", "pro"])
      .order("last_action_at", { ascending: false, nullsFirst: false })
      .limit(20),
    supabase
      .from("municipal_meetings")
      .select("id, locality, body_name, meeting_at, zoom_url, agenda_url")
      .eq("state", codeUpper)
      .eq("moderation_status", "approved")
      .gte("meeting_at", now.toISOString())
      .lte("meeting_at", horizon)
      .order("meeting_at", { ascending: true })
      .limit(15),
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

  const totalSignals = (bills.data?.length ?? 0)
    + (meetings.data?.length ?? 0)
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

      {/* Bills */}
      {(bills.data ?? []).length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
            Active bills · {bills.data?.length ?? 0}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(bills.data ?? []).map((b) => (
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
                    <span className="font-mono text-sm font-bold text-zinc-100">
                      {b.bill_number}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      b.kratom_relevance === "anti"
                        ? "bg-red-950/40 text-red-300"
                        : "bg-emerald-950/40 text-emerald-300"
                    }`}>
                      {b.kratom_relevance === "anti" ? "🚫 restrictive" : "✅ supportive"}
                    </span>
                    <span className="ml-auto text-[10px] text-zinc-500">{b.status}</span>
                  </p>
                  {b.title && <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{b.title}</p>}
                  {b.last_action && (
                    <p className="mt-1 text-[10px] text-zinc-600">{b.last_action}</p>
                  )}
                </Link>
              </li>
            ))}
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
