import { createClient } from "@/lib/supabase/server";

/**
 * Owner-only "who's online" — users whose presence heartbeat (last_seen_at,
 * migration 0240) landed in the last 5 minutes. Render only for the owner;
 * profiles RLS (self-or-admin) also scopes the read defensively. Shows
 * @username only, never real name.
 */
export async function WhosOnline() {
  const sb = await createClient();
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("profiles")
    .select("id, username, last_seen_at")
    .gte("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: false })
    .limit(50);
  const online = data ?? [];

  return (
    <section className="mb-8 rounded-lg border border-emerald-800/40 bg-emerald-950/10 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-emerald-200">
          <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400 align-middle" />
          Online now
        </h2>
        <span className="text-xs text-zinc-500">{online.length} active · last 5 min</span>
      </div>
      {online.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">No one active right now.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {online.map((u) => (
            <li
              key={u.id}
              className="rounded-full border border-emerald-700/40 bg-emerald-950/30 px-3 py-1 text-xs text-emerald-200"
              title={u.last_seen_at ? `last seen ${secsAgo(u.last_seen_at)}` : undefined}
            >
              {u.username ? `@${u.username}` : "(no handle)"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function secsAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}
