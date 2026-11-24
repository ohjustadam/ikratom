import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata = { alternates: { canonical: "/how-it-works/for-leaders" }, title: "Leader playbook" };

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
          Advocate Leaders write campaigns, schedule waves, add local officials and
          help keep the community safe. None of it needs admin access. This page is
          public so anyone thinking about leading can see what it involves.
        </p>
        {!isLeader && (
          <div className="mt-6 inline-block rounded-md border border-amber-700/40 bg-amber-950/20 px-4 py-2 text-sm text-amber-200">
            You&apos;re viewing this as a member. Leaders are invited by the owner.{" "}
            <a href="/roles" className="underline hover:text-amber-100">How to become one</a>.
          </div>
        )}
        {isLeader && (
          <div className="mt-6 inline-block rounded-md border border-emerald-700/40 bg-emerald-950/20 px-4 py-2 text-sm text-emerald-200">
            ✓ You have leader access. Every link below works for you.
          </div>
        )}
      </header>

      {/* Sections: each checked against the real permission gates (2026-11-17). */}
      <div className="space-y-12">
        <Section
          n="01"
          title="Write a campaign"
          body="The most powerful thing a leader does. Open the campaign form, pick a state and who should get the letter (state senators and representatives, members of Congress, or city and county officials), then write the subject and letter. Placeholders like {{full_name}}, {{city}} and {{legislator_name}} fill in for each member who sends it. When you submit, an admin checks it, and once it's approved it goes live and members it fits are told. Changes to a live campaign go back to an admin too. Tie it to a bill and it shows on that bill's page."
          actionHref="/admin/campaigns/new"
          actionLabel="Write a campaign"
          gated
          isLeader={isLeader}
        />

        <Section
          n="02"
          title="Schedule a wave"
          body="A wave is a set time when everyone sends together. Fifty letters in the same hour weigh more than fifty spread over a week, because staff count what came in for the morning briefing. Once your campaign is live, open it from Your campaigns and schedule a wave: pick the time and a signup goal. Members see a live counter, join before the time, and at that minute each one's letter goes out from their own email."
          actionHref="/admin/campaigns"
          actionLabel="Your campaigns"
          gated
          isLeader={isLeader}
        />

        <Section
          n="03"
          title="Add local officials"
          body="Mayors, county commissioners and city councils aren't in the state data we sync. Add them so local campaigns can reach them. AI suggest pulls a city's roster from its own public meeting records when it has them; you check every name before anything is saved. It's free."
          actionHref="/admin/locals"
          actionLabel="Manage local officials"
          gated
          isLeader={isLeader}
        />

        <Section
          n="04"
          title="Keep the forum safe"
          body="The forum queue holds posts the filters stopped (links, phone numbers, spam patterns, a new account's first posts) and posts members reported. Approve the fine ones, hide the rest, and lock or pin threads. Reports from groups and photos come in at Moderation. You can hide a post, but only an admin can change someone's words, and it then says so."
          actionHref="/admin/forum"
          actionLabel="Forum queue"
          gated
          isLeader={isLeader}
        />

        <Section
          n="05"
          title="Approve members' stories"
          body="Members share their kratom stories at /stories/new. Read each one: personal, factual, no medical claims, no selling. Approved stories appear on /stories with a button that lets any advocate add the story to their own letter."
          actionHref="/admin/stories"
          actionLabel="Story submissions"
          gated
          isLeader={isLeader}
        />

        <Section
          n="06"
          title="Turn a forum thread into a campaign"
          body="When a discussion picks up steam, open the thread and use ✨ Turn into campaign (leaders see it). It starts the campaign form with the thread's state and a draft letter. Edit it and submit for review."
        />

        <Section
          n="07"
          title="Sign people up in person"
          body="Field signup puts someone on the platform in 30 seconds at a booth or event: email, first name and ZIP on your phone, and they finish on their own device. Your personal invite link and QR code work the same way online. Everyone who joins through you shows on your Leader workshop by @username."
          actionHref="/leader"
          actionLabel="Leader workshop"
          gated
          isLeader={isLeader}
        />

        <Section
          n="08"
          title="Run a group"
          body="Any member can start a group, and leaders often run one. Groups have events and call-in days with reminders, district captains, pinned letter templates and a group badge that grows with the letters sent. Hearings, town halls and public meetings on the site calendar are added by admins; tell one when you spot one."
          actionHref="/coalitions"
          actionLabel="Groups"
        />

        <Section
          n="09"
          title="Everything you do is logged"
          body="Every leader action is recorded to your account: campaigns written, posts hidden, stories approved. The owner can review it any time. That protects you as much as the platform: if anyone says you played favorites, the record is there."
        />

        <Section
          n="10"
          title="What only admins and the owner do"
          body="Admins approve and publish campaigns, change other people's campaigns, add bills and calendar events, correct someone's words, act on other admins' posts, lock accounts and turn on the emergency banner. Only the owner gives or takes away roles and changes permissions. The role gives you real creative power over advocacy without the keys to the platform, by design."
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
