import { unstable_cache } from "next/cache";
import { getCachedClaims } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import Link from "next/link";
import { HomeMemorialBand } from "@/components/HomeMemorialBand";
import { HomeLivePulse } from "@/components/HomeLivePulse";
import { StateLegalMap } from "@/components/StateLegalMap";
import { HomeOnboarding } from "@/components/HomeOnboarding";
import { Reveal } from "@/components/motion/Reveal";
import { readLocale } from "@/modules/auth/actions-locale";
import { getMessages } from "@/i18n/messages";

export const dynamic = "force-dynamic";

/**
 * Home page — hybrid of the C ("action-first") + B ("recruitment / personal")
 * directions. Promoted from /home-c after owner pick.
 *
 * The page is split into 5 bands by intent:
 *
 *   1. Hero (C voice). "Pick one. Send it in two minutes." + live action
 *      count. Visitor sees what to do within the first viewport.
 *   2. Campaign grid (C). Active campaigns front and center, sev-tinted
 *      borders for triage. Empty state explains why we're quiet, not
 *      "we have no users."
 *   3. What you actually get (B). Three concrete cards naming the
 *      three product capabilities advocates care about — letters,
 *      intel, community — in plain language.
 *   4. Stories (B). When approved kratom_stories exist, surface 3.
 *      Hand-written, hides if none. Social proof done right.
 *   5. Soft close (B). "We don't need a million people. We need the
 *      right ones — paying attention." Free, nonpartisan, no org politics.
 *
 * Other home variants (/home-a war-room, /home-b recruitment, /home-c
 * action-first) remain accessible for A/B comparison and as design refs.
 */
/**
 * All the public landing-page data, snapshotted across visitors (5-min
 * revalidate). Same pattern as /status + /states: a COOKIELESS service-role
 * client inside unstable_cache, returning only public-safe data — active
 * campaigns, approved stories, aggregate counts. This is the page every
 * anonymous visitor + app-store reviewer hits first; it used to run ~8 live
 * Supabase round-trips per visit (the "slower over time" root cause).
 *
 * Service-role bonus: campaign_actions is RLS'd to self-read, so the old
 * cookie-client per-campaign action counts silently showed only the VIEWER'S
 * own sends (0 for anon). Aggregate counts across all users are public-safe
 * and now correct.
 */
type HomeCampaign = {
  id: string; slug: string; title: string; blurb: string | null; state: string | null;
  target_locality: string | null; bill_id: string | null; mobilization_type: string | null; created_at: string;
};
type HomeStory = {
  id: string; title: string | null; body: string; anonymous: boolean;
  display_name: string | null; state: string | null; created_at: string;
};
type HomeData = {
  campaigns: HomeCampaign[];
  billStance: Record<string, string>;
  sevByCampaign: Record<string, string>;
  actionCountByCampaign: Record<string, number>;
  stories: HomeStory[];
  bannedStateCount: number;
  activeBillCount: number;
  imminentBanCount: number;
  localBanCount: number;
};

