import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata = { title: "iKratom — Your seat at the table" };
export const dynamic = "force-dynamic";

/**
 * HOME PAGE DRAFT B — "RECRUITMENT / PERSONAL" direction.
 *
 * Voice: a thoughtful friend who's been doing this for years and is
 * inviting you to their kitchen table. Personal hooks, what you'll
 * get, social proof in the form of stories not stats.
 *
 * Strengths: warm, converts visitors who came in skeptical or
 * undecided, shows we're a community not a database.
 * Risks: relies on having stories to surface (we have a few). Less
 * scannable than (A); less action-now than (C).
 */
export default async function HomeB() {
  const supabase = await createClient();

  const [{ count: members }, { count: actions }, { count: campaigns }, { data: stories }] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("campaign_actions").select("id", { count: "exact", head: true }),
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("kratom_stories")
      .select("id, title, body, anonymous, display_name, state, created_at")
      .eq("moderation_status", "approved")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Hero — slow-down voice */}
      <section className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          For people whose lives kratom touched
        </p>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
          You showed up. You made it work.<br/>
          <span className="text-emerald-400">Now we&apos;re going to keep it legal.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-zinc-300">
          Every state where kratom is still legal, it&apos;s legal because someone
          showed up — wrote letters, called offices, brought their story to a
          hearing. iKratom is the toolkit that turns hours of that work into
          minutes a day.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Take your seat at the table →
          </Link>
          <Link
            href="/stories"
            className="rounded-md border border-zinc-700 px-6 py-3 font-semibold hover:border-emerald-500 hover:text-emerald-400"
          >
            Read other people&apos;s stories
          </Link>
        </div>

        <p className="mt-6 text-xs text-zinc-500">
          {members?.toLocaleString() ?? 0} advocates · {actions?.toLocaleString() ?? 0} actions sent · {campaigns?.toLocaleString() ?? 0} live campaigns
        </p>
      </section>

      {/* What you actually get — three concrete things */}
      <section className="mt-20 grid gap-6 sm:grid-cols-3">
        <Card
          icon="📨"
          title="One-click letters"
          body="Real bill comes up — we draft the email to your specific reps, prefilled with your address and any story you want to share. You read, edit, send. Two minutes."
        />
        <Card
          icon="🛰️"
          title="Field intel that finds you"
          body="When a city council in your state schedules a kratom vote, you find out the same hour. Push notifications, weekly digest, or both — your call."
        />
        <Card
          icon="🤝"
          title="Your people are already here"
          body="State forums, topical communities (Veterans, Shop owners, Caregivers), and a chat room that's actually populated. Quiet some days, urgent others."
        />
      </section>

      {/* Stories — social proof done right */}
      {(stories?.length ?? 0) > 0 && (
        <section className="mt-20">
          <h2 className="text-center text-2xl font-bold">Real stories from advocates</h2>
          <p className="mt-2 text-center text-sm text-zinc-400">
            Hand-written. Not synthesized. We don&apos;t do AI hype here.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {(stories ?? []).map((s) => {
              const author = s.anonymous ? "An iKratom advocate" : (s.display_name ?? "An advocate");
              return (
                <Link
                  key={s.id}
                  href="/stories"
                  className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 transition hover:border-emerald-500"
                >
                  <p className="text-xs uppercase tracking-wider text-emerald-400">
                    {author}{s.state ? ` · ${s.state}` : ""}
                  </p>
                  <h3 className="mt-2 font-semibold leading-tight">{s.title}</h3>
                  <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-zinc-400">
                    &ldquo;{s.body}&rdquo;
                  </p>
                  <p className="mt-3 text-[11px] text-emerald-400">Read more →</p>
                </Link>
              );
            })}
          </div>
          <div className="mt-6 text-center">
            <Link href="/stories" className="text-sm text-emerald-400 hover:underline">
              All stories →
            </Link>
          </div>
        </section>
      )}

      {/* Soft pitch close */}
      <section className="mt-20 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-8 text-center">
        <p className="text-2xl font-bold leading-snug">
          We don&apos;t need a million people.<br/>
          We need the right ones — paying attention.
        </p>
        <p className="mx-auto mt-4 max-w-xl text-sm text-zinc-300">
          Free forever. Nonpartisan. No org politics. Built by an advocate, for advocates.
        </p>
        <Link
          href="/signup"
          className="mt-6 inline-block rounded-md bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Sign up — takes 90 seconds →
        </Link>
      </section>
    </div>
  );
}

function Card({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      <p className="text-3xl">{icon}</p>
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}
