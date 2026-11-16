import { createServiceRoleClient } from "@/lib/supabase/service-role";

type Edit = {
  id: string;
  target_type: string;
  thread_id: string;
  action: string;
  editor_id: string | null;
  editor_role: string;
  previous_title: string | null;
  previous_body: string | null;
  created_at: string;
};

/**
 * The last 25 edits and deletes, with the words as they stood before. This is
 * how a moderator catches a post that was rewritten after it was approved. The
 * caller has already checked moderate_forum.
 */
export async function RecentEdits() {
  const sr = createServiceRoleClient();
  const { data } = await sr
    .from("forum_edits")
    .select("id, target_type, thread_id, action, editor_id, editor_role, previous_title, previous_body, created_at")
    .order("created_at", { ascending: false })
    .limit(25);
  const edits = (data ?? []) as Edit[];
  if (edits.length === 0) return null;

  const editorIds = [...new Set(edits.map((e) => e.editor_id).filter((id): id is string => !!id))];
  const threadIds = [...new Set(edits.map((e) => e.thread_id))];
  const [{ data: editors }, { data: threads }] = await Promise.all([
    sr.from("profiles").select("id, username").in("id", editorIds),
    sr.from("forum_threads").select("id, state").in("id", threadIds),
  ]);
  const names = new Map((editors ?? []).map((p) => [p.id as string, p.username as string | null]));
  const stateOf = new Map((threads ?? []).map((t) => [t.id as string, t.state as string | null]));

  return (
    <section className="mt-10">
      <h2 className="mb-1 text-lg font-semibold">Recent edits and deletes</h2>
      <p className="mb-3 text-xs text-zinc-500">The words as they stood before the change.</p>
      <ul className="space-y-2">
        {edits.map((e) => {
          const who = e.editor_id ? names.get(e.editor_id) : null;
          return (
            <li key={e.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-zinc-500">
                <span className="font-medium text-zinc-300">{who ? `@${who}` : "(no handle)"}</span>
                <span>
                  {e.action === "delete" ? "deleted" : "edited"} a {e.target_type}
                  {e.editor_role === "moderator" && " as a moderator"}
                </span>
                <span>· {new Date(e.created_at).toLocaleString()}</span>
                <a
                  href={`/forum/${stateOf.get(e.thread_id) ?? "national"}/${e.thread_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-emerald-400 hover:underline"
                >
                  View ↗
                </a>
              </div>
              {e.previous_title && <p className="mt-2 font-semibold text-zinc-300">{e.previous_title}</p>}
              {e.previous_body && (
                <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-zinc-400">{e.previous_body}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
