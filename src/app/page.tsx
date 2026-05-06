import { siteConfig } from "@/config/site.config";
import { createClient } from "@/lib/supabase/server";
import { USMap } from "@/components/USMap";
import { ImpactStats } from "@/components/ImpactStats";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: states } = await supabase
    .from("states")
    .select("abbr, kratom_status");
  const statusByAbbr: Record<string, string> = {};
  for (const s of states ?? []) {
    if (s.kratom_status) statusByAbbr[s.abbr] = s.kratom_status;
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
      {/* Hero */}
      <section className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          The advocate&apos;s toolbelt
        </p>
        <h1 className="mt-4 text-5xl font-bold leading-tight sm:text-6xl">
          Strap in. Send <span className="text-emerald-400">100 emails</span>{" "}
          across <span className="text-emerald-400">50 states</span> in one click.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
          {siteConfig.description}
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <a
            href="/signup"
            className="rounded-md bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Join the war room
          </a>
          <a
            href="/campaigns"
            className="rounded-md border border-zinc-700 px-6 py-3 font-semibold hover:border-emerald-500 hover:text-emerald-400"
          >
            Browse active campaigns
          </a>
          <a
            href="/how-it-works"
            className="rounded-md border border-zinc-700 px-6 py-3 font-semibold hover:border-emerald-500 hover:text-emerald-400"
          >
            See what it does
          </a>
        </div>
      </section>

      {/* Live impact dashboard — hides itself if no data yet */}
      <ImpactStats />

      {/* Pillars */}
      <section className="mt-24 grid gap-6 sm:grid-cols-3">
        <Pillar
          title="One-click action"
          body="Your info autofills. Click once, send personalized emails to every legislator that matters. Hours of work in two minutes."
        />
        <Pillar
          title="Real-time intelligence"
          body="Bill tracking, contact info, and news scraped daily. State-by-state. Never out of date."
        />
        <Pillar
          title="Built for the community"
          body="Nonpartisan. Independent. Not owned by any org. A tool for anyone who wants kratom to stay legal."
        />
      </section>

      {/* Map */}
      <section className="mt-24">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Where it stands
            </p>
            <h2 className="mt-1 text-2xl font-bold sm:text-3xl">
              The state of kratom legality
            </h2>
          </div>
          <a
            href="/forum"
            className="text-sm text-emerald-400 hover:underline"
          >
            Forums by state →
          </a>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 sm:p-6">
          <USMap statusByAbbr={statusByAbbr} />
        </div>
      </section>

      {/* Manifesto strip */}
      <section className="mt-24 rounded-lg border border-zinc-800 bg-zinc-950/60 p-8 sm:p-12">
        <h2 className="text-2xl font-bold sm:text-3xl">
          We&apos;re not yelling in the wind anymore.
        </h2>
        <p className="mt-4 text-zinc-400">
          The kratom advocacy community stalled out when the social platforms broke up
          our momentum. iKratom is a war room — built outside Facebook, outside Discord,
          outside any single org. A weapon for everyone who wants to put it on.
        </p>
      </section>
    </div>
  );
}

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      <h3 className="text-lg font-semibold text-emerald-400">{title}</h3>
      <p className="mt-2 text-sm text-zinc-400">{body}</p>
    </div>
  );
}
