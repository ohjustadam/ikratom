import Link from "@/components/Link";

/**
 * The home page's map of the site (owner, 10-27: "make the homepage a source and
 * backbone for the rest of the site and easy to navigate"). One tile per main
 * area, so a first-time visitor sees everything iKratom does in one glance.
 */
const TILES: { href: string; icon: string; title: string; body: string; isNew?: boolean }[] = [
  { href: "/connect", icon: "🤝", title: "Groups and friends", body: "Join or start a local group, add friends", isNew: true },
  { href: "/campaigns", icon: "⚡", title: "Take action", body: "Email your officials in one click" },
  { href: "/bills", icon: "📜", title: "Bills", body: "Every kratom bill, tracked daily" },
  { href: "/banned", icon: "🚫", title: "Where it's banned", body: "States, counties and cities" },
  { href: "/legislators", icon: "🏛️", title: "Your officials", body: "Who represents you, and their record" },
  { href: "/briefings", icon: "🚨", title: "Special reports", body: "Plain-English explainers with sources" },
  { href: "/news", icon: "📰", title: "News", body: "Kratom news without the ads" },
  { href: "/forum", icon: "💬", title: "Forum and Lounge", body: "Talk with advocates in your state" },
  { href: "/calendar", icon: "📅", title: "Hearings and events", body: "What's on the agenda, and when" },
  { href: "/intel", icon: "◉", title: "Intel hub", body: "Who's pushing policy, and how" },
  { href: "/academy", icon: "🎓", title: "Academy", body: "Learn to advocate, get certified" },
  { href: "/spread", icon: "🏪", title: "For shops", body: "Free QR poster for your counter" },
];

export function HomeHubGrid() {
  return (
    <section className="mt-8" aria-labelledby="home-hub">
      <h2 id="home-hub" className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
        Everything on iKratom
      </h2>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {TILES.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className={`block h-full rounded-lg border p-3 transition hover:border-emerald-500 ${
                t.isNew ? "border-emerald-700/60 bg-emerald-950/20" : "border-zinc-800 bg-zinc-950/40"
              }`}
            >
              <p className="text-sm font-semibold text-zinc-100">
                <span className="mr-1.5" aria-hidden>{t.icon}</span>
                {t.title}
                {t.isNew && <span className="ml-1.5 rounded bg-emerald-500 px-1 py-px text-[9px] font-bold uppercase text-zinc-950">New</span>}
              </p>
              <p className="mt-0.5 text-xs text-zinc-400">{t.body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
