import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { listPendingStoriesForAdmin } from "@/modules/stories/actions";
import { STORY_TAG_LABELS } from "@/modules/stories/labels";
import { ModerateRow } from "./ModerateRow";

export const metadata = { title: "Story moderation" };
export const dynamic = "force-dynamic";

type PendingStory = {
  id: string;
  author_id: string;
  title: string;
  body: string;
  anonymous: boolean;
  display_name: string | null;
  state: string | null;
  tags: string[] | null;
  created_at: string;
};

export default async function AdminStoriesPage() {
  const ctx = await getCreatorContext({ require: "moderate_stories" });
  if (!ctx.ok) redirect("/dashboard");
  const stories = (await listPendingStoriesForAdmin()) as unknown as PendingStory[];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Story moderation</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {stories.length === 0
            ? "Queue is empty."
            : `${stories.length} ${stories.length === 1 ? "story" : "stories"} pending review.`}
        </p>
      </header>

      {stories.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
          <p className="text-3xl">✓</p>
          <p className="mt-2">All caught up.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {stories.map((s) => (
            <li key={s.id} className="rounded-lg border border-amber-700/40 bg-amber-950/10 p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                  PENDING
                </span>
                <span className="font-semibold text-zinc-200">
                  {s.anonymous ? "(anonymous)" : s.display_name ?? "Member"}
                </span>
                {s.state && (
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                    {s.state}
                  </span>
                )}
                {(s.tags ?? []).map((t) => (
                  <span
                    key={t}
                    className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400"
                  >
                    {STORY_TAG_LABELS[t] ?? t}
                  </span>
                ))}
                <span className="ml-auto text-zinc-500">
                  {new Date(s.created_at).toLocaleString()}
                </span>
              </div>
              <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-line rounded-md border border-zinc-900 bg-zinc-950 p-3 text-sm leading-relaxed text-zinc-300">
                {s.body}
              </p>
              <p className="mt-2 text-[10px] text-zinc-600">
                Author: <a href={`/profile/${s.author_id}`} target="_blank" rel="noreferrer" className="font-mono hover:text-zinc-400">{s.author_id.slice(0, 8)}</a>
              </p>
              <div className="mt-3">
                <ModerateRow storyId={s.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
