import Link from "@/components/Link";
import { PageShareWithAttribution } from "@/components/PageShareWithAttribution";

export const metadata = {
  title: "Connect: groups, friends and your profile · iKratom",
  description:
    "Advocacy is easier together. Start or join a local group, add friends, and choose exactly who sees what. Free, @username only.",
};

/**
 * /connect — the one page that explains iKratom's social side (owner, 10-27:
 * "an exclusive groups and social explanation page ... easy social connection,
 * easy to become members"). Static on purpose: the same words for every visitor,
 * no cookie reads, so it prerenders and costs nothing per view.
 */
type Feature = { icon: string; title: string; body: string };
type Section = { id: string; kicker: string; title: string; intro: string; features: Feature[]; links: { href: string; label: string }[] };

const SECTIONS: Section[] = [
  {
    id: "groups",
    kicker: "Groups",
    title: "Organize your town, county or state",
    intro: "A group is your local crew: private or public, with everything you need to act together in one place.",
    features: [
      { icon: "🔗", title: "One invite link and QR", body: "Text it, post it or print it. It never runs out." },
      { icon: "💬", title: "Live group chat", body: "Talk in real time, members only." },
      { icon: "🗂", title: "Discussion board", body: "Threads that don't scroll away." },
      { icon: "📅", title: "Events and call-in days", body: "Reminders the day before and an add-to-calendar button." },
      { icon: "🎯", title: "The group action of the week", body: "One campaign, one progress bar that counts actions, never names." },
      { icon: "📌", title: "Resources and testimony templates", body: "Pinned links and ready letters that open the email composer." },
      { icon: "🏅", title: "Wins, badges and an opt-in leaderboard", body: "See the group's impact. The leaderboard is off unless you join it." },
      { icon: "🗺", title: "District captains and a coverage map", body: "Make sure every district has someone on it. Counts only." },
    ],
    links: [
      { href: "/coalitions", label: "Find a group" },
      { href: "/coalitions/new", label: "Start a group" },
    ],
  },
  {
    id: "profile",
    kicker: "Your profile and friends",
    title: "Be a person, not a mailing list",
    intro: "A profile under your @username: a photo, a cover, an album and a wall, shared with exactly who you choose.",
    features: [
      { icon: "🙂", title: "Profile photo, cover and album", body: "Location data is stripped from every photo you upload." },
      { icon: "📝", title: "Your wall", body: "Posts and comments from you and your friends." },
      { icon: "🤝", title: "Friends", body: "Send a request, accept, or block. Your friends list is yours to show or hide." },
      { icon: "🔒", title: "You pick the audience", body: "Only me, Friends, Members or Public, section by section, with a live preview." },
    ],
    links: [
      { href: "/account/profile", label: "Set up your profile" },
      { href: "/account/privacy", label: "Privacy settings" },
      { href: "/account/connections", label: "Your friends" },
    ],
  },
  {
    id: "talk",
    kicker: "Talk",
    title: "Every conversation in one place",
    intro: "Ask questions, share news and keep each other going.",
    features: [
      { icon: "🛋", title: "The Lounge", body: "Live chat for the whole community, at the top of the forum." },
      { icon: "🏛", title: "State forums", body: "A board for every state's bills and local fights." },
      { icon: "✉️", title: "Private messages", body: "One-to-one or in a small group." },
      { icon: "📖", title: "Stories and videos", body: "Real experiences that officials need to hear." },
    ],
    links: [
      { href: "/forum", label: "Open the forum" },
      { href: "/messages", label: "Messages" },
      { href: "/stories", label: "Stories" },
    ],
  },
];

const SAFETY = [
  "Everyone appears as @username. Your real name and email are never shown to other members.",
  "Your real name is used in one place only: the letters you choose to send to your own officials.",
  "Every post, photo, message and profile has a report button, and moderators review each report.",
  "Block anyone, any time, from their profile.",
];

export default function ConnectPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">◉ Connect</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Advocacy is easier together</h1>
        <p className="mt-3 text-zinc-400">
          Join free, find the people near you, and act as a group. Everything here is free, nonpartisan, and
          @username only.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/signup" className="rounded-md bg-emerald-500 px-5 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-400">
            Join free (1 minute)
          </Link>
          <Link href="/coalitions" className="rounded-md border border-zinc-700 px-5 py-2.5 font-semibold hover:border-emerald-500 hover:text-emerald-400">
            Find a group
          </Link>
        </div>
        <nav className="mt-5 flex flex-wrap gap-2 text-xs">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full border border-zinc-800 px-3 py-1 text-zinc-400 hover:border-emerald-500 hover:text-emerald-400">
              {s.kicker}
            </a>
          ))}
          <a href="#safe" className="rounded-full border border-zinc-800 px-3 py-1 text-zinc-400 hover:border-emerald-500 hover:text-emerald-400">Safety</a>
        </nav>
      </header>

      <ol className="mt-8 grid gap-3 sm:grid-cols-3">
        {["Sign up free with your email.", "Add your state, so you see your fights and your officials.", "Join a group, or start one and share the invite link."].map((step, i) => (
          <li key={step} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-300">
            <span className="mr-2 font-bold text-emerald-400">{i + 1}</span>{step}
          </li>
        ))}
      </ol>

      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="mt-12 scroll-mt-20">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">{s.kicker}</p>
          <h2 className="mt-1 text-2xl font-bold">{s.title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">{s.intro}</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {s.features.map((f) => (
              <li key={f.title} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                <p className="font-semibold text-zinc-100"><span className="mr-2" aria-hidden>{f.icon}</span>{f.title}</p>
                <p className="mt-1 text-sm text-zinc-400">{f.body}</p>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            {s.links.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-md border border-emerald-700/50 px-4 py-2 text-sm font-semibold text-emerald-300 hover:border-emerald-400">
                {l.label} →
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section id="safe" className="mt-12 scroll-mt-20 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-xl font-bold">Safe by design</h2>
        <ul className="mt-3 space-y-2 text-sm text-zinc-300">
          {SAFETY.map((line) => <li key={line}>✓ {line}</li>)}
        </ul>
      </section>

      <section className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-emerald-800/50 bg-emerald-950/15 p-6">
        <div>
          <h2 className="text-xl font-bold">Bring one person</h2>
          <p className="mt-1 text-sm text-zinc-400">Every group starts with two. Share this page with someone who cares about kratom.</p>
        </div>
        <PageShareWithAttribution
          path="/connect"
          title="Connect on iKratom: groups, friends and your profile"
          summary="Start or join a local kratom advocacy group, add friends, and choose who sees what. Free."
        />
      </section>
    </div>
  );
}
