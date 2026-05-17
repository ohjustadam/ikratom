import { listPublicStories } from "@/modules/stories/actions";
import { STORY_TAG_LABELS } from "@/modules/stories/labels";
import { createClient } from "@/lib/supabase/server";
import { PageShareWithAttribution } from "@/components/PageShareWithAttribution";

export const metadata = { title: "Story bank" };
export const dynamic = "force-dynamic";

type Story = {
  id: string;
  title: string;
  body: string;
  anonymous: boolean;
  display_name: string | null;
  state: string | null;
  tags: string[] | null;
  upvote_count: number;
  created_at: string;
};

export default async function StoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; tag?: string }>;
}) {
  const sp = await searchParams;
  const stories = (await listPublicStories({
    state: sp.state?.toUpperCase(),
    tag: sp.tag,
    limit: 50,
  })) as unknown as Story[];

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            The story bank
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
            Why kratom matters — in our own words
          </h1>
          <p className="mt-3 text-zinc-400">
            Real stories from real advocates. Use them in letters to legislators —
            a paragraph from a constituent who got their life back beats a hundred
            talking points. All stories are member-submitted and reviewed before
            posting.
          </p>
          <div className="mt-5">
            <a
              href={user ? "/stories/new" : "/login?redirect=/stories/new"}
              className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              Share your story →
            </a>
          </div>
        </div>
        <PageShareWithAttribution
          path="/stories"
          title="iKratom stories — why kratom matters, in advocates' own words"
          summary="First-person stories from real kratom advocates. Use them in letters to your legislators."
        />
      </header>

      {/* Filter chips */}
      <div className="mb-6 flex flex-wrap gap-2 text-xs">
        <a
          href="/stories"
          className={`rounded-full px-3 py-1 transition ${
            !sp.tag && !sp.state
              ? "bg-emerald-500 font-semibold text-zinc-950"
              : "border border-zinc-800 text-zinc-400 hover:border-emerald-500"
          }`}
        >
          All
        </a>
        {Object.entries(STORY_TAG_LABELS).map(([key, label]) => (
          <a
            key={key}
            href={`/stories?tag=${key}`}
            className={`rounded-full px-3 py-1 capitalize transition ${
              sp.tag === key
                ? "bg-emerald-500 font-semibold text-zinc-950"
                : "border border-zinc-800 text-zinc-400 hover:border-emerald-500"
            }`}
          >
            {label}
          </a>
        ))}
      </div>

      {stories.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
          <p className="text-3xl">📖</p>
          <h2 className="mt-3 text-lg font-semibold">No stories yet</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Be the first to share why kratom matters to you.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {stories.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-zinc-200">
                  {s.anonymous ? "Anonymous" : s.display_name ?? "Member"}
                </span>
                {s.state && (
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                    {s.state}
                  </span>
                )}
                {(s.tags ?? []).map((t) => (
                  <span
                    key={t}
                    className="rounded bg-emerald-950/40 px-1.5 py-0.5 capitalize text-emerald-300"
                  >
                    {STORY_TAG_LABELS[t] ?? t}
                  </span>
                ))}
                <span className="ml-auto text-zinc-500">
                  {new Date(s.created_at).toLocaleDateString()}
                </span>
              </div>
              <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-zinc-300">
                {s.body}
              </p>
              <div className="mt-3">
                <a
                  href={`/campaigns?story=${s.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500"
                >
                  📨 Use this story in a letter →
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
