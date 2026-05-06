import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "How iKratom works" };

/**
 * Public tour page — explains every capability of the platform with
 * concrete examples. Designed for first-time visitors and shop owners
 * deciding whether to embed the widget. Pulls live counts from the DB
 * so the numbers are real, not stock copy.
 */
export default async function HowItWorksPage() {
  const supabase = await createClient();
  const [
    { count: campaigns },
    { count: bills },
    { count: actions },
    { count: stories },
  ] = await Promise.all([
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("bills").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("campaign_actions").select("id", { count: "exact", head: true }),
    supabase.from("kratom_stories").select("id", { count: "exact", head: true }).eq("moderation_status", "approved"),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Hero */}
      <header className="mb-12 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          The advocate&apos;s toolbelt
        </p>
        <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
          Hours of advocacy work, compressed into <span className="text-emerald-400">two minutes a day</span>.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-400">
          iKratom is a war room for kratom advocacy — built to make showing up easy
          enough that you actually do it. Here&apos;s what it does.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3 text-xs text-zinc-500">
          <span className="rounded-full bg-zinc-900 px-3 py-1">{(campaigns ?? 0).toLocaleString()} active campaigns</span>
          <span className="rounded-full bg-zinc-900 px-3 py-1">{(bills ?? 0).toLocaleString()} bills tracked</span>
          <span className="rounded-full bg-zinc-900 px-3 py-1">{(actions ?? 0).toLocaleString()} actions taken</span>
          <span className="rounded-full bg-zinc-900 px-3 py-1">{(stories ?? 0).toLocaleString()} stories submitted</span>
        </div>
      </header>

      {/* Capabilities */}
      <div className="space-y-12">
        <Capability
          n="01"
          title="Bill drops in your state? Pre-filled email goes out in 30 seconds."
          body="The platform scans every state legislature daily for kratom + 7-OH bills. When something hostile drops, the AI auto-classifies the stance, generates a one-click email campaign matching your state's senators and representatives, and notifies you in-app. You don't read the bill, draft a letter, find your reps' addresses, or copy/paste 47 emails. You see a notification, click Send, done."
          calloutLabel="Try it"
          calloutHref="/campaigns"
        />

        <Capability
          n="02"
          title="One Gmail click, fifty personalized emails."
          body="Connect your Gmail once at /account → every future campaign sends personalized emails to every legislator with one button. Each one comes from your real email address (not a platform domain), addresses the legislator by name, includes your zip + city, and lands in your Sent folder. Legislators recognize this as authentic constituent contact — what they actually read."
          calloutLabel="Connect Gmail"
          calloutHref="/account"
        />

        <Capability
          n="03"
          title="Coalition waves — 50 emails arriving at the same hour."
          body="A staffer reading inbound for the morning briefing sees 50 emails about HB 1234 in a 60-minute window — that's a wave. iKratom lets advocates schedule coordinated sends. Sign up between now and the fire time; at the scheduled minute, every signed-up user's email goes out via their own Gmail in a compressed window. Live counter shows momentum building. Nothing else in kratom advocacy does this."
          calloutLabel="See active waves"
          calloutHref="/campaigns"
        />

        <Capability
          n="04"
          title="Phone calls weigh more than emails. We make those one-click too."
          body="Every campaign has a call panel: tap a legislator's number → opens your dialer (or FaceTime on Mac). Talking points stay on screen while the line rings. After hanging up, hit 'I called' so it counts in your impact stats. Calls are tallied by staffers individually — they hold more weight than emails because they're harder to fake at scale."
        />

        <Capability
          n="05"
          title="Story bank. Real testimony beats talking points."
          body="The most persuasive thing a legislator reads is a paragraph from a constituent who got their life back. iKratom hosts a moderated story bank — submit yours, browse others, and one-click attach any approved story to your own letter. Stories tagged by topic (chronic pain, recovery, mental health, medical professional, shop owner) so you can match what speaks to your situation."
          calloutLabel="Read stories"
          calloutHref="/stories"
        />

        <Capability
          n="06"
          title="Bills page tells you what the bill actually does."
          body="Every kratom bill across all 50 states has its own page on iKratom. AI summarizes the bill plainly. The advocacy callout tells you whether to support or oppose. Direct ⭐ link to the official state-legislature page so you can read the actual text. Closed-session bills get an amber 'this is from a dead session' badge so you don't waste time. Effective dates surface in a green Key Dates panel when set."
          calloutLabel="Browse bills"
          calloutHref="/bills"
        />

        <Capability
          n="07"
          title="Town halls + public hearings — show up where they expect a different audience."
          body="Legislators move on kratom when they see kratom advocates in the room. /events lists upcoming public hearings, town halls, listening sessions — by state, with venue + time + which legislator hosts. The fastest way to make a representative care is being one of three people who showed up specifically to ask about kratom."
          calloutLabel="Find events"
          calloutHref="/events"
        />

        <Capability
          n="08"
          title="Forum, per-state. With moderation that doesn't suck."
          body="Each state has its own forum thread — coordinate the OK fight with OK advocates, share what's working in TX with people watching FL. Moderation auto-flags posts with non-whitelisted URLs, phone numbers, crypto wallets, and spam patterns. New-account first 3 posts go through review. Real conversations stay visible; commercial spam never lands."
          calloutLabel="Visit a state forum"
          calloutHref="/forum"
        />

        <Capability
          n="09"
          title="News, deduped. Bills, AI-summarized. Both per-state."
          body="iKratom scrapes Google News daily for kratom + 7-OH coverage. Same wire-service article syndicated to 8 states? We cluster it via embeddings so you see one story, not eight. Every news item gets an AI relevance score + topic tag (legislation/science/business/enforcement/culture). Filter by your state, your topic, your interest level."
          calloutLabel="Today's news"
          calloutHref="/news"
        />

        <Capability
          n="10"
          title="Encrypted DMs. Coordinate without leaks."
          body="Direct messages between advocates are end-to-end encrypted with libsodium (Curve25519 + XChaCha20-Poly1305). Keys live in your browser, never on the server. Even iKratom's own admins can't read your DMs. Useful for shop owners coordinating ahead of a vote, or advocates discussing strategy without whoever's monitoring."
          calloutLabel="Open DMs"
          calloutHref="/messages"
        />

        <Capability
          n="11"
          title="Embed widget — shop owners turn their storefront into a recruitment node."
          body={
            <>
              One line of HTML: <code className="rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-xs text-emerald-300">{'<script src="ikratom.app/embed/v1/email-rep.js" data-state="OK"></script>'}</code>. Renders a call-to-action card on your kratom shop&apos;s site. Customer clicks → lands on iKratom auto-routed to your state&apos;s active campaign → sends an email. The action is credited back to your domain. You get a public stats page to share.
            </>
          }
          calloutLabel="Embed docs"
          calloutHref="/embed"
        />

        <Capability
          n="12"
          title="Two-factor + audit log + sessions + breached-password check."
          body="Authenticator app (TOTP) for 2FA, with 8 single-use backup codes. Sign-in step-up — even if someone has your password, they can't get past /login/mfa without your phone. Every admin action is audit-logged. Active sessions list with one-click 'sign out everywhere'. Signups can't use passwords from known breaches (HIBP k-anonymity check). New-device sign-ins create an in-app notification immediately."
          calloutLabel="Your security"
          calloutHref="/account/security"
        />

        <Capability
          n="13"
          title="Emergency mode. Break glass when the FDA moves."
          body="Owner toggles a site-wide red banner from /admin/emergency. Every page on iKratom shows your message, severity-coded (info/urgent/critical), with a CTA pointing to a campaign. No redeploy needed. Use when DEA scheduling rumors break, federal hostile bill drops, FDA action — anywhere you need every advocate's attention right now."
        />

        <Capability
          n="14"
          title="Audit log shows exactly who did what, when."
          body="Every privileged action — role changes, campaign edits, story moderation, MFA changes, wave cancellations — gets logged with actor, target, and timestamps. Append-only. Admin-readable. If something controversial happens on the platform, the receipt exists."
        />

        <Capability
          n="15"
          title="Free-tier first. We pay for nothing the community can't replicate."
          body="iKratom runs on Vercel free tier + Supabase free tier. AI enrichment uses local Ollama (free, unlimited, runs on the maintainer's desktop) — not paid OpenAI/Anthropic. News scraping uses Google News RSS (free, unlimited). Bill data uses OpenStates free tier (250 calls/day). Everything you see was built without taking org money or charging users a cent."
        />
      </div>

      {/* Leader sub-tour link */}
      <section className="mt-16 rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          For leaders + admins
        </p>
        <h2 className="mt-2 text-xl font-bold">There&apos;s a separate playbook for advocate leaders.</h2>
        <p className="mt-2 text-sm text-zinc-300">
          What you can do with leader access — campaigns, waves, local bills,
          events, moderation queues, AI research briefings, the works.
        </p>
        <a
          href="/how-it-works/for-leaders"
          className="mt-4 inline-block rounded-md border border-emerald-700/50 bg-emerald-950/30 px-5 py-2 text-sm font-semibold text-emerald-300 hover:border-emerald-500"
        >
          Read the leader playbook →
        </a>
      </section>

      {/* CTA */}
      <section className="mt-12 rounded-lg border-2 border-emerald-700/50 bg-gradient-to-br from-emerald-950/30 to-zinc-950/40 p-8 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl">
          Stop yelling in the wind.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-zinc-300">
          Sign up takes 30 seconds. Connect your Gmail and you&apos;re sending
          personalized legislator emails by your second click.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href="/signup"
            className="rounded-md bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Join the war room →
          </a>
          <a
            href="/campaigns"
            className="rounded-md border border-zinc-700 px-6 py-3 font-semibold hover:border-emerald-500 hover:text-emerald-400"
          >
            Browse campaigns first
          </a>
        </div>
      </section>
    </div>
  );
}

function Capability({
  n, title, body, calloutLabel, calloutHref,
}: {
  n: string;
  title: string;
  body: React.ReactNode;
  calloutLabel?: string;
  calloutHref?: string;
}) {
  return (
    <section className="grid gap-5 sm:grid-cols-[auto_1fr]">
      <div className="font-mono text-3xl text-emerald-400 sm:text-4xl">{n}</div>
      <div>
        <h3 className="text-xl font-bold leading-tight sm:text-2xl">{title}</h3>
        <p className="mt-2 text-zinc-300">{body}</p>
        {calloutLabel && calloutHref && (
          <a
            href={calloutHref}
            className="mt-3 inline-block text-sm font-semibold text-emerald-400 hover:underline"
          >
            {calloutLabel} →
          </a>
        )}
      </div>
    </section>
  );
}
