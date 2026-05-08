import { createClient } from "@/lib/supabase/server";
import { USMap } from "@/components/USMap";
import { Lounge } from "@/modules/chat/Lounge";
import { RecentActivity } from "@/modules/chat/RecentActivity";
import { loadInitialChat } from "@/modules/chat/actions";
import { listActiveCommunities } from "@/modules/forum/community-actions";
import { fetchForumStatsForIndex } from "@/modules/forum/engagement-actions";
import { stateKey, communityKey } from "@/modules/forum/engagement-keys";
import { ForumSubscribeButton } from "@/modules/forum/components/ForumSubscribeButton";

export const metadata = { title: "Community" };

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  legal: { label: "Legal", cls: "bg-emerald-950/40 text-emerald-300" },
  kcpa: { label: "KCPA", cls: "bg-blue-950/40 text-blue-300" },
  banned: { label: "Banned", cls: "bg-red-950/40 text-red-300" },
  restricted: { label: "Restricted", cls: "bg-amber-950/40 text-amber-300" },
};

export default async function ForumIndexPage() {
  const supabase = await createClient();
  const { data: states } = await supabase
    .from("states")
    .select("abbr, name, kratom_status")
    .order("name");

  // Build status-by-abbr map for the SVG
  const statusByAbbr: Record<string, string> = {};
  for (const s of states ?? []) {
    if (s.kratom_status) statusByAbbr[s.abbr] = s.kratom_status;
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
      .select("state, full_name, is_admin")
      .eq("id", user.id)
      .single();
    userState = prof?.state ?? null;
    me = { id: user.id, name: prof?.full_name ?? user.email ?? "user" };
    isAdmin = !!prof?.is_admin;
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
    : { data: [] as { id: string; full_name: string | null; is_admin: boolean | null }[] };
  const chatAuthors: Record<string, { name: string; isAdmin: boolean }> = {};
  for (const a of (chatAuthorRows ?? []) as { id: string; full_name: string | null; is_admin: boolean | null }[]) {
    chatAuthors[a.id] = { name: a.full_name ?? "(no name)", isAdmin: !!a.is_admin };
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

      {/* Recent activity ticker — proves the platform is alive */}
      <div className="mb-8">
        <RecentActivity limit={6} />
      </div>

      {/* Map */}
      <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 sm:p-6">
        <USMap statusByAbbr={statusByAbbr} highlightAbbr={userState} />
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

      {/* Searchable list backup */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        All states (51)
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(states ?? []).map((st) => {
          const tag = STATUS_BADGE[st.kratom_status ?? ""] ?? null;
          const isMine = userState === st.abbr;
          const key = stateKey(st.abbr);
          const fs = key ? stats[key] : undefined;
          const muted = fs?.sub_mode === "mute";
          return (
            <a
              key={st.abbr}
              href={`/forum/${st.abbr}`}
              className={`flex items-start justify-between gap-2 rounded-md border px-4 py-3 hover:border-emerald-500 ${
                isMine
                  ? "border-emerald-700/50 bg-emerald-950/10"
                  : "border-zinc-800 bg-zinc-950/40"
              } ${muted ? "opacity-50" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-zinc-500">{st.abbr}</span>
                  <span className="font-medium">{st.name}</span>
                  {isMine && (
                    <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950">
                      Yours
                    </span>
                  )}
                  {!!fs?.unread_count && fs.unread_count > 0 && (
                    <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                      {fs.unread_count > 99 ? "99+" : fs.unread_count} new
                    </span>
                  )}
                  {fs?.sub_mode === "alerts" && <span title="Alerts on">🔔</span>}
                  {fs?.sub_mode === "digest" && <span title="Daily digest">📰</span>}
                  {fs?.sub_mode === "mute" && <span title="Muted">🔕</span>}
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {fs?.thread_count ?? 0} threads · {fs?.post_count ?? 0} posts
                </div>
              </div>
              {tag && (
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${tag.cls}`}>
                  {tag.label}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}
