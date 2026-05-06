import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Leader playbook" };

/**
 * Tutorial for advocate leaders — what they can do that regular users can't.
 * Anyone can read this (it's public so leaders considering accepting the role
 * can see what it entails) but the actions all require is_advocate_leader = true.
 */
export default async function LeaderHowItWorksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let isLeader = false;
  let isAdmin = false;
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("is_admin, is_owner, is_advocate_leader")
      .eq("id", user.id)
      .single();
    isLeader = !!(prof as { is_advocate_leader: boolean | null } | null)?.is_advocate_leader;
    isAdmin = !!(prof as { is_admin: boolean | null; is_owner: boolean | null } | null)?.is_admin
      || !!(prof as { is_owner: boolean | null } | null)?.is_owner;
  }
  void isAdmin; void redirect; // keep imports stable; redirect is unused but available

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <a href="/how-it-works" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← General overview
      </a>

      <header className="mt-3 mb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Leader playbook
        </p>
        <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
          You can move bills. Here&apos;s how.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-400">
          Advocate leaders run campaigns, schedule waves, post events, and shape
          the platform&apos;s response when threats land. Most powers don&apos;t
          require admin or owner — just <span className="font-mono text-emerald-300">is_advocate_leader = true</span>{" "}
          on your profile.
        </p>
        {!isLeader && (
          <div className="mt-6 inline-block rounded-md border border-amber-700/40 bg-amber-950/20 px-4 py-2 text-sm text-amber-200">
            You&apos;re viewing this as a regular user. To get leader access, ask the platform owner.
          </div>
        )}
        {isLeader && (
          <div className="mt-6 inline-block rounded-md border border-emerald-700/40 bg-emerald-950/20 px-4 py-2 text-sm text-emerald-200">
            ✓ You have leader access. Every link below works for you.
          </div>
        )}
      </header>

      {/* Sections */}
      <div className="space-y-12">
        <Section
          n="01"
          title="Spawn a campaign in 60 seconds"
          body="Most powerful thing a leader does. Go to /admin/campaigns/new. Pick a state, pick which legislator roles to target (state senate, state house, US senate, US house), pick locality if it's local, paste a subject + body template with {{variables}}, hit save. Campaign goes live immediately and notifies every matched user via the existing trigger. If it's tied to a specific bill, link the bill_id to surface it on the bill detail page."
          actionHref="/admin/campaigns/new"
          actionLabel="Create a campaign"
          gated
          isLeader={isLeader}
        />

        <Section
          n="02"
          title="Schedule a coalition wave"
          body="A wave coordinates a coordinated send. 50 emails in the same hour weighs more than 50 scattered over a week — staffers tally inbound for the morning briefing. Open any campaign you created (or any campaign in /admin/campaigns), click ⚡ Schedule wave. Pick the fire time, set a signup goal. Users see a live counter on the campaign page, sign up between now and fire time, and at the scheduled minute every signed-up user's email goes out via their own Gmail."
          actionHref="/admin/campaigns"
          actionLabel="Pick a campaign to wave"
          gated
          isLeader={isLeader}
        />

        <Section
          n="03"
          title="Add local officials OpenStates can't track"
          body="Mayors, county commissioners, school board members, city council — none of these are in OpenStates. /admin/locals lets you add them. Use AI suggest at /admin/locals/suggest — paste a city name and Gemini auto-fills the current officials with their public emails. Review, accept, done. These officials become available as targets for local campaigns the same as state legislators."
          actionHref="/admin/locals"
          actionLabel="Manage local officials"
          gated
          isLeader={isLeader}
        />

        <Section
          n="04"
          title="Add a county or municipal bill"
          body="OpenStates doesn't track local legislation. When a city council moves on kratom, you add it manually at /admin/bills/new. Pick scope = municipal/county, set the locality (Tulsa, OK), paste the title + summary + advocacy callout. The bill gets its own /bills/<id> page just like state bills, can have campaigns linked to it, can have waves run against it."
          actionHref="/admin/bills/new"
          actionLabel="Add a local bill"
          gated
          isLeader={isLeader}
        />

        <Section
          n="05"
          title="Post a town hall or public hearing"
          body="The fastest way to make a legislator move is to be the one advocate who actually showed up. /admin/events/new lets you add upcoming hearings, town halls, listening sessions, committee hearings, even floor-vote dates. Title + state + locality + datetime + venue. Appears on /events publicly, sorted by day. Users can filter by their state."
          actionHref="/admin/events/new"
          actionLabel="Add an event"
          gated
          isLeader={isLeader}
        />

        <Section
          n="06"
          title="Approve or reject auto-generated campaigns"
          body="When the daily cron detects a new anti-kratom bill, it auto-creates a campaign with high confidence + auto-publishes, OR with medium confidence + lands in /admin/campaigns/pending for your review. The pending queue shows the bill's classification confidence, whether deep-analysis confirmed it targets natural leaf, and the official source URL. One click approve = goes live + notifies users. One click reject = stays inactive forever."
          actionHref="/admin/campaigns/pending"
          actionLabel="Review pending campaigns"
          gated
          isLeader={isLeader}
        />

        <Section
          n="07"
          title="Moderate the forum"
          body="/admin/forum is your queue for posts that auto-flagged (commercial spam, links, phone numbers, crypto wallets), user-reported posts, and first-3-posts from new accounts. One-click approve, one-click remove (with optional reason), see the post in context. Forum stays clean without you having to police every thread."
          actionHref="/admin/forum"
          actionLabel="Forum moderation queue"
          gated
          isLeader={isLeader}
        />

        <Section
          n="08"
          title="Approve story bank submissions"
          body="Users submit personal kratom stories at /stories/new. They land in /admin/stories. Read it, decide if it fits the platform's voice (personal, factual, no medical claims, no vendor promotion), approve or reject. Approved stories appear on /stories with a 📨 'Use this story in a letter' button — every advocate can attach the story to their own legislator email with one click."
          actionHref="/admin/stories"
          actionLabel="Story moderation queue"
          gated
          isLeader={isLeader}
        />

        <Section
          n="09"
          title="Spawn a campaign from a forum thread"
          body="A discussion in the forum picked up momentum and you want to turn it into action? Open the thread → ✨ Turn into campaign button (visible to leaders only) auto-fills /admin/campaigns/new with the thread's state + a draft body. Edit, save, live. Forum thread → mass legislator email in a few minutes."
        />

        <Section
          n="10"
          title="Run AI research briefings on any campaign"
          body="Before crafting a campaign template, kick off a research briefing locally. From your laptop with Ollama running: npm run research:campaign -- --slug <campaign-slug>. The agent uses tool-calling to query bills, news, and legislators in your state, then writes a one-page briefing covering: landscape, active bills, recent news, recommended legislators to target, suggested talking points. Briefing saves to the campaign's edit page automatically."
        />

        <Section
          n="11"
          title="The audit log keeps you accountable"
          body="Every leader action is audit-logged. Campaign create, wave create, story approve, post remove — all of it. The owner can review /admin/audit any time. This protects YOU as much as it protects the platform — if anyone accuses you of bias or favoritism, the receipts are right there."
          actionHref="/admin/audit"
          actionLabel="View the audit log"
          gated
          isLeader={isLeader}
        />

        <Section
          n="12"
          title="What you can't do (without admin)"
          body="Promote/demote other admins or leaders (owner-only). Toggle emergency mode (admin-only). Delete users (admin-only). Edit other leaders' campaigns (each leader can edit their own). Modify global notification preferences. Run database-level operations. The role gives you full creative authority over advocacy work without giving you nuclear-option access — by design."
        />
      </div>

      {/* Closing */}
      <section className="mt-16 rounded-lg border border-emerald-700/50 bg-gradient-to-br from-emerald-950/30 to-zinc-950/40 p-8">
        <h2 className="text-xl font-bold">The mission</h2>
        <p className="mt-3 text-zinc-300">
          Most kratom advocacy stalls because the people doing the work get
          burned out. Leaders on iKratom should not be working harder — they
          should be working with sharper tools so a 10-minute decision turns
          into 50 emails to legislators across three states by lunchtime.
          Anything you spot that&apos;s slowing you down, tell the owner — the
          platform is meant to bend toward what leaders actually need.
        </p>
      </section>
    </div>
  );
}

function Section({
  n, title, body, actionHref, actionLabel, gated, isLeader,
}: {
  n: string;
  title: string;
  body: React.ReactNode;
  actionHref?: string;
  actionLabel?: string;
  gated?: boolean;
  isLeader?: boolean;
}) {
  return (
    <section className="grid gap-5 sm:grid-cols-[auto_1fr]">
      <div className="font-mono text-3xl text-emerald-400 sm:text-4xl">{n}</div>
      <div>
        <h3 className="text-xl font-bold leading-tight sm:text-2xl">{title}</h3>
        <p className="mt-2 text-zinc-300">{body}</p>
        {actionHref && actionLabel && (
          gated && !isLeader ? (
            <p className="mt-3 inline-block rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-xs text-zinc-500">
              🔒 Leader access required
            </p>
          ) : (
            <a
              href={actionHref}
              className="mt-3 inline-block text-sm font-semibold text-emerald-400 hover:underline"
            >
              {actionLabel} →
            </a>
          )
        )}
      </div>
    </section>
  );
}
