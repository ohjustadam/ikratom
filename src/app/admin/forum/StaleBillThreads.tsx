import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ModerationActions } from "./ModerationActions";

const QUIET_DAYS = 90;

/**
 * Old bill threads that members replied to. The bot's threads drop out of the
 * forum on their own, but one with a conversation under it is a person's call
 * (PJ, 2026-11-06): keep it by leaving it here, or take it down. The caller has
 * already checked moderate_forum.
 */
export async function StaleBillThreads() {
  const since = new Date(Date.now() - QUIET_DAYS * 86_400_000).toISOString();
  const { data } = await createServiceRoleClient()
    .from("forum_threads")
    .select("id, state, title, post_count, last_activity_at")
    .eq("system_generated", true)
    .eq("is_state_digest", false)
    .eq("moderation_status", "approved")
    .gt("post_count", 0)
    .lt("last_activity_at", since)
    .order("last_activity_at", { ascending: true })
    .limit(50);
  const threads = data ?? [];
  if (threads.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-1 text-lg font-semibold">Old bill threads with member replies</h2>
      <p className="mb-3 text-xs text-zinc-500">
        Quiet for {QUIET_DAYS}+ days. Leave one here to keep it, or remove it if the talk has run its course.
      </p>
      <ul className="space-y-2">
        {threads.map((t) => (
          <li key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
            <a
              href={`/forum/${t.state ?? "national"}/${t.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-zinc-200 hover:text-emerald-400"
            >
              {t.title}
            </a>
            <p className="mt-1 text-xs text-zinc-500">
              {t.post_count} repl{t.post_count === 1 ? "y" : "ies"} · last active{" "}
              {new Date(t.last_activity_at).toLocaleDateString()}
            </p>
            <ModerationActions targetType="thread" targetId={t.id} removeOnly />
          </li>
        ))}
      </ul>
    </section>
  );
}
