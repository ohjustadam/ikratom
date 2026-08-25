import { getProfile } from "@/modules/auth/actions";
import { createClient, getCachedUser } from "@/lib/supabase/server";
import { getUserLegislators } from "@/lib/legislators";
import { MyRepCard } from "./MyRepCard";
import { StreakBadge } from "@/components/StreakBadge";
import { getCockpitLayout } from "@/modules/dashboard/actions";
import { CockpitCustomizer } from "@/modules/dashboard/CockpitCustomizer";
import { ReplayTourButton } from "@/modules/dashboard/ReplayTourButton";
import { RetryDistrictsButton } from "@/components/RetryDistrictsButton";
import { OnboardingTour } from "@/modules/dashboard/OnboardingTour";
import { TutorialReplay, WelcomeReplayTour } from "@/modules/dashboard/TutorialReplay";
import { WelcomeExploreWidget } from "@/modules/dashboard/widgets/WelcomeExploreWidget";
import { BriefingWidget } from "@/modules/dashboard/widgets/BriefingWidget";
import { MyDistrictWidget } from "@/modules/dashboard/widgets/MyDistrictWidget";
import { LocalLawWidget } from "@/modules/dashboard/widgets/LocalLawWidget";
import { normalizeLocality } from "@/lib/locality";
import { ActiveCampaignsWidget } from "@/modules/dashboard/widgets/ActiveCampaignsWidget";
import { RepCoverageWidget } from "@/modules/dashboard/widgets/RepCoverageWidget";
import { ScoreboardWidget } from "@/modules/dashboard/widgets/ScoreboardWidget";
import { MyBattlesWidget } from "@/modules/dashboard/widgets/MyBattlesWidget";
import { MyCommitteeBillsWidget } from "@/modules/dashboard/widgets/MyCommitteeBillsWidget";
import { SavedSearchesWidget } from "@/modules/dashboard/widgets/SavedSearchesWidget";
import { ActivityRadarWidget } from "@/modules/dashboard/widgets/ActivityRadarWidget";
import { BadgesWidget } from "@/modules/dashboard/widgets/BadgesWidget";
import { WhatsNewWidget } from "@/modules/dashboard/widgets/WhatsNewWidget";
import { BopWatchSummary } from "@/modules/bop/BopWatchSummary";
import { InviteWidget } from "@/modules/dashboard/widgets/InviteWidget";
import { PolicyPulseWidget } from "@/modules/dashboard/widgets/PolicyPulseWidget";
import { PushOptInBanner } from "@/components/PushOptInBanner";
import { listMyPushSubscriptions } from "@/modules/auth/actions-push";
import type { WidgetId } from "@/modules/dashboard/widgets/types";

import Link from "next/link";
/**
 * /dashboard — the cockpit.
 *
 * Renders widgets in the order saved in user_dashboard_layouts. New
 * users see the default order from widgets/types.ts and the onboarding
 * tour fires automatically on first paint. Each widget is rendered
 * server-side then assembled in the saved order.
 *
 * Customize button (top-right) opens a panel to reorder + show/hide.
 * Replay tour button (in /account) resets onboarded_at so the tour
 * fires again next visit.
 */
