import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Coalitions — multi-advocate teams",
  description:
    "Coordinate with other advocates in your state. Create a coalition, invite teammates, share intel and strategy.",
};
export const dynamic = "force-dynamic";

/**
 * /coalitions — index page.
 *
 * Shows two sections when signed in:
 *   1. My coalitions — every coalition the user is a member of
 *   2. Public coalitions — discoverable coalitions that opted in to
 *      public listing (is_public = true)
 *
 * Anon users see only the public list + a sign-in nudge.
 */
export default async function CoalitionsIndexPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  // Mine: any coalition where the user has a coalition_members row.
  // RLS lets members read their own coalitions through the member
  // policy. We pull via the membership table directly to also get the
  // user's role.
  type MyRow = {
    role: string;
    coalitions: {
      id: string; slug: string; name: string; description: string | null;
      state: string | null; is_public: boolean; created_at: string;
    } | null;
  };
  let mine: MyRow[] = [];
  if (user) {
    const { data } = await sb
      .from("coalition_members")
      .select("role, coalitions(id, slug, name, description, state, is_public, created_at)")
      .eq("user_id", user.id);
    mine = (data ?? []) as unknown as MyRow[];
  }

  // Public: anyone-readable coalitions, exclude ones the user is
  // already in (no point listing them twice).
  type PublicRow = {
    id: string; slug: string; name: string; description: string | null;
    state: string | null; created_at: string;
  };
  const mineIds = new Set(mine.map((m) => m.coalitions?.id).filter((x): x is string => !!x));
  const { data: publicData } = await sb
    .from("coalitions")
    .select("id, slug, name, description, state, created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(40);
  const publicList = ((publicData ?? []) as PublicRow[]).filter((c) => !mineIds.has(c.id));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Coalitions
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Coordinate with your team</h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          A coalition is a named group of advocates. Create one, invite teammates, share intel
          and strategy. Coordination compounds — one advocate is a letter; ten advocates organized
          around the same bill is a movement.
        </p>
      </header>

      {!user && (
        <p className="mb-6 rounded-md border border-amber-700/40 bg-amber-950/10 p-3 text-[11px] text-amber-200">
          💡 <Link href="/login" className="font-semibold underline">Sign in</Link> to create a coalition or join one via an invite link.
        </p>
      )}

      {user && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Link
            href="/coalitions/new"
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            + New coalition
          </Link>
        </div>
      )}

      {/* My coalitions */}
      {user && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
            My coalitions {mine.length > 0 && <span className="text-zinc-500">({mine.length})</span>}
          </h2>
          {mine.length === 0 ? (
            <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-400">
              You&apos;re not in any coalitions yet. <Link href="/coalitions/new" className="text-emerald-400 hover:underline">Create one</Link> or follow a teammate&apos;s invite link.
            </p>
          ) : (
            <ul className="space-y-2">
              {mine.map((m) => {
                const c = m.coalitions;
                if (!c) return null;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/coalitions/${c.slug}`}
                      className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 hover:border-emerald-500"
                    >
                      <div className="flex flex-wrap items-baseline gap-2 text-sm">
                        <span className="font-semibold text-zinc-100">{c.name}</span>
                        {c.state && (
                          <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                            {c.state}
                          </span>
                        )}
                        <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                          m.role === "owner"
                            ? "bg-amber-500 text-zinc-950"
                            : m.role === "admin"
                            ? "bg-emerald-700 text-zinc-100"
                            : "bg-zinc-800 text-zinc-300"
                        }`}>
                          {m.role}
                        </span>
                        {!c.is_public && (
                          <span className="text-[10px] text-zinc-500">🔒 private</span>
                        )}
                      </div>
                      {c.description && (
                        <p className="mt-1 text-[11px] text-zinc-400">
                          {c.description.slice(0, 200)}{c.description.length > 200 ? "…" : ""}
                        </p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* Public list */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
          Public coalitions {publicList.length > 0 && <span className="text-zinc-500">({publicList.length})</span>}
        </h2>
        {publicList.length === 0 ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-400">
            No public coalitions listed yet. Coalitions default to private; owners can opt in to listing here.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {publicList.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/coalitions/${c.slug}`}
                  className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 hover:border-emerald-500"
                >
                  <div className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="font-semibold text-zinc-100">{c.name}</span>
                    {c.state && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                        {c.state}
                      </span>
                    )}
                  </div>
                  {c.description && (
                    <p className="mt-1 text-[11px] text-zinc-400">
                      {c.description.slice(0, 140)}{c.description.length > 140 ? "…" : ""}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
