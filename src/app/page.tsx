import { createClient, getCachedClaims } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { HomeMemorialBand } from "@/components/HomeMemorialBand";
import { HomeLivePulse } from "@/components/HomeLivePulse";
import { StateLegalMap } from "@/components/StateLegalMap";
import { HomeOnboarding } from "@/components/HomeOnboarding";
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
export default async function HomePage() {
  // Branch: signed-in users go straight to their cockpit; the landing below is
  // the signed-OUT pitch — the new-visitor / app-store front door. Cached LOCAL
  // JWT verify (no auth round-trip) — we only need presence here.
  const claims = await getCachedClaims();
  if (claims?.sub) redirect("/dashboard");
  const supabase = await createClient();
  const locale = await readLocale();
  const t = getMessages(locale);
  const isIntl = locale !== "en";

  // Most urgent active campaigns + their bill context (for triage badges)
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, slug, title, blurb, state, target_locality, bill_id, mobilization_type, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(8);

  const billIds = Array.from(
    new Set((campaigns ?? []).map((c) => c.bill_id).filter(Boolean) as string[]),
  );
  const billStanceById = new Map<string, string>();
  if (billIds.length > 0) {
    const { data: bills } = await supabase
      .from("bills")
      .select("id, kratom_relevance")
      .in("id", billIds);
    for (const b of bills ?? []) {
      billStanceById.set((b as { id: string }).id, (b as { kratom_relevance: string | null }).kratom_relevance ?? "");
    }
  }

  // Severity from linked alerts (drives card border tint)
  const ids = (campaigns ?? []).map((c) => c.id);
  const sevByCampaign: Record<string, string> = {};
  const actionCountByCampaign: Record<string, number> = {};
  if (ids.length > 0) {
    const [{ data: alerts }, { data: actionRows }] = await Promise.all([
      supabase.from("policy_alerts")
        .select("campaign_id, severity")
        .in("campaign_id", ids)
        .eq("moderation_status", "approved"),
      supabase.from("campaign_actions").select("campaign_id").in("campaign_id", ids),
    ]);
    for (const a of alerts ?? []) {
      sevByCampaign[(a as { campaign_id: string }).campaign_id] = (a as { severity: string }).severity;
    }
    for (const r of actionRows ?? []) {
      actionCountByCampaign[r.campaign_id] = (actionCountByCampaign[r.campaign_id] ?? 0) + 1;
    }
  }

  // Stories (B's social proof). Hide if none approved.
  const { data: stories } = await supabase
    .from("kratom_stories")
    .select("id, title, body, anonymous, display_name, state, created_at")
    .eq("moderation_status", "approved")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(3);

  const activeCount = campaigns?.length ?? 0;

  // Coverage numbers for the mission stat strip — pulled in parallel
  // with the campaign data above for the same query budget.
  const [
    { count: bannedStateCount },
    { count: activeBillCount },
    { count: imminentBanCount },
    { count: localBanCount },
  ] = await Promise.all([
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
      <section className="border-b border-zinc-800 pb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          ◉ Nonpartisan kratom advocacy · live policy feed
        </p>
        <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
          Kratom policy moves fast.<br/>
          <span className="text-emerald-400">We move faster — together.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-zinc-300">
          Every day, a city council, state legislature, or federal agency
          decides something about kratom. Most advocates don&apos;t hear
          about it until it&apos;s too late. <span className="font-semibold text-zinc-100">iKratom flips that.</span>
        </p>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-zinc-400">
          We track every bill, hearing, and ordinance in the United States,
          surface the ones that affect you, write the letter to your specific
          legislators, and put a one-click send button on it. You decide what
          to say. We make it possible to actually say it.
        </p>

        {/* Mission stat strip — concrete answer to 'what is at stake'.
            Each tile is a link to the page that opens up the underlying
            data, so visitors can click any number to see the rows. */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MissionStat value={bannedStateCount ?? 0} label="States banning kratom" tone="red" href="/banned" />
          <MissionStat value={imminentBanCount ?? 0} label="Imminent state bans" tone={(imminentBanCount ?? 0) > 0 ? "amber" : "neutral"} href="/takeback" />
          <MissionStat value={localBanCount ?? 0} label="County + city bans" tone="red" href="/banned" />
          <MissionStat value={activeBillCount ?? 0} label="Bills tracked this year" tone="emerald" href="/bills" />
        </div>

        {/* CTAs */}
        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/signup"
            className="rounded-md bg-emerald-500 px-5 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Join the network — 90 seconds →
          </Link>
          <Link
            href="/banned"
            className="rounded-md border border-red-700/50 bg-red-950/15 px-5 py-2.5 font-semibold text-red-300 hover:border-red-400"
          >
            🚫 See where it&apos;s banned
          </Link>
          <Link
            href="/takeback"
            className="rounded-md border border-amber-700/50 bg-amber-950/15 px-5 py-2.5 font-semibold text-amber-200 hover:border-amber-400"
          >
            🎯 Takeback plan
          </Link>
          <Link
            href="/pulse"
            className="rounded-md border border-zinc-700 px-5 py-2.5 font-semibold hover:border-emerald-500 hover:text-emerald-400"
          >
            🚨 Live pulse
          </Link>
        </div>
      </section>

      {/* Memorial / tribute-video placeholder (in honor of Scot Rubi) */}
      <HomeMemorialBand />

      {/* Live pulse — proof the platform is awake right now */}
      <HomeLivePulse />

      {/* "Where it stands" — the canonical legal-status map */}
      <StateLegalMap />

      {/* Get set up — dual onboarding + calendar / email / calls explainers */}
      <HomeOnboarding />

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
                    className={`block h-full rounded-lg border p-5 transition ${
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
      <section className="mt-16 border-t border-zinc-800 pt-12">
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
      </section>

      {/* Band 4 — Stories (B: social proof done right). Hide if none. */}
      {(stories?.length ?? 0) > 0 && (
        <section className="mt-16 border-t border-zinc-800 pt-12">
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
                  className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 transition hover:border-emerald-500"
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
        </section>
      )}

      {/* Band 5 — Soft close (B: warm pitch) */}
      <section className="mt-16 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-8 text-center">
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
      </section>
    </div>
  );
}

function Card({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
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
    return <div className={`rounded-md border p-3 text-center ${cls}`}>{inner}</div>;
  }
  return (
    <Link href={href} className={`block rounded-md border p-3 text-center transition ${cls}`}>
      {inner}
    </Link>
  );
}