export const metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ replay?: string }>;
}) {
  const { profile, email } = await getProfile();
  const layout = await getCockpitLayout();
  const replay = (await searchParams)?.replay ?? null;

  // For the push opt-in banner — server-side detect whether this user
  // has any push subscription. Banner hides itself when they do.
  const pushSubs = await listMyPushSubscriptions();

  // Streak fields (fetched separately since getProfile doesn't include them)
  const streak = {
    current: (profile as { action_streak_days?: number } | null)?.action_streak_days ?? 0,
    longest: (profile as { longest_streak_days?: number } | null)?.longest_streak_days ?? 0,
    lastActionDate: (profile as { last_action_date?: string | null } | null)?.last_action_date ?? null,
  };
  const profileComplete = !!(profile?.full_name && profile?.state && profile?.zip);
  const districtsResolved = !!(
    profile?.congressional_district ||
    profile?.state_senate_district ||
    profile?.state_house_district
  );

  // My reps — only fetched if state set (otherwise we'd return 50 random rows)
  let myReps: Awaited<ReturnType<typeof getUserLegislators>> = [];
  let userId: string | null = null;
  const supabaseForReps = await createClient();
  const userForReps = await getCachedUser();
  userId = userForReps?.id ?? null;
  if (userId && profile?.state) {
    myReps = await getUserLegislators(supabaseForReps, profile);
  }

  // Pre-fetch stance per rep so MyRepCard can render a stance chip
  // at the dashboard level without a per-card client fetch. Single
  // batch query; map by legislator_id.
  const stanceByRepId = new Map<string, string>();
  if (myReps.length > 0) {
    const { data: stances } = await supabaseForReps
      .from("legislator_stance")
      .select("legislator_id, stance")
      .eq("topic", "kratom")
      .in("legislator_id", myReps.map((r) => r.id));
    for (const s of (stances ?? []) as Array<{ legislator_id: string; stance: string }>) {
      stanceByRepId.set(s.legislator_id, s.stance);
    }
  }

  // Layout-driven widget render. Each visible widget is rendered as a
  // server component; the rest of /dashboard's static content stays
  // separate (header, banners) since those aren't widgets users would
  // hide.
  const visibleWidgets = (layout?.widgets ?? []).filter((w) => w.visible);
  const widgetNodes: Record<WidgetId, React.ReactNode> = {
    briefing: userId ? (
      <div data-tour="briefing">
        <BriefingWidget userId={userId} userState={profile?.state ?? null} />
      </div>
    ) : null,
    streak: streak.current > 0 || streak.longest > 0 ? (
      <div data-tour="streak">
        <StreakBadge
          current={streak.current}
          longest={streak.longest}
          lastActionDate={streak.lastActionDate}
        />
      </div>
    ) : null,
    profile_completion: !profileComplete ? (
      <Banner
        tone="amber"
        title="Finish your profile to unlock one-click actions"
        body="We need your name, state, and ZIP to autofill emails to your legislators."
        cta={{ href: "/account", label: "Complete profile →" }}
      />
    ) : !districtsResolved ? (
      profile?.street ? (
        // Address IS on file — Census just didn't have it indexed.
        // Show a retry button + manual-find link instead of misleadingly
        // telling the user to add an address they already added.
        <Banner
          tone="amber"
          title="We couldn't auto-detect your district"
          body="Your address is on file, but the US Census Bureau's address index doesn't cover every street. Retry the lookup, or find your reps manually."
          slot={<RetryDistrictsButton userState={profile?.state ?? null} />}
        />
      ) : (
        <Banner
          tone="amber"
          title="We couldn't auto-detect your districts"
          body="Add your full street address so we can match you to your specific U.S. House and state legislative districts."
          cta={{ href: "/account", label: "Update address →" }}
        />
      )
    ) : null,
    my_district: profile?.state ? (
      <MyDistrictWidget
        userState={profile.state}
        userLocality={normalizeLocality(profile.city ?? null, profile.state)}
      />
    ) : null,
    local_law: (
      <LocalLawWidget
        userState={profile?.state ?? null}
        userCity={profile?.city ?? null}
        userCounty={profile?.county ?? null}
      />
    ),
    active_campaigns: (
      <ActiveCampaignsWidget userState={profile?.state ?? null} />
    ),
    rep_coverage: (
      <RepCoverageWidget
        userState={profile?.state ?? null}
        userCity={profile?.city ?? null}
        userCounty={profile?.county ?? null}
      />
    ),
    scoreboard: userId ? (
      <ScoreboardWidget userId={userId} streak={streak} />
    ) : null,
    my_battles: userId ? (
      <MyBattlesWidget userId={userId} />
    ) : null,
    my_committee_bills: userId ? (
      <MyCommitteeBillsWidget userId={userId} />
    ) : null,
    saved_searches: userId ? <SavedSearchesWidget /> : null,
    activity_radar: <ActivityRadarWidget />,
    policy_pulse: <PolicyPulseWidget userState={profile?.state ?? null} />,
    badges: userId ? <BadgesWidget /> : null,
    whats_new: userId ? <WhatsNewWidget /> : null,
    welcome_explore: userId ? <WelcomeExploreWidget userId={userId} /> : null,
    bop_watch: <BopWatchSummary state={profile?.state ?? undefined} compact />,
    invite: userId ? <InviteWidget /> : null,
    my_reps:
      myReps.length > 0 ? (
        (() => {
          // Group by scope for visual clarity. Federal → State → Local.
          const scopeOf = (r: typeof myReps[number]): "federal" | "state" | "local" => {
            if (r.level === "municipal" || r.level === "county") return "local";
            if (r.role.startsWith("us_") || r.level === "federal") return "federal";
            return "state";
          };
          const groups = { federal: [] as typeof myReps, state: [] as typeof myReps, local: [] as typeof myReps };
          for (const r of myReps) groups[scopeOf(r)].push(r);
          const groupMeta = [
            { id: "federal", title: "Federal", reps: groups.federal },
            { id: "state", title: "State", reps: groups.state },
            { id: "local", title: "Local", reps: groups.local },
          ].filter((g) => g.reps.length > 0);

          return (
            <section data-tour="my-reps">
              <div className="mb-3 flex items-end justify-between">
                <h2 className="text-lg font-semibold">Your representatives</h2>
                <Link href="/legislators" className="text-xs text-emerald-400 hover:underline">
                  See all in {profile?.state} →
                </Link>
              </div>
              <div className="space-y-4">
                {groupMeta.map((g) => (
                  <div key={g.id}>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      {g.title} ({g.reps.length})
                    </p>
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {g.reps.map((l) => (
                        <MyRepCard
                          key={l.id}
                          legislator={l}
                          stance={(stanceByRepId.get(l.id) as Parameters<typeof MyRepCard>[0]["stance"]) ?? null}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          );
        })()
      ) : null,
  };

  const isFirstVisit = !!profile && layout?.onboarded_at === null;
  const leaderTourPending =
    !!(profile as { leader_tour_pending?: boolean } | null)?.leader_tour_pending;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            War room
          </p>
          <h1 className="mt-2 text-3xl font-bold">
            Welcome back, {profile?.full_name || email}.
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Your toolbelt. One click per action.
          </p>
        </div>
        {layout && (
          <div className="shrink-0 flex items-center gap-2">
            <ReplayTourButton />
            <CockpitCustomizer
              initialLayout={layout.widgets}
              initialAccent={layout.accent_color}
            />
          </div>
        )}
      </header>

      {/* Push opt-in nudge for existing users who never saw the new
          onboarding push step. Banner hides itself when the user has
          push enabled, dismisses it, or runs an unsupported browser. */}
      <PushOptInBanner
        hasSubscriptions={pushSubs.length > 0}
        vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        userState={profile?.state ?? null}
      />

      {/* Render widgets in saved order. Falsey nodes (e.g. profile
          banner when profile is complete) silently render nothing. */}
      <div className="mt-6 space-y-6">
        {visibleWidgets.map((slot) => {
          const node = widgetNodes[slot.id];
          if (!node) return null;
          return <div key={slot.id}>{node}</div>;
        })}
      </div>

      {/* Bottom action grid — quick links to deeper sections. Not a
          customizable widget for now; treated as cockpit chrome. */}
      <section className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card href="/campaigns" title="Active campaigns" body="Take action on bills moving right now." accent />
        <Card href="/legislators" title="All legislators" body={profile?.state ? `Search every official in ${profile.state}.` : "Search every state legislature."} />
        <Card href="/bills" title="Bill tracker" body="Every kratom & 7-OH bill, all 50 states." />
        <Card href="/forum" title="Community" body="Lounge chat + state forums + recent activity." />
        <Card href="/news" title="Kratom news" body="Daily AI-curated updates per state." />
        <Card href="/library" title="Library" body="Videos, books, transcripts." />
        <Card href="/messages" title="Messages" body="🔒 End-to-end encrypted DMs + groups." />
        <Card href="/account" title="Account" body="Update civic info & notifications." />
      </section>

      {/* Replay panel — re-watch any walkthrough. Lives below the
          configurable widget grid so it's always findable. */}
      <div className="mt-8">
        <TutorialReplay
          isLeader={!!(profile as { is_advocate_leader?: boolean } | null)?.is_advocate_leader}
        />
      </div>

      {/* Tours. Auto-fired (first visit / leader promotion) AND replay
          via ?replay=<id>. forceShow on replay; the tour itself doesn't
          touch any persistent flag in that case. */}
      <OnboardingTour shouldShow={isFirstVisit} forceShow={replay === "onboarding"} />
      {/* Leader tour now runs from the root layout (LeaderTourController) so
          it fires on any page, not just /dashboard. The dashboard-specific
          mount that lived here was removed in PR #92. The replay query
          param still works because the controller checks
          leader_tour_pending which the replayLeaderTour() action sets. */}
      <WelcomeReplayTour forceShow={replay === "welcome"} />
    </div>
  );
}

function Banner({
  tone,
  title,
  body,
  cta,
  slot,
}: {
  tone: "amber" | "emerald";
  title: string;
  body: string;
  cta?: { href: string; label: string };
  /** Optional custom slot — replaces the CTA link with arbitrary content
   *  (e.g. an inline retry button + secondary links). */
  slot?: React.ReactNode;
}) {
  const bg = tone === "amber" ? "border-amber-900/40 bg-amber-950/20" : "border-emerald-900/40 bg-emerald-950/20";
  const titleCol = tone === "amber" ? "text-amber-300" : "text-emerald-300";
  const btnBg = tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
  const btnHover = tone === "amber" ? "hover:bg-amber-400" : "hover:bg-emerald-400";
  return (
    <div className={`rounded-lg border p-5 ${bg}`}>
      <h2 className={`text-sm font-semibold ${titleCol}`}>{title}</h2>
      <p className="mt-1 text-sm text-zinc-400">{body}</p>
      {slot ? (
        <div className="mt-3">{slot}</div>
      ) : cta ? (
        <a
          href={cta.href}
          className={`mt-3 inline-block rounded-md px-4 py-2 text-sm font-semibold text-zinc-950 ${btnBg} ${btnHover}`}
        >
          {cta.label}
        </a>
      ) : null}
    </div>
  );
}

function Card({
  href, title, body, accent, disabled,
}: {
  href: string;
  title: string;
  body: string;
  accent?: boolean;
  disabled?: boolean;
}) {
  const base = "block rounded-lg border p-5 transition";
  const cls = disabled
    ? "border-zinc-900 bg-zinc-950/40 opacity-50 cursor-not-allowed"
    : accent
    ? "border-emerald-700/50 bg-emerald-950/20 hover:border-emerald-500"
    : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-700/50";
  const content = (
    <>
      <h3 className={`text-base font-semibold ${accent ? "text-emerald-300" : "text-zinc-100"}`}>
        {title}
      </h3>
      <p className="mt-1 text-sm text-zinc-400">{body}</p>
    </>
  );
  if (disabled) return <div className={`${base} ${cls}`}>{content}</div>;
  return <a href={href} className={`${base} ${cls}`}>{content}</a>;
}
