import { createAnonClient } from "@/lib/supabase/anon";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { HowItWorksInvite } from "./HowItWorksInvite";
import { QuickStart } from "./QuickStart";
import { ToolMap } from "./ToolMap";
import { GroupsGuide } from "./GroupsGuide";
import { SafetyGuide } from "./SafetyGuide";
import { Troubleshooting } from "./Troubleshooting";
import { getContent } from "@/lib/editable-content";

import Link from "@/components/Link";
export const metadata = {
  title: "Getting started on iKratom",
  description: "A step-by-step guide for new members: set up, send your first letter, start a group, and stay anonymous.",
};

/**
 * The getting-started guide (rewritten 2026-11-03): first-session steps, the
 * daily routine, every tool, groups and recruiting, privacy, good practice and
 * common questions. Each section lives in its own file beside this one. The old
 * annotated screenshots showed a UI that no longer exists, so the guide links
 * to the live tools instead.
 *
 * ── WHY THIS IS STATIC NOW (2026-09-10) ─────────────────────────────────────
 * This is a marketing explainer: the same words, the same screenshots and the
 * same four headline numbers for every single visitor. It nonetheless carried
 * `force-dynamic` for no stated reason, and even without that export it had two
 * cookie reads — the user-bound Supabase client used for the counts, and an
 * `auth.getUser()` behind the invite widget — either of which is enough on its
 * own to opt a route out of caching. So every crawler hit re-ran four COUNT
 * queries against Supabase, on a page whose content changes when someone edits
 * copy in /admin, i.e. almost never.
 *
 * Beyond egress there is a resilience argument: Supabase's free plan does not
 * bill for overage, it RESTRICTS the project. A prerendered page is a file on
 * the CDN and keeps serving through that; a dynamic route 500s. The tour a new
 * advocate lands on should be the last thing to go dark.
 */
export const revalidate = 3600;

