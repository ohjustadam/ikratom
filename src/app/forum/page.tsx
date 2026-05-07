import { createClient } from "@/lib/supabase/server";
import { USMap } from "@/components/USMap";
import { Lounge } from "@/modules/chat/Lounge";
import { RecentActivity } from "@/modules/chat/RecentActivity";
import { loadInitialChat } from "@/modules/chat/actions";

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
          Chat with everyone in the lounge below, or jump to your state forum for
          local strategy + automated bill alerts.
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

      {/* National board — first-class link, not buried with the states */}
      <a
        href="/forum/FED"
        className="mb-8 flex items-center justify-between rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-4 hover:border-emerald-500"
      >
        <span>
          <span className="font-mono text-xs text-emerald-400">FED</span>
          <span className="ml-3 font-semibold">National forum</span>
          <span className="ml-2 text-xs text-zinc-500">— federal bills, cross-state organizing</span>
        </span>
        <span className="text-emerald-400">→</span>
      </a>

      {/* Searchable list backup */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        All states (51)
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(states ?? []).map((s) => {
          const tag = STATUS_BADGE[s.kratom_status ?? ""] ?? null;
          const isMine = userState === s.abbr;
          return (
            <a
              key={s.abbr}
              href={`/forum/${s.abbr}`}
              className={`flex items-center justify-between rounded-md border px-4 py-3 hover:border-emerald-500 ${
                isMine
                  ? "border-emerald-700/50 bg-emerald-950/10"
                  : "border-zinc-800 bg-zinc-950/40"
              }`}
            >
              <span>
                <span className="font-mono text-xs text-zinc-500">{s.abbr}</span>
                <span className="ml-3 font-medium">{s.name}</span>
                {isMine && (
                  <span className="ml-2 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950">
                    Yours
                  </span>
                )}
              </span>
              {tag && (
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${tag.cls}`}>
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