const getHomeData = unstable_cache(
  async (): Promise<HomeData> => {
    const supabase = createServiceRoleClient();

    // Campaign-independent reads fire concurrently with the campaign chain.
    const [campaignsRes, storiesRes, ...countRes] = await Promise.all([
      supabase
        .from("campaigns")
        .select("id, slug, title, blurb, state, target_locality, bill_id, mobilization_type, created_at")
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("kratom_stories")
        .select("id, title, body, anonymous, display_name, state, created_at")
        .eq("moderation_status", "approved")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase.from("bills").select("state", { count: "exact", head: true })
        .eq("kratom_relevance", "anti").eq("active", true).eq("scope", "state")
        .eq("status", "enacted").not("opposition_summary_md", "is", null),
      supabase.from("bills").select("id", { count: "exact", head: true })
        .eq("active", true).in("kratom_relevance", ["anti", "pro"])
        .gte("last_action_at", new Date(Date.now() - 365 * 86_400_000).toISOString()),
      supabase.from("bills").select("id", { count: "exact", head: true })
        .eq("kratom_relevance", "anti").eq("active", true).eq("scope", "state")
        .eq("status", "passed_chamber"),
      supabase.from("bills").select("id", { count: "exact", head: true })
        .eq("kratom_relevance", "anti").eq("active", true).eq("status", "enacted")
        .in("scope", ["county", "municipal"]),
    ]);

    const campaigns = (campaignsRes.data ?? []) as HomeCampaign[];
    const billIds = Array.from(new Set(campaigns.map((c) => c.bill_id).filter(Boolean) as string[]));
    const ids = campaigns.map((c) => c.id);

    // Campaign-dependent context (bill stance for triage badges, severity from
    // linked alerts, per-campaign action counts) — one parallel hop.
    const [billsRes, alertsRes, actionsRes] = await Promise.all([
      billIds.length > 0
        ? supabase.from("bills").select("id, kratom_relevance").in("id", billIds)
        : Promise.resolve({ data: [] as { id: string; kratom_relevance: string | null }[] }),
      ids.length > 0
        ? supabase.from("policy_alerts").select("campaign_id, severity").in("campaign_id", ids).eq("moderation_status", "approved")
        : Promise.resolve({ data: [] as { campaign_id: string; severity: string }[] }),
      ids.length > 0
        ? supabase.from("campaign_actions").select("campaign_id").in("campaign_id", ids)
        : Promise.resolve({ data: [] as { campaign_id: string }[] }),
    ]);

    const billStance: Record<string, string> = {};
    for (const b of billsRes.data ?? []) billStance[b.id] = b.kratom_relevance ?? "";
    const sevByCampaign: Record<string, string> = {};
    for (const a of alertsRes.data ?? []) sevByCampaign[a.campaign_id] = a.severity;
    const actionCountByCampaign: Record<string, number> = {};
    for (const r of actionsRes.data ?? []) {
      actionCountByCampaign[r.campaign_id] = (actionCountByCampaign[r.campaign_id] ?? 0) + 1;
    }

    return {
      campaigns,
      billStance,
      sevByCampaign,
      actionCountByCampaign,
      stories: (storiesRes.data ?? []) as HomeStory[],
      bannedStateCount: countRes[0]?.count ?? 0,
      activeBillCount: countRes[1]?.count ?? 0,
      imminentBanCount: countRes[2]?.count ?? 0,
      localBanCount: countRes[3]?.count ?? 0,
    };
  },
  ["home-public-data"],
  { revalidate: 300 },
);

