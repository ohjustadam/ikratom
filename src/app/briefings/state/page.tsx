import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "State briefings — all 50 + DC" };
export const dynamic = "force-dynamic";

const STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],
  ["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],
  ["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],
  ["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],
  ["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],
  ["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],
  ["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],
  ["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],
  ["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],
  ["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
] as const;

/**
 * /briefings/state — index of per-state field-work briefings.
 *
 * Lists all 50 + DC with last-generated timestamp. User's state floats
 * to a "Your state" callout band if signed in + state is set. Shows
 * which states have a fresh briefing vs which are pending generation.
 */
export default async function StateBriefingsIndex() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  let viewerState: string | null = null;
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("state")
      .eq("id", user.id)
      .single();
    viewerState = prof?.state ?? null;
  }

  const { data: briefings } = await supabase
    .from("state_briefings")
    .select("state, generated_at")
    .eq("is_active", true);

  const byState = new Map<string, string>();
  for (const b of briefings ?? []) {
    byState.set(b.state, b.generated_at);
  }

  const yourStateRow = viewerState ? STATES.find(([abbr]) => abbr === viewerState) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <nav className="mb-2 text-xs text-zinc-500">
        <Link href="/briefings" className="hover:text-emerald-400">← All briefings</Link>
      </nav>

      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Per-state briefings
        </p>
        <h1 className="mt-2 text-3xl font-bold">State of your state</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          AI-synthesized field-work briefings for every state — active bills,
          BoP status, key reps, capital access, tactical advice. Generated
          nightly from the platform&apos;s live data. Print one before walking
          into a meeting at your capital.
        </p>
      </header>

      {/* Your state — pinned at top if known */}
      {yourStateRow && (
        <section className="mb-8 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
            📍 Your state
          </p>
          <Link
            href={`/briefings/state/${yourStateRow[0]}`}
            className="mt-2 inline-flex items-baseline gap-3 text-2xl font-bold hover:text-emerald-300"
          >
            {yourStateRow[1]}
            <span className="text-zinc-500">({yourStateRow[0]})</span>
            <span className="text-base font-normal text-emerald-400">Read briefing →</span>
          </Link>
          {byState.has(yourStateRow[0]) && (
            <p className="mt-2 text-xs text-zinc-500">
              Last updated {byState.get(yourStateRow[0])!.slice(0, 10)}
            </p>
          )}
        </section>
      )}

      {/* All 50 + DC, alphabetical */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          All 50 + DC
        </h2>
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {STATES.map(([abbr, name]) => {
            const gen = byState.get(abbr);
            return (
              <li key={abbr}>
                <Link
                  href={`/briefings/state/${abbr}`}
                  className="flex items-baseline justify-between gap-2 rounded-md px-3 py-2 hover:bg-zinc-900"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-zinc-500">{abbr}</span>
                    <span className="text-sm font-medium">{name}</span>
                  </span>
                  {gen ? (
                    <span className="text-[10px] text-zinc-500">
                      {gen.slice(0, 10)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-500/70">pending</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
