import Link from "next/link";
import { getCachedClaims } from "@/lib/supabase/server";

type NudgeContext =
  | "pulse"          // /pulse — live policy feed
  | "state"          // /states/[code]
  | "alert"          // /alerts/[id]
  | "bill"           // /bills/[id]
  | "research"       // /research/[id]
  | "meeting"        // /meetings/[id]
  | "calendar"       // /calendar
  | "news"           // /news
  | "briefing"       // /briefings/state/[code]
  | "default";

const COPY: Record<NudgeContext, { headline: string; sub: string; cta: string }> = {
  pulse: {
    headline: "📡 Don't refresh /pulse — get pushed when alerts fire",
    sub: "Free push notifications routed to your state. No spam, your phone book stays private.",
    cta: "Get state alerts free →",
  },
  state: {
    headline: "📍 Be the first advocate to know what's happening in your state",
    sub: "Free push when bills move, hearings drop, or critical news lands. Filtered to your state — no noise.",
    cta: "Get state alerts free →",
  },
  alert: {
    headline: "🚨 Don't miss the next one",
    sub: "Real-time push the moment the next critical alert hits in your state. 30-second signup.",
    cta: "Track these alerts free →",
  },
  bill: {
    headline: "📜 Get pushed when this bill changes status",
    sub: "Track this bill — when it moves through committee, hits the floor, or gets signed, your phone pings.",
    cta: "Follow this bill free →",
  },
  research: {
    headline: "🔬 Save research to your personal library",
    sub: "Bookmark studies, get notified when new high-relevance research lands, build a citation library for advocacy.",
    cta: "Start your library free →",
  },
  meeting: {
    headline: "📅 Add this to your calendar + get reminded",
    sub: "7-day, 3-day, and 1-day push reminders before the meeting. iCal subscription auto-updates.",
    cta: "Get reminders free →",
  },
  calendar: {
    headline: "🔔 Subscribe to your state's policy calendar",
    sub: "Every public kratom-policy event in your state auto-synced to Apple/Google/Outlook. Plus push reminders before each one.",
    cta: "Subscribe free →",
  },
  news: {
    headline: "📰 Get state-relevant news pushed, not piled up",
    sub: "Only the high-relevance, state-specific stuff. We filter the noise. Free push, no email lists.",
    cta: "Get news alerts free →",
  },
  briefing: {
    headline: "📋 Get this state's briefing refreshed weekly",
    sub: "Auto-emailed (well, auto-pushed) every time the briefing updates. Plus action-required alerts in your state.",
    cta: "Subscribe free →",
  },
  default: {
    headline: "🎯 Turn this into action with one click",
    sub: "Sign up free — get pushed when stuff happens in your state, send one-click emails to your reps, track every kratom bill.",
    cta: "Sign up free →",
  },
};

/**
 * Contextual signup nudge for public pages.
 *
 * Renders ONLY for anonymous visitors — once signed in, it's invisible
 * so signed-in users aren't badgered. Each context has copy tuned to
 * what the user is currently looking at (a specific bill, a state hub,
 * a research paper, etc.).
 *
 * Design intent: data stays public + free. The platform doesn't gate
 * the information layer. But for visitors who want push notifications,
 * call tracking, leaderboard, or a personal library — those need an
 * account. This component is how we surface the value prop without
 * paywalling the data.
 *
 * Drop-in usage from any server component:
 *   <SignUpNudge context="state" stateCode="TX" />
 */
export async function SignUpNudge({
  context = "default",
  stateCode,
  className,
}: {
  context?: NudgeContext;
  stateCode?: string | null;
  className?: string;
}) {
  // Server-side gate: only render for anonymous users. Presence-only →
  // getCachedClaims (LOCAL JWT verify, no auth round-trip; already warm from
  // the chrome's getCachedAuthProfile). Renders nothing once signed in.
  const claims = await getCachedClaims();
  if (claims) return null;

  const copy = COPY[context];
  // Personalize the headline when we have a state code in scope
  const headline = stateCode && context === "state"
    ? copy.headline.replace("your state", stateCode)
    : copy.headline;
  const sub = stateCode && (context === "state" || context === "alert")
    ? copy.sub.replace("your state", stateCode)
    : copy.sub;

  return (
    <section
      className={`rounded-lg border border-emerald-700/50 bg-gradient-to-br from-emerald-950/40 to-emerald-950/20 p-5 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-emerald-200">{headline}</h3>
          <p className="mt-1 text-xs text-zinc-300">{sub}</p>
          <p className="mt-2 text-[10px] text-zinc-500">
            🔒 Free forever for advocates. No payment info. Your phone book + contacts never leave your device. Unsubscribe one tap.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            href="/signup"
            className="rounded bg-emerald-500 px-4 py-2 font-bold text-zinc-950 hover:bg-emerald-400"
          >
            {copy.cta}
          </Link>
          <Link
            href="/login"
            className="rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-zinc-300 hover:border-emerald-500"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}
