export const metadata = { title: "Kratom communities" };

const COMMUNITIES = {
  facebook: [
    { name: "American Kratom Association", href: "https://www.facebook.com/AmericanKratomAssociation/", desc: "Largest national advocacy org. Action alerts + state-by-state updates." },
    { name: "Global Kratom Coalition", href: "https://www.facebook.com/globalkratomcoalition/", desc: "Industry-aligned advocacy + regulatory news." },
    { name: "Kratom United (FB Group)", href: "https://www.facebook.com/groups/kratomunited/", desc: "Open community group. Personal stories + advocacy chatter." },
    { name: "Kratom Science (FB)", href: "https://www.facebook.com/kratomscienceofficial/", desc: "Research-focused content from the Kratom Science Podcast team." },
  ],
  reddit: [
    { name: "r/kratom", href: "https://reddit.com/r/kratom", desc: "Largest English-language kratom subreddit. Strain talk + general discussion." },
    { name: "r/quittingkratom", href: "https://reddit.com/r/quittingkratom", desc: "Honest space about cessation — important context for advocacy." },
    { name: "r/KratomKentucky", href: "https://reddit.com/r/KratomKentucky", desc: "State-level subreddit; legislative updates." },
  ],
  discord: [
    { name: "Kratom Science Discord", href: "https://discord.gg/kratomscience", desc: "Most-active English kratom Discord. Research + community." },
  ],
  podcast: [
    { name: "Kratom Science Podcast", href: "https://kratomscience.com/", desc: "Long-form interviews with researchers, advocates, legislators." },
    { name: "Leaf of Life Wellness", href: "https://www.leafoflifewellness.com/", desc: "Stories from the kratom community + advocacy interviews." },
  ],
} as const;

export default function CommunitiesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Find your people
        </p>
        <h1 className="mt-2 text-4xl font-bold sm:text-5xl">
          The kratom community lives in a lot of places
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-zinc-400">
          iKratom is the war room for organized advocacy work. But the conversations,
          friendships, and informal coordination happen across the platforms below
          too. Use them. Bring people back here when there&apos;s an action to take.
        </p>
      </header>

      <Section title="Facebook" items={COMMUNITIES.facebook} note="FB is where most kratom advocates already live. iKratom doesn't try to replace that — we just give you a place to take coordinated action when something drops, and share back to your group." />
      <Section title="Reddit" items={COMMUNITIES.reddit} />
      <Section title="Discord" items={COMMUNITIES.discord} />
      <Section title="Podcasts + media" items={COMMUNITIES.podcast} />

      <section className="mt-10 rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-6">
        <h2 className="text-lg font-bold text-emerald-300">Know a community we should list?</h2>
        <p className="mt-2 text-sm text-zinc-300">
          We curate this page manually to keep it actually useful (no spam vendors, no dead Discord servers).
          Send a suggestion to <a href="mailto:ohjustadam@proton.me" className="text-emerald-400 hover:underline">ohjustadam@proton.me</a>.
        </p>
      </section>
    </div>
  );
}

function Section({
  title, items, note,
}: {
  title: string;
  items: readonly { name: string; href: string; desc: string }[];
  note?: string;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h2>
      {note && <p className="mb-3 text-xs text-zinc-400">{note}</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((c) => (
          <li key={c.href}>
            <a
              href={c.href}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 transition hover:border-emerald-500"
            >
              <div className="font-semibold text-zinc-100">{c.name}</div>
              <p className="mt-1 text-sm text-zinc-400">{c.desc}</p>
              <p className="mt-2 truncate font-mono text-[10px] text-zinc-600">{c.href}</p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
