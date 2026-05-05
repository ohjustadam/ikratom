import { createClient } from "@/lib/supabase/server";
import { USMap } from "@/components/USMap";

export const metadata = { title: "State forums" };

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

  // User's state if signed in
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let userState: string | null = null;
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("state")
      .eq("id", user.id)
      .single();
    userState = prof?.state ?? null;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">State forums</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          One forum per state. Click your state for local strategy chats, automated
          bill alerts, and per-state notification controls.
        </p>
      </header>

      {/* Map */}
      <div className="mb-10 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 sm:p-6">
        <USMap statusByAbbr={statusByAbbr} highlightAbbr={userState} />
      </div>

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
