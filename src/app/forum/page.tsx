import { createClient } from "@/lib/supabase/server";
import { publicHandle } from "@/lib/public-handle";
import { USMap } from "@/components/USMap";
import { Lounge } from "@/modules/chat/Lounge";
import { RecentActivity } from "@/modules/chat/RecentActivity";
import { loadInitialChat } from "@/modules/chat/actions";
import { listActiveCommunities } from "@/modules/forum/community-actions";
import { fetchForumStatsForIndex } from "@/modules/forum/engagement-actions";
import { stateKey, communityKey } from "@/modules/forum/engagement-keys";
import { ForumSubscribeButton } from "@/modules/forum/components/ForumSubscribeButton";
import { ForumStateNav } from "@/modules/forum/components/ForumStateNav";

export const metadata = { title: "Community" };

export default async function ForumIndexPage() {
  const supabase = await createClient();
  const { data: states } = await supabase
    .from("states")
    .select("abbr, name")
    .order("name");

  // Map colors come from the SAME source as the home-page map
  // (state_status.admin_leaf_status) so the forum map and the landing map
  // always agree. The legacy states.kratom_status column was a stale parallel
  // source (it lacked CT's 2026 ban, etc.) — no longer used for the map.
  const { data: legalRows } = await supabase
    .from("state_status")
    .select("state, admin_leaf_status")
    .not("admin_leaf_status", "is", null);
  const statusByAbbr: Record<string, string> = {};
  for (const r of legalRows ?? []) {
    if (r.admin_leaf_status) statusByAbbr[r.state as string] = r.admin_leaf_status as string;
  }

  // Topical communities (admin-curated). Renders only if non-empty so
  // the section auto-hides on a fresh deploy.
  const communities = await listActiveCommunities();

  // Per-forum aggregate counts + the calling user's unread + sub mode.
  // One round-trip RPC; anon callers get counts without the personal
  // signals. Keyed by forum_key (e.g. "state:OK", "community:<uuid>")
  // for O(1) lookup in the render loops below.
  const stats = await fetchForumStatsForIndex();

  // User context
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let userState: string | null = null;
  let me: { id: string; name: string } | null = null;
  let isAdmin = false;
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("state, username, is_admin")
      .eq("id", user.id)
      .single();
    userState = prof?.state ?? null;
    me = { id: user.id, name: publicHandle(prof) };
    isAdmin = !!prof?.is_admin;
  }

  // Per-state forum activity — drives the map's activity dots + the searchable
  // state nav (sort-by-active). Derived from the single stats RPC above.
  const activityByAbbr: Record<string, { threads: number; posts: number; lastActivity: string | null }> = {};
  const stateActivity: Record<
    string,
    { threads: number; posts: number; lastActivity: string | null; unread: number; subMode: "alerts" | "digest" | "mute" | null }
  > = {};
  for (const s of states ?? []) {
    const k = stateKey(s.abbr);
    const fs = k ? stats[k] : undefined;
    activityByAbbr[s.abbr] = {
      threads: fs?.thread_count ?? 0,
      posts: fs?.post_count ?? 0,
      lastActivity: fs?.last_activity ?? null,
    };
    stateActivity[s.abbr] = {
      threads: fs?.thread_count ?? 0,
      posts: fs?.post_count ?? 0,
      lastActivity: fs?.last_activity ?? null,
      unread: fs?.unread_count ?? 0,
      subMode: fs?.sub_mode ?? null,
    };
  }

  // Lounge: load last 30 messages and resolve author names in one round-trip.
  //
  // We must use the public.get_public_profiles() SECURITY DEFINER RPC here,
  // not a direct `from('profiles').select()`. The profiles SELECT RLS only
  // lets users read their own row + admins read all — so non-admin viewers
  // were seeing blanks for everyone else's chat names. The RPC bypasses
  // RLS but is whitelisted to public-safe columns only (no email/addr).
  const initialChat = await loadInitialChat("lounge", 30);
  const chatAuthorIds = Array.from(new Set(initialChat.map((m) => m.user_id)));
  const { data: chatAuthorRows } = chatAuthorIds.length
    ? await supabase.rpc("get_public_profiles", { p_ids: chatAuthorIds })
    : { data: [] as { id: string; username: string | null; state: string | null; is_admin: boolean | null }[] };
  const chatAuthors: Record<string, { name: string; isAdmin: boolean }> = {};
  for (const a of (chatAuthorRows ?? []) as { id: string; username: string | null; state: string | null; is_admin: boolean | null }[]) {
    chatAuthors[a.id] = { name: publicHandle(a), isAdmin: !!a.is_admin };
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Community</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Live chat in the Lounge below, topical communities for shop owners /
          veterans / caregivers, and a state forum for every state. Subscribe
          to any forum to get alerts on new threads — mute the noisy ones.
        </p>
      </header>

      {/* Live lounge — sticks at the top so people land in something interactive */}
      <div className="mb-6">
        <Lounge
          room="lounge"
          initial={initialChat}
          authors={chatAuthors}
          me={me}
          isAdmin={isAdmin}
          signedIn={!!user}
        />
      </div>

      {/* Map — legality + live forum-activity dots. The visual "where's it
          happening" entry point; click any state to enter its forum. */}
      <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 sm:p-6">
        <USMap statusByAbbr={statusByAbbr} highlightAbbr={userState} activityByAbbr={activityByAbbr} />
      </div>

      {/* Recent activity feed — latest threads, replies, and campaigns so the
          page reads as alive, not a ghost town */}
      <div className="mb-8">
        <RecentActivity limit={10} />
      </div>

      {/* Topical communities — admin-curated, rendered only when present.
          Sits between the map and the state list so it's prominent without
          shoving the map below the fold. */}
      {communities.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Topical communities
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {communities.map((c) => {
              const key = communityKey(c.id);
              const s = key ? stats[key] : undefined;
              return (
                <div
                  key={c.id}
                  className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 hover:border-emerald-500"
                >
                  <a href={`/forum/c/${c.slug}`} className="flex items-start gap-3">
                    <span className="text-2xl">{c.icon || "💬"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-zinc-100">{c.name}</span>
                        {!!s?.unread_count && s.unread_count > 0 && (
                          <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                            {s.unread_count > 99 ? "99+" : s.unread_count} new
                          </span>
                        )}
                      </div>
                      {c.description && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500">
                          {c.description}
                        </div>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                        <span>{s?.thread_count ?? 0} threads</span>
                        <span>·</span>
                        <span>{s?.post_count ?? 0} posts</span>
                        {s?.last_activity && (
                          <>
                            <span>·</span>
                            <span>active {new Date(s.last_activity).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </a>
                  {key && (
                    <div className="mt-2">
                      <ForumSubscribeButton
                        forumKey={key}
                        initialMode={s?.sub_mode ?? null}
                        signedIn={!!user}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* National board — first-class link, not buried with the states */}
      {(() => {
        const fedKey = "state:FED";
        const s = stats[fedKey];
        return (
          <div className="mb-8 rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-4 hover:border-emerald-500">
            <a href="/forum/FED" className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-emerald-400">FED</span>
                  <span className="font-semibold">National forum</span>
                  {!!s?.unread_count && s.unread_count > 0 && (
                    <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                      {s.unread_count > 99 ? "99+" : s.unread_count} new
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  Federal bills, cross-state organizing.
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                  <span>{s?.thread_count ?? 0} threads</span>
                  <span>·</span>
                  <span>{s?.post_count ?? 0} posts</span>
                  {s?.last_activity && (
                    <>
                      <span>·</span>
                      <span>active {new Date(s.last_activity).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
              </div>
              <span className="text-emerald-400">→</span>
            </a>
            <div className="mt-2">
              <ForumSubscribeButton
                forumKey={fedKey}
                initialMode={s?.sub_mode ?? null}
                signedIn={!!user}
              />
            </div>
          </div>
        );
      })()}

      {/* Searchable + activity-sorted state forums (replaces the old static
          alphabetical grid — your state pins first; "Most active" floats the
          live forums to the top). */}
      <ForumStateNav
        states={(states ?? []).map((s) => ({ abbr: s.abbr, name: s.name, status: statusByAbbr[s.abbr] ?? null }))}
        activity={stateActivity}
        userState={userState}
      />
    </div>
  );
}
