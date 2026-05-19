import { createClient } from "@/lib/supabase/server";
import { InviteFriends } from "@/components/InviteFriends";
import { getMyInviteSummary, buildInviteUrl } from "@/modules/invite/actions";
import { AnnotatedScreenshot, type Pin } from "@/components/AnnotatedScreenshot";
import { getContent } from "@/lib/editable-content";

export const metadata = { title: "How iKratom works" };
export const dynamic = "force-dynamic";

/**
 * Public tour — annotated screenshots, ethics, what's good vs bad practice.
 * Designed for FB advocates considering migrating + first-time visitors.
 */
export default async function HowItWorksPage() {
  const supabase = await createClient();
  const [{ count: campaigns }, { count: bills }, { count: actions }, { count: stories }, intro] = await Promise.all([
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("bills").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("campaign_actions").select("id", { count: "exact", head: true }),
    supabase.from("kratom_stories").select("id", { count: "exact", head: true }).eq("moderation_status", "approved"),
    // Admin-editable intro paragraph — overridable from /admin/content/how-it-works.intro.
    getContent(
      "how-it-works.intro",
      "iKratom is a war room for kratom advocacy — built to make showing up easy enough that you actually do it.",
    ),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Hero
        intro={intro}
        campaigns={campaigns ?? 0}
        bills={bills ?? 0}
        actions={actions ?? 0}
        stories={stories ?? 0}
      />

      <Onboarding />
      <Sections />
      <Practices />
      <Ethics />
      <FbMigration />
      <ForLeaders />
      <CTA />
    </div>
  );
}

function Hero({ intro, campaigns, bills, actions, stories }: { intro: string; campaigns: number; bills: number; actions: number; stories: number }) {
  return (
    <header className="mb-12 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
        The advocate&apos;s toolbelt
      </p>
      <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
        Hours of advocacy work, compressed into <span className="text-emerald-400">two minutes a day</span>.
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-400">
        {intro}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3 text-xs text-zinc-500">
        <span className="rounded-full bg-zinc-900 px-3 py-1">{campaigns.toLocaleString()} active campaigns</span>
        <span className="rounded-full bg-zinc-900 px-3 py-1">{bills.toLocaleString()} bills tracked</span>
        <span className="rounded-full bg-zinc-900 px-3 py-1">{actions.toLocaleString()} actions taken</span>
        <span className="rounded-full bg-zinc-900 px-3 py-1">{stories.toLocaleString()} stories submitted</span>
      </div>
      <a href="/how-it-works/homepage.PNG" target="_blank" rel="noreferrer" className="mt-8 block">
        <Screenshot src="/how-it-works/homepage.PNG" alt="iKratom homepage" />
      </a>
    </header>
  );
}

function Onboarding() {
  return (
    <Block title="Onboarding — 60 seconds" eyebrow="01 — Sign up">
      <p>
        Sign up takes two minutes. We ask for your address (private, never shown to
        anyone) so we can match you to the specific legislators who represent <em>you</em>.
        That&apos;s the difference between &quot;email your senator&quot; and a personalized
        letter to <em>your</em> senator with your zip and city.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CapStep n="1" caption="Welcome" img="/how-it-works/step1-onboarding.PNG" />
        <CapStep n="2" caption="Address (private)" img="/how-it-works/step2-onboarding.PNG" />
        <CapStep n="3" caption="About you" img="/how-it-works/step3-onboarding.PNG" />
        <CapStep n="4" caption="Notification prefs" img="/how-it-works/step4-onboarding.PNG" />
        <CapStep n="5" caption="Done" img="/how-it-works/step5-onboarding.PNG" />
      </div>
      <Note>
        <strong>Privacy guarantee:</strong> address never appears in your public profile or anywhere
        other users see. It&apos;s used solely to match districts. You can change or delete it
        any time on /account.
      </Note>
    </Block>
  );
}

function Sections() {
  return (
    <Block title="What you can actually do" eyebrow="02 — Capabilities">
      <CapAnnotated
        title="Dashboard"
        body="One view: your matched legislators, your active campaigns, what's happening in your state."
        src="/how-it-works/dashboard.PNG"
        pins={[
          { x: 50, y: 12, n: 1, caption: "Your action streak — 'don't break it' is real motivation" },
          { x: 50, y: 45, n: 2, caption: "Your specific reps load here based on your address" },
          { x: 50, y: 80, n: 3, caption: "One-click open campaign cards for active issues in your state" },
        ]}
      />
      <CapAnnotated
        title="One-click campaigns"
        body="Pre-written email, your data autofilled. Send via Gmail (one click sends to all your reps in a batch), Outlook, Apple Mail, or copy-paste. Attach a personal video or audio clip."
        src="/how-it-works/campaigns.PNG"
        pins={[
          { x: 18, y: 22, n: 1, caption: "Browse campaigns by state, stance, status, or full-text search" },
          { x: 50, y: 50, n: 2, caption: "Each card shows urgency badges + bill # + 'Take action' CTA" },
          { x: 80, y: 30, n: 3, caption: "Your-state campaigns float to the top automatically" },
        ]}
      />
      <CapAnnotated
        title="Bill tracker"
        body="Every kratom + 7-OH bill across all 50 states, AI-summarized, sponsor list, official-source link, key dates. Auto-updated daily."
        src="/how-it-works/billtracker.PNG"
        pins={[
          { x: 25, y: 18, n: 1, caption: "Filter by state, stance, status, or session — never read a dead bill" },
          { x: 75, y: 40, n: 2, caption: "AI summary in plain English + advocacy callout in emerald" },
          { x: 50, y: 75, n: 3, caption: "Closed-session bills get an amber flag so you don't waste time" },
        ]}
      />
      <CapAnnotated
        title="Legislators"
        body="Find your specific senators + reps + state legislators. See their kratom record (anti / pro / leaf-targeting) before you contact them."
        src="/how-it-works/legislators.PNG"
        pins={[
          { x: 30, y: 25, n: 1, caption: "Filter by state, role, party — find the right person fast" },
          { x: 70, y: 55, n: 2, caption: "Each card links to a profile with sponsor record + contact info" },
        ]}
      />
      <CapAnnotated
        title="News"
        body="Daily Google News scrape, deduplicated across states, AI relevance score + topic tag."
        src="/how-it-works/news.PNG"
        pins={[
          { x: 25, y: 18, n: 1, caption: "Filter by state, topic, or relevance score" },
          { x: 75, y: 50, n: 2, caption: "+N more badge when the same story syndicated to other states" },
        ]}
      />
      <CapAnnotated
        title="Forum (per state)"
        body="Each state has its own threads. Coordinate with people watching the same fights. Moderated — spam, vendor pushes, and harassment land in the queue, not on your feed."
        src="/how-it-works/forum1.PNG"
        pins={[
          { x: 50, y: 20, n: 1, caption: "State picker — every state has its own forum, plus 'national'" },
          { x: 50, y: 60, n: 2, caption: "Threads ranked by activity; pinned + locked badges visible" },
        ]}
      />
      <CapAnnotated
        title="Encrypted DMs"
        body="End-to-end encrypted (libsodium / Curve25519). Even the platform owner can't read your messages."
        src="/how-it-works/messages.PNG"
        pins={[
          { x: 25, y: 30, n: 1, caption: "Conversation list — keys live in your browser, never the server" },
          { x: 75, y: 60, n: 2, caption: "Block + report controls; encrypted reactions supported" },
        ]}
      />
      <CapAnnotated
        title="Library"
        body="Curated reading list — research papers, policy briefs, court filings, AKA position papers. Filterable by topic."
        src="/how-it-works/library.PNG"
        pins={[
          { x: 50, y: 25, n: 1, caption: "Tags + search — find what you need to cite in a letter" },
          { x: 50, y: 65, n: 2, caption: "Embedded videos + audio interviews load inline" },
        ]}
      />
      <CapAnnotated
        title="Notifications"
        body="When a hostile bill drops in your state, you get an alert. When a wave you joined fires, you get a reminder."
        src="/how-it-works/notifications.PNG"
        pins={[
          { x: 50, y: 25, n: 1, caption: "New bill in your state? Notification within seconds of cron sync" },
          { x: 50, y: 60, n: 2, caption: "Tap → directly to the matched campaign, ready to send" },
        ]}
      />
    </Block>
  );
}

function Practices() {
  return (
    <Block title="Good practice vs. bad practice" eyebrow="03 — How to actually move legislators">
      <div className="grid gap-5 lg:grid-cols-2">
        <ListBox
          tone="good"
          title="✅ Good practice"
          items={[
            "Personal first sentence: 'I'm a [job] in [city] and I take kratom because…'",
            "One specific ask: 'Please vote NO on HB 1234'",
            "Mention you're a constituent — your zip is your authority",
            "Share a story, not a study (legislators read stories)",
            "Email AND call — calls get tallied separately + weigh more",
            "Show up to one town hall a year if you can",
            "Reply to staffers' replies with thanks (relationship > one-shot)",
            "Coordinate on a wave so messages land in the same hour",
          ]}
        />
        <ListBox
          tone="bad"
          title="❌ Bad practice (kills your credibility)"
          items={[
            "Mass copy-paste with no personal sentence (filtered as form letter)",
            "Demands without specific bill numbers or asks",
            "Personal attacks on the legislator or their family",
            "Cross-state mass campaigns (you're not their constituent — ignored)",
            "Sending the same email to the same office multiple times in a week",
            "Vendor promotion in any communication ('come buy our shop')",
            "Misinformation — even pro-kratom misinformation discredits the cause",
            "Threatening language, even rhetorical (can trigger Capitol police, no joke)",
          ]}
        />
      </div>
    </Block>
  );
}

function Ethics() {
  return (
    <Block title="Ethics + community standards" eyebrow="04 — What we ask of you">
      <p>
        iKratom is a tool for <strong className="text-zinc-100">authentic constituent voice</strong>.
        That&apos;s what makes it work — and what protects everyone using it. The platform
        will refuse, ban, and report attempts to weaponize it for the opposite.
      </p>

      <div className="mt-5 rounded-lg border border-amber-700/40 bg-amber-950/10 p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-300">
          ⚠ You may be banned for any of the following
        </p>
        <ul className="mt-2 space-y-1 text-sm text-zinc-200">
          <li>· Creating multiple accounts to inflate action counts</li>
          <li>· Coordinated inauthentic behavior (one person operating many advocate identities)</li>
          <li>· Threatening, harassing, or doxxing language toward any legislator, staffer, or family member</li>
          <li>· Vendor advertising in campaign emails, forum posts, or DMs</li>
          <li>· Submitting false personal stories or fabricated medical claims</li>
          <li>· Attempting to scrape, bot, or automate platform actions</li>
          <li>· Sharing minors&apos; PII (yours, theirs, anyone&apos;s)</li>
          <li>· Sharing misinformation about kratom safety / pharmacology / legality</li>
        </ul>
      </div>

      <p className="mt-4 text-sm text-zinc-300">
        We don&apos;t need a hundred fake accounts spamming legislators. We need a hundred
        real constituents writing one good email each. The first plays into every
        narrative used against the kratom community. The second is what changed AKA&apos;s
        outcome in 2016 and what works now.
      </p>

      <p className="mt-3 text-sm text-zinc-300">
        We will cooperate with any legitimate law-enforcement inquiry into harassment,
        threats, or impersonation. We will <strong className="text-zinc-100">not</strong> share
        platform data for commercial use, marketing, or political profiling. The
        full posture is in <a href="/privacy" className="text-emerald-400 hover:underline">/privacy</a>.
      </p>
    </Block>
  );
}

function FbMigration() {
  return (
    <Block title="If you're coming from Facebook" eyebrow="05 — Easy migration">
      <p>
        Most kratom advocates already organize on Facebook. iKratom doesn&apos;t try to
        replace that — we just give you a place where the action work actually
        happens cleanly. Three things make migration low-friction:
      </p>
      <ol className="mt-4 space-y-3 text-sm text-zinc-300">
        <li>
          <strong className="text-zinc-100">1. You don&apos;t have to leave FB.</strong>{" "}
          Use both. iKratom for actions and tracking; FB for daily community.
          Every campaign on iKratom has a one-click <em>Share to Facebook</em> button —
          drop it into your FB group when something hits.
        </li>
        <li>
          <strong className="text-zinc-100">2. We don&apos;t sync your friends list.</strong>{" "}
          By design. We&apos;re not building a social graph. Your FB friends are yours.
          Bring whoever you want by sharing a link, not by giving us a contact dump.
        </li>
        <li>
          <strong className="text-zinc-100">3. Your story stays yours.</strong>{" "}
          Anonymous posting is supported. State-only display (city/state visible,
          street never). DMs end-to-end encrypted. We&apos;d rather have fewer users
          who feel safe than more users who don&apos;t.
        </li>
      </ol>

      <Note>
        <strong>Got a kratom community on FB?</strong> Pin a post linking
        to a state-specific iKratom campaign. When a bill drops, you become the
        person who organized the response, not the person reposting headlines.
      </Note>

      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Invite specific people you trust
        </p>
        <HowItWorksInvite />
      </div>
    </Block>
  );
}

/**
 * Lightweight wrapper that prefers the signed-in user's personal invite
 * URL (gets them attribution credit) and falls back to the unattributed
 * homepage URL for signed-out visitors.
 */
async function HowItWorksInvite() {
  const summary = await getMyInviteSummary();
  const url = summary?.invite_code
    ? await buildInviteUrl(summary.invite_code)
    : (process.env.APP_URL ?? "https://www.ikratom.org");
  return <InviteFriends inviteUrl={url} />;
}

function ForLeaders() {
  return (
    <section className="mt-16 rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">For leaders + admins</p>
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
  );
}

function CTA() {
  return (
    <section className="mt-12 rounded-lg border-2 border-emerald-700/50 bg-gradient-to-br from-emerald-950/30 to-zinc-950/40 p-8 text-center">
      <h2 className="text-2xl font-bold sm:text-3xl">Stop yelling in the wind.</h2>
      <p className="mx-auto mt-3 max-w-xl text-zinc-300">
        Sign up takes 30 seconds. Connect your Gmail and you&apos;re sending personalized legislator emails by your second click.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <a href="/signup" className="rounded-md bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 hover:bg-emerald-400">Join the war room →</a>
        <a href="/campaigns" className="rounded-md border border-zinc-700 px-6 py-3 font-semibold hover:border-emerald-500 hover:text-emerald-400">Browse campaigns first</a>
      </div>
    </section>
  );
}

// ── Reusable bits ────────────────────────────────────────────────

function Block({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-16">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-bold sm:text-3xl">{title}</h2>
      <div className="mt-5 space-y-4 text-zinc-300">{children}</div>
    </section>
  );
}

function Cap({ title, body, img }: { title: string; body: string; img: string }) {
  return (
    <div className="mt-6 grid gap-5 sm:grid-cols-[1fr_1.4fr] sm:items-center">
      <div>
        <h3 className="text-lg font-bold">{title}</h3>
        <p className="mt-1 text-sm text-zinc-300">{body}</p>
      </div>
      <a href={img} target="_blank" rel="noreferrer" className="block">
        <Screenshot src={img} alt={title} />
      </a>
    </div>
  );
}

function CapAnnotated({
  title, body, src, pins,
}: { title: string; body: string; src: string; pins: Pin[] }) {
  return (
    <div className="mt-6 grid gap-5 sm:grid-cols-[1fr_1.4fr] sm:items-start">
      <div>
        <h3 className="text-lg font-bold">{title}</h3>
        <p className="mt-1 text-sm text-zinc-300">{body}</p>
      </div>
      <AnnotatedScreenshot src={src} alt={title} pins={pins} />
    </div>
  );
}

function CapStep({ n, caption, img }: { n: string; caption: string; img: string }) {
  return (
    <a href={img} target="_blank" rel="noreferrer" className="block">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="flex items-center gap-2 px-2 py-1 text-xs">
          <span className="font-mono text-emerald-400">{n}</span>
          <span className="text-zinc-300">{caption}</span>
        </div>
        <Screenshot src={img} alt={caption} />
      </div>
    </a>
  );
}

function Screenshot({ src, alt }: { src: string; alt: string }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="w-full rounded-md border border-zinc-800 bg-zinc-950"
    />
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-300">
      {children}
    </p>
  );
}

function ListBox({ tone, title, items }: { tone: "good" | "bad"; title: string; items: string[] }) {
  const cls = tone === "good"
    ? "border-emerald-700/40 bg-emerald-950/10"
    : "border-red-900/40 bg-red-950/10";
  return (
    <div className={`rounded-lg border p-5 ${cls}`}>
      <h3 className="text-base font-bold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((it, i) => (
          <li key={i} className="text-zinc-200">{it}</li>
        ))}
      </ul>
    </div>
  );
}
