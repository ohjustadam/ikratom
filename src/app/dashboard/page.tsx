import { getProfile } from "@/modules/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { getUserLegislators } from "@/lib/legislators";
import { MyRepCard } from "./MyRepCard";
import { StreakBadge } from "@/components/StreakBadge";
import { getCockpitLayout } from "@/modules/dashboard/actions";
import { CockpitCustomizer } from "@/modules/dashboard/CockpitCustomizer";
import { OnboardingTour } from "@/modules/dashboard/OnboardingTour";
import { BriefingWidget } from "@/modules/dashboard/widgets/BriefingWidget";
import { ActiveCampaignsWidget } from "@/modules/dashboard/widgets/ActiveCampaignsWidget";
import { RepCoverageWidget } from "@/modules/dashboard/widgets/RepCoverageWidget";
import { ScoreboardWidget } from "@/modules/dashboard/widgets/ScoreboardWidget";
import { MyBattlesWidget } from "@/modules/dashboard/widgets/MyBattlesWidget";
import { SavedSearchesWidget } from "@/modules/dashboard/widgets/SavedSearchesWidget";
import type { WidgetId } from "@/modules/dashboard/widgets/types";

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

export default async function DashboardPage() {
  const { profile, email } = await getProfile();
  const layout = await getCockpitLayout();

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
  if (profile?.state) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
    if (userId) myReps = await getUserLegislators(supabase, profile);
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
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
      <Banner
        tone="amber"
        title="We couldn't auto-detect your districts"
        body="Add your full street address so we can match you to your specific U.S. House and state legislative districts."
        cta={{ href: "/account", label: "Update address →" }}
      />
    ) : null,
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
    saved_searches: userId ? <SavedSearchesWidget /> : null,
    my_reps:
      myReps.length > 0 ? (
        <section data-tour="my-reps">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-lg font-semibold">Your representatives</h2>
            <a href="/legislators" className="text-xs text-emerald-400 hover:underline">
              See all in {profile?.state} →
            </a>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {myReps.map((l) => (
              <MyRepCard key={l.id} legislator={l} />
            ))}
          </ul>
        </section>
      ) : null,
  };

  const isFirstVisit = !!profile && layout?.onboarded_at === null;

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
          <div className="shrink-0">
            <CockpitCustomizer
              initialLayout={layout.widgets}
              initialAccent={layout.accent_color}
            />
          </div>
        )}
      </header>

      {/* Render widgets in saved order. Falsey nodes (e.g. profile
          banner when profile is complete) silently render nothing. */}
      <div className="space-y-6">
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

      {/* First-visit tour. No-op when onboarded_at already set. */}
      <OnboardingTour shouldShow={isFirstVisit} />
    </div>
  );
}

function Banner({
  tone,
  title,
  body,
  cta,
}: {
  tone: "amber" | "emerald";
  title: string;
  body: string;
  cta: { href: string; label: string };
}) {
  const bg = tone === "amber" ? "border-amber-900/40 bg-amber-950/20" : "border-emerald-900/40 bg-emerald-950/20";
  const titleCol = tone === "amber" ? "text-amber-300" : "text-emerald-300";
  const btnBg = tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
  const btnHover = tone === "amber" ? "hover:bg-amber-400" : "hover:bg-emerald-400";
  return (
    <div className={`rounded-lg border p-5 ${bg}`}>
      <h2 className={`text-sm font-semibold ${titleCol}`}>{title}</h2>
      <p className="mt-1 text-sm text-zinc-400">{body}</p>
      <a
        href={cta.href}
        className={`mt-3 inline-block rounded-md px-4 py-2 text-sm font-semibold text-zinc-950 ${btnBg} ${btnHover}`}
      >
        {cta.label}
      </a>
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
