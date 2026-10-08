import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { ModerationActions } from "./ModerationActions";
import { BulkBar } from "./BulkBar";

export const metadata = { title: "Forum moderation" };

const FLAG_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending review", cls: "bg-amber-950/40 text-amber-300" },
  auto_flagged: { label: "Auto-flagged", cls: "bg-red-950/40 text-red-300" },
  user_flagged: { label: "User-reported", cls: "bg-orange-950/40 text-orange-300" },
};

type FlaggedThread = {
  id: string;
  state: string | null;
  title: string;
  body: string | null;
  author_id: string | null;
  moderation_status: string;
  flag_reason: string | null;
  auto_flag_signals: unknown;
  created_at: string;
};

type FlaggedPost = {
  id: string;
  thread_id: string;
  author_id: string | null;
  body: string;
  moderation_status: string;
  flag_reason: string | null;
  auto_flag_signals: unknown;
  created_at: string;
};

type Report = {
  id: string;
  post_id: string | null;
  thread_id: string | null;
  reporter_id: string;
  reason_category: string | null;
  reason: string;
  created_at: string;
};

export default async function ForumModerationPage() {
  const ctx = await getCreatorContext({ require: "moderate_forum" });
  if (!ctx.ok) redirect("/dashboard");

  const supabase = await createClient();
  const FLAGGED = ["pending", "auto_flagged", "user_flagged"];

  const [
    { data: threadsRaw },
    { data: postsRaw },
    { data: reportsRaw },
  ] = await Promise.all([
    supabase
      .from("forum_threads")
      .select("id, state, title, body, author_id, moderation_status, flag_reason, auto_flag_signals, created_at")
      .in("moderation_status", FLAGGED)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("forum_posts")
      .select("id, thread_id, author_id, body, moderation_status, flag_reason, auto_flag_signals, created_at")
      .in("moderation_status", FLAGGED)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("forum_post_reports")
      .select("id, post_id, thread_id, reporter_id, reason_category, reason, created_at")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const threads = (threadsRaw ?? []) as unknown as FlaggedThread[];
  const posts = (postsRaw ?? []) as unknown as FlaggedPost[];
  const reports = (reportsRaw ?? []) as unknown as Report[];

  // Group reports by target id
  const reportsByPost = new Map<string, Report[]>();
  const reportsByThread = new Map<string, Report[]>();
  for (const r of reports) {
    if (r.post_id) {
      if (!reportsByPost.has(r.post_id)) reportsByPost.set(r.post_id, []);
      reportsByPost.get(r.post_id)!.push(r);
    } else if (r.thread_id) {
      if (!reportsByThread.has(r.thread_id)) reportsByThread.set(r.thread_id, []);
      reportsByThread.get(r.thread_id)!.push(r);
    }
  }

  // Pull author names for everything in one round-trip
  const authorIds = new Set<string>();
  for (const t of threads) if (t.author_id) authorIds.add(t.author_id);
  for (const p of posts) if (p.author_id) authorIds.add(p.author_id);
  const { data: authorRows } = authorIds.size > 0
    ? await supabase.from("profiles").select("id, full_name, forum_post_count").in("id", Array.from(authorIds))
    : { data: [] };
  const authors = new Map(
    (authorRows ?? []).map((a: { id: string; full_name: string | null; forum_post_count: number | null }) => [
      a.id,
      { name: a.full_name ?? "(no name)", postCount: a.forum_post_count ?? 0 },
    ]),
  );

  const total = threads.length + posts.length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Forum moderation</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {total === 0 ? (
            "Queue is empty — nothing pending review."
          ) : (
            <>
              {total} item{total === 1 ? "" : "s"} need{total === 1 ? "s" : ""} review
              {threads.length > 0 && <> · {threads.length} thread{threads.length === 1 ? "" : "s"}</>}
              {posts.length > 0 && <> · {posts.length} post{posts.length === 1 ? "" : "s"}</>}
            </>
          )}
        </p>
      </header>

      {total === 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
          <p className="text-3xl">✓</p>
          <p className="mt-2">All caught up. New flags will appear here.</p>
        </div>
      )}

      {total > 0 && <BulkBar />}

      {threads.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">Threads ({threads.length})</h2>
          <ul className="space-y-3">
            {threads.map((t) => {
              const author = t.author_id ? authors.get(t.author_id) : null;
              const tag = FLAG_LABEL[t.moderation_status] ?? { label: t.moderation_status, cls: "bg-zinc-900 text-zinc-400" };
              const tReports = reportsByThread.get(t.id) ?? [];
              return (
                <li key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      data-mod-select=""
                      data-mod-kind="thread"
                      data-mod-id={t.id}
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                      aria-label="Select thread for bulk action"
                    />
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${tag.cls}`}>{tag.label}</span>
                    {t.state && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">{t.state}</span>}
                    <span className="text-zinc-500">{new Date(t.created_at).toLocaleString()}</span>
                  </div>
                  <h3 className="mt-2 font-semibold">{t.title}</h3>
                  {t.body && (
                    <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-900 bg-zinc-950 p-3 text-xs text-zinc-300">
                      {t.body}
                    </p>
                  )}
                  <Meta
                    author={author}
                    authorId={t.author_id}
                    flagReason={t.flag_reason}
                    signals={t.auto_flag_signals}
                    reports={tReports}
                  />
                  <ModerationActions targetType="thread" targetId={t.id} />
                  <a
                    href={`/forum/${t.state ?? "national"}/${t.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-3 inline-block text-xs text-emerald-400 hover:underline"
                  >
                    View thread ↗
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {posts.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Posts ({posts.length})</h2>
          <ul className="space-y-3">
            {posts.map((p) => {
              const author = p.author_id ? authors.get(p.author_id) : null;
              const tag = FLAG_LABEL[p.moderation_status] ?? { label: p.moderation_status, cls: "bg-zinc-900 text-zinc-400" };
              const pReports = reportsByPost.get(p.id) ?? [];
              return (
                <li key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      data-mod-select=""
                      data-mod-kind="post"
                      data-mod-id={p.id}
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                      aria-label="Select post for bulk action"
                    />
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${tag.cls}`}>{tag.label}</span>
                    <span className="text-zinc-500">{new Date(p.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-900 bg-zinc-950 p-3 text-sm text-zinc-200">
                    {p.body}
                  </p>
                  <Meta
                    author={author}
                    authorId={p.author_id}
                    flagReason={p.flag_reason}
                    signals={p.auto_flag_signals}
                    reports={pReports}
                  />
                  <ModerationActions targetType="post" targetId={p.id} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Meta({
  author, authorId, flagReason, signals, reports,
}: {
  author: { name: string; postCount: number } | null | undefined;
  authorId: string | null;
  flagReason: string | null;
  signals: unknown;
  reports: Report[];
}) {
  return (
    <div className="mt-3 space-y-1.5 text-xs text-zinc-400">
      {author && authorId && (
        <p>
          Author:{" "}
          <a href={`/profile/${authorId}`} target="_blank" rel="noreferrer" className="text-zinc-200 hover:text-emerald-400">
            {author.name}
          </a>
          <span className="ml-2 text-zinc-600">
            ({author.postCount} approved post{author.postCount === 1 ? "" : "s"})
          </span>
        </p>
      )}
      {flagReason && (
        <p>
          <span className="text-zinc-600">Reason: </span>
          {flagReason}
        </p>
      )}
      {signals != null && Object.keys(signals as object).length > 0 && (
        <details className="ml-1">
          <summary className="cursor-pointer text-zinc-500">Signals</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-zinc-950 p-2 text-[10px] text-zinc-500">
            {JSON.stringify(signals, null, 2)}
          </pre>
        </details>
      )}
      {reports.length > 0 && (
        <details className="ml-1" open>
          <summary className="cursor-pointer text-orange-400">
            {reports.length} user report{reports.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 space-y-1">
            {reports.map((r) => (
              <li key={r.id} className="text-zinc-500">
                <span className="font-mono text-orange-300">[{r.reason_category}]</span> {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