export default async function HomePage() {
  // Branch: signed-in users go straight to their cockpit; the landing below is
  // the signed-OUT pitch — the new-visitor / app-store front door. Cached LOCAL
  // JWT verify (no auth round-trip) — we only need presence here.
  const claims = await getCachedClaims();
  // Signed-in members can still browse the home page — no perma-redirect to the
  // dashboard. We just swap the signup CTAs for a dashboard link below.
  const isSignedIn = !!claims?.sub;
  const locale = await readLocale();
  const t = getMessages(locale);
  const isIntl = locale !== "en";

  // One cached snapshot instead of ~8 live queries per visit. Per-request
  // work above stays request-scoped (auth presence + locale only).
  const {
    campaigns, billStance, sevByCampaign, actionCountByCampaign, stories,
    bannedStateCount, activeBillCount, imminentBanCount, localBanCount,
  } = await getHomeData();
  const billStanceById = new Map(Object.entries(billStance));

  const activeCount = campaigns.length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      {/* International callout — only shows for non-English locales */}
      {isIntl && (
        <div className="mb-6 rounded-lg border border-amber-700/40 bg-amber-950/20 p-4 text-center text-sm text-amber-100">
          🌏 {t.intl.farmerCallout}
        </div>
      )}

      {/* Band 1 — Hero. Owner directive 2026-05-14: 'we need to get the
          message across clearly and broadly what we are here to do and
          that we will accomplish our mission together.' Lead with the
          mission, follow with the live signal, end with the call to act. */}
      <section className="relative overflow-hidden border-b border-zinc-800 pb-8">
        {/* Decorative drifting accent glow behind the hero (reduced-motion aware). */}
        <div className="ik-aurora" aria-hidden />
        <div className="relative z-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          ◉ {t.hero.eyebrow}
        </p>
        <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
          {t.hero.headlineTop}<br/>
          <span className="text-emerald-400">{t.hero.headlineAccent}</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-zinc-300">
          {t.hero.lead} <span className="font-semibold text-zinc-100">{t.hero.leadFlip}</span>
        </p>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-zinc-400">
          {t.hero.sub}
        </p>

        {/* Mission stat strip — concrete answer to 'what is at stake'.
            Each tile is a link to the page that opens up the underlying
            data, so visitors can click any number to see the rows. */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MissionStat value={bannedStateCount ?? 0} label={t.hero.statBannedStates} tone="red" href="/banned" />
          <MissionStat value={imminentBanCount ?? 0} label={t.hero.statImminent} tone={(imminentBanCount ?? 0) > 0 ? "amber" : "neutral"} href="/takeback" />
          <MissionStat value={localBanCount ?? 0} label={t.hero.statLocalBans} tone="red" href="/banned" />
          <MissionStat value={activeBillCount ?? 0} label={t.hero.statBillsTracked} tone="emerald" href="/bills" />
        </div>

        {/* CTAs */}
        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={isSignedIn ? "/dashboard" : "/signup"}
            className="rounded-md bg-emerald-500 px-5 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            {isSignedIn ? t.hero.ctaDashboard : t.hero.ctaJoin}
          </Link>
          <Link
            href="/banned"
            className="rounded-md border border-red-700/50 bg-red-950/15 px-5 py-2.5 font-semibold text-red-300 hover:border-red-400"
          >
            🚫 {t.hero.ctaBanned}
          </Link>
          <Link
            href="/takeback"
            className="rounded-md border border-amber-700/50 bg-amber-950/15 px-5 py-2.5 font-semibold text-amber-200 hover:border-amber-400"
          >
            🎯 {t.hero.ctaTakeback}
          </Link>
          <Link
            href="/pulse"
            className="rounded-md border border-zinc-700 px-5 py-2.5 font-semibold hover:border-emerald-500 hover:text-emerald-400"
          >
            🚨 {t.hero.ctaPulse}
          </Link>
        </div>
        </div>
      </section>

      {/* Memorial / tribute-video placeholder (in honor of Scot Rubi) */}
      <HomeMemorialBand />

      {/* Live pulse — proof the platform is awake right now */}
      <HomeLivePulse />

      {/* "Where it stands" — the canonical legal-status map */}
      <StateLegalMap />

      {/* Get set up — dual onboarding (signed-out only; members are already in) */}
      {!isSignedIn && <HomeOnboarding />}

      {/* Band 1.5 — Active actions header */}
      <section className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          ◉ {activeCount} active action{activeCount === 1 ? "" : "s"} right now
        </p>
        <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
          Pick one. <span className="text-zinc-400">Send it in two minutes.</span>
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every card is a real bill or rule-change moving in your jurisdiction. We
          wrote the letter, found your reps, built the one-click flow. You read,
          edit, send.
        </p>
      </section>

      {/* Band 2 — Campaigns front and center (C) */}
      <section className="mt-6">
        {activeCount === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-10 text-center">
            <p className="text-3xl">📭</p>
            <p className="mt-3 text-sm text-zinc-400">
              No active campaigns right now — that&apos;s the goal, actually. The
              site stays quiet when nothing&apos;s happening; it lights up the
              moment something does.
            </p>
            <Link
              href="/signup"
              className="mt-5 inline-block rounded-md bg-emerald-500 px-5 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              Get notified when something hits →
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {(campaigns ?? []).map((c) => {
              const sev = sevByCampaign[c.id];
              const stance = c.bill_id ? billStanceById.get(c.bill_id) : null;
              const acts = actionCountByCampaign[c.id] ?? 0;
              return (
                <li key={c.id}>
                  <Link
                    href={`/campaigns/${c.slug}`}
                    className={`ik-lift block h-full rounded-xl border p-5 ${
                      sev === "critical"
                        ? "border-red-700/50 bg-red-950/15 hover:border-red-500"
                        : sev === "alert"
                        ? "border-amber-700/40 bg-amber-950/10 hover:border-amber-500"
                        : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {c.state ? (
                        <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs font-bold text-zinc-200">
                          {c.state}
                        </span>
                      ) : (
                        <span className="rounded bg-purple-950/40 px-2 py-0.5 text-xs font-bold text-purple-300">
                          Federal
                        </span>
                      )}
                      {stance === "anti" && (
                        <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-300">
                          🚫 Restrictive
                        </span>
                      )}
                      {stance === "pro" && (
                        <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                          ✅ Supportive
                        </span>
                      )}
                      {sev === "critical" && (
                        <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-950 animate-pulse">
                          critical
                        </span>
                      )}
                      {acts > 0 && (
                        <span className="ml-auto text-[11px] text-zinc-500">
                          {acts.toLocaleString()} sent
                        </span>
                      )}
                    </div>
                    <h2 className="mt-3 font-semibold leading-snug">{c.title}</h2>
                    {c.blurb && (
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{c.blurb}</p>
                    )}
                    {c.target_locality && (
                      <p className="mt-2 text-[11px] text-zinc-500">📍 {c.target_locality}</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-6 text-center">
          <Link href="/campaigns" className="text-sm text-emerald-400 hover:underline">
            See all campaigns →
          </Link>
        </div>
      </section>

      {/* Band 3 — What you actually get (B voice: concrete) */}
      <Reveal as="section" className="mt-16 border-t border-zinc-800 pt-12">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            What you get when you sign up
          </p>
          <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
            Three things that turn hours into minutes.
          </h2>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Card
            icon="📨"
            title="One-click letters"
            body="Real bill comes up — we draft the email to your specific reps, prefilled with your address and any story you want to share. You read, edit, send. Two minutes."
          />
          <Card
            icon="🛰️"
            title="Field intel that finds you"
            body="When a city council in your state schedules a kratom vote, you find out the same hour. Push notifications, weekly digest, or both — your call."
          />
          <Card
            icon="🤝"
            title="Your people are here"
            body="State forums, topical communities (Veterans, Shop owners, Caregivers), and a chat room that's actually populated. Quiet some days, urgent others."
          />
        </div>
      </Reveal>

      {/* Band 4 — Stories (B: social proof done right). Hide if none. */}
      {(stories?.length ?? 0) > 0 && (
        <Reveal as="section" className="mt-16 border-t border-zinc-800 pt-12">
          <div className="text-center">
            <h2 className="text-2xl font-bold">Real stories from advocates</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Hand-written. Not synthesized. We don&apos;t do AI hype here.
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {(stories ?? []).map((s) => {
              const author = s.anonymous ? "An iKratom advocate" : (s.display_name ?? "An advocate");
              return (
                <Link
                  key={s.id}
                  href="/stories"
                  className="ik-card block rounded-xl border border-zinc-800 bg-zinc-950/40 p-5 hover:border-emerald-500"
                >
                  <p className="text-xs uppercase tracking-wider text-emerald-400">
                    {author}{s.state ? ` · ${s.state}` : ""}
                  </p>
                  <h3 className="mt-2 font-semibold leading-tight">{s.title}</h3>
                  <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-zinc-400">
                    &ldquo;{s.body}&rdquo;
                  </p>
                  <p className="mt-3 text-[11px] text-emerald-400">Read more →</p>
                </Link>
              );
            })}
          </div>
          <div className="mt-6 text-center">
            <Link href="/stories" className="text-sm text-emerald-400 hover:underline">
              All stories →
            </Link>
          </div>
        </Reveal>
      )}

      {/* Band 5 — Soft close (B: warm pitch) */}
      <Reveal as="section" className="mt-16 rounded-2xl border border-emerald-700/40 bg-emerald-950/15 p-8 text-center">
        <p className="text-2xl font-bold leading-snug">
          We don&apos;t need a million people.<br/>
          We need the right ones — paying attention.
        </p>
        <p className="mx-auto mt-4 max-w-xl text-sm text-zinc-300">
          Free forever. Nonpartisan. No org politics. Built by an advocate, for advocates.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Sign up — takes 90 seconds →
          </Link>
          <Link
            href="/how-it-works"
            className="rounded-md border border-zinc-700 px-6 py-3 font-semibold hover:border-emerald-500 hover:text-emerald-400"
          >
            How it works
          </Link>
          <Link
            href="/pulse"
            className="rounded-md border border-zinc-700 px-6 py-3 font-semibold hover:border-emerald-500 hover:text-emerald-400"
          >
            Live policy feed
          </Link>
        </div>
      </Reveal>
    </div>
  );
}

function Card({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="ik-card rounded-xl border border-zinc-800 bg-zinc-950/40 p-6">
      <p className="text-3xl">{icon}</p>
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}

function MissionStat({ value, label, tone, href }: {
  value: number;
  label: string;
  tone: "red" | "amber" | "emerald" | "neutral";
  href?: string;
}) {
  const cls =
    tone === "red"     ? "border-red-700/50 bg-red-950/20 text-red-200 hover:border-red-400" :
    tone === "amber"   ? "border-amber-700/50 bg-amber-950/20 text-amber-200 hover:border-amber-400" :
    tone === "emerald" ? "border-emerald-700/40 bg-emerald-950/15 text-emerald-200 hover:border-emerald-400" :
                         "border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-emerald-500";
  const inner = (
    <>
      <p className="text-3xl font-bold tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider opacity-80">{label}</p>
    </>
  );
  if (!href) {
    return <div className={`rounded-xl border p-3 text-center ${cls}`}>{inner}</div>;
  }
  return (
    <Link href={href} className={`ik-lift block rounded-xl border p-3 text-center ${cls}`}>
      {inner}
    </Link>
  );
}