export default async function HowItWorksPage() {
  // Cookieless anon client: these three counts are public aggregates and were
  // VERIFIED to return identical numbers under anon and service role
  // (campaigns 218/218, bills 342/342, kratom_stories 2/2 on 2026-09-10), so
  // RLS is not hiding rows from the cached snapshot.
  const supabase = createAnonClient();
  const [{ count: campaigns }, { count: bills }, actions, { count: stories }, intro] = await Promise.all([
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("bills").select("id", { count: "exact", head: true }).eq("active", true),
    totalActionsTaken(),
    supabase.from("kratom_stories").select("id", { count: "exact", head: true }).eq("moderation_status", "approved"),
    // Admin-editable intro paragraph — overridable from /admin/content/how-it-works.intro.
    getContent(
      "how-it-works.intro",
      "iKratom is a free, independent toolbelt for kratom advocacy, built to make showing up easy enough that you actually do it.",
    ),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Hero
        intro={intro}
        campaigns={campaigns ?? 0}
        bills={bills ?? 0}
        actions={actions}
        stories={stories ?? 0}
      />

      <Contents />
      <QuickStart />
      <ToolMap />
      <GroupsGuide />
      <SafetyGuide />
      <Troubleshooting />
      <FromFacebook />
      <ForLeaders />
      <CTA />
    </div>
  );
}

/**
 * Platform-wide count of actions taken — a genuine public aggregate.
 *
 * This one count CANNOT come from the anon client. `campaign_actions` RLS is
 * self-scoped ("actions_self_read", migration 0001), so anon reads 0 and a
 * signed-in advocate reads only their own. That made the number in a row of
 * platform stats — next to "218 active campaigns" and "342 bills tracked" —
 * accidentally per-viewer, and permanently "0 actions taken" for the logged-out
 * visitors this tour is written for. Caching either answer would be wrong:
 * publishing one advocate's personal total to everyone is exactly the leak this
 * whole effort is closing, and freezing a hard 0 is a false claim.
 *
 * A service-role COUNT is the honest reading of what the chip has always meant.
 * It bypasses RLS deliberately and returns a bare integer — no rows, no
 * identities, nothing per-user — so it is safe in shared HTML. Note this is a
 * different call than /api/bills/[id]/viewer's action count, which is
 * deliberately RLS-scoped because it is presented as the READER's number.
 *
 * Degrades to 0 if the key is absent (e.g. a preview build) rather than taking
 * the page down, matching how `getContent` tolerates the same gap.
 */
async function totalActionsTaken(): Promise<number> {
  try {
    const { count } = await createServiceRoleClient()
      .from("campaign_actions")
      .select("id", { count: "exact", head: true });
    return count ?? 0;
  } catch {
    return 0;
  }
}

function Hero({ intro, campaigns, bills, actions, stories }: { intro: string; campaigns: number; bills: number; actions: number; stories: number }) {
  return (
    <header className="text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Getting started</p>
      <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
        Hours of advocacy work, compressed into <span className="text-emerald-400">two minutes a day</span>.
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-400">{intro}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3 text-xs text-zinc-500">
        <span className="rounded-full bg-zinc-900 px-3 py-1">{campaigns.toLocaleString()} active campaigns</span>
        <span className="rounded-full bg-zinc-900 px-3 py-1">{bills.toLocaleString()} bills tracked</span>
        <span className="rounded-full bg-zinc-900 px-3 py-1">{actions.toLocaleString()} actions taken</span>
        <span className="rounded-full bg-zinc-900 px-3 py-1">{stories.toLocaleString()} stories shared</span>
      </div>
    </header>
  );
}

const CONTENTS: [string, string][] = [
  ["#start", "Your first ten minutes"],
  ["#daily", "Two minutes a day"],
  ["#tools", "Everything you can do"],
  ["#groups", "Groups and recruiting"],
  ["#safety", "Privacy and safety"],
  ["#practice", "Letters that work"],
  ["#help", "Common questions"],
];

function Contents() {
  return (
    <nav aria-label="On this page" className="mt-10 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">On this page</p>
      <ol className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {CONTENTS.map(([href, label], i) => (
          <li key={href}>
            <a href={href} className="text-zinc-300 hover:text-emerald-400">{i + 1}. {label}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function FromFacebook() {
  return (
    <section className="mt-16 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      <h2 className="text-xl font-bold">Coming from a Facebook group?</h2>
      <p className="mt-2 text-sm text-zinc-300">
        Keep it. Use Facebook for the daily conversation and iKratom for the action. Every campaign has a share button: drop it in your
        group when a bill moves, and start an iKratom group so your members can act together. We never import your friends list, and
        nobody here sees more than your @username.
      </p>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Your personal invite link</p>
      <div className="mt-2"><HowItWorksInvite /></div>
    </section>
  );
}

function ForLeaders() {
  return (
    <section className="mt-12 rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">For organizers and leaders</p>
      <h2 className="mt-2 text-xl font-bold">There&apos;s a separate playbook for advocate leaders.</h2>
      <p className="mt-2 text-sm text-zinc-300">Writing campaigns, scheduling waves, local ordinances, events and research briefings.</p>
      <a href="/how-it-works/for-leaders" className="mt-4 inline-block rounded-md border border-emerald-700/50 bg-emerald-950/30 px-5 py-2 text-sm font-semibold text-emerald-300 hover:border-emerald-500">
        Read the leader playbook →
      </a>
    </section>
  );
}

function CTA() {
  return (
    <section className="mt-12 rounded-lg border-2 border-emerald-700/50 bg-gradient-to-br from-emerald-950/30 to-zinc-950/40 p-8 text-center">
      <h2 className="text-2xl font-bold sm:text-3xl">Stop yelling into the wind.</h2>
      <p className="mx-auto mt-3 max-w-xl text-zinc-300">
        It&apos;s free. Sign up, connect your email, and your first letter to your own legislators is one click away.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <a href="/signup" className="rounded-md bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 hover:bg-emerald-400">Create a free account →</a>
        <Link href="/campaigns" className="rounded-md border border-zinc-700 px-6 py-3 font-semibold hover:border-emerald-500 hover:text-emerald-400">Browse campaigns first</Link>
      </div>
    </section>
  );
}
