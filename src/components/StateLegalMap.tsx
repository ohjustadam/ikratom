import { createClient } from "@/lib/supabase/server";
import { US_STATE_PATHS, US_VIEWBOX } from "@/lib/us-map-paths";

/**
 * "Where it stands" — a US map colored by each state's CONFIRMED kratom-leaf
 * legal status (the same admin-confirmed rows the /states StatusHeader trusts;
 * unconfirmed auto-derivations are deliberately NOT colored, so we never paint
 * a wrong "banned" on a legal market). Every state links to its hub. As the
 * /admin/state-status queue confirms more states, the map fills in.
 */
const FILL: Record<string, string> = {
  banned: "#991b1b", // red-800
  restricted: "#b45309", // amber-700
  legal: "#15803d", // green-700
  kcpa: "#15803d",
  protected: "#15803d",
};
const UNKNOWN = "#27272a"; // zinc-800 — tracking, not yet confirmed

const LABEL: Record<string, string> = {
  banned: "Banned",
  restricted: "Restricted",
  legal: "Legal",
  kcpa: "Legal · KCPA",
  protected: "Protected",
};

export async function StateLegalMap() {
  let byState = new Map<string, string>();
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("state_status")
      .select("state, admin_leaf_status")
      .not("admin_leaf_status", "is", null);
    byState = new Map((data ?? []).map((r) => [r.state as string, r.admin_leaf_status as string]));
  } catch {
    // Degrade to an all-"tracking" map rather than crash the landing.
  }

  const bannedCount = [...byState.values()].filter((s) => s === "banned").length;
  const legalCount = [...byState.values()].filter((s) => ["legal", "kcpa", "protected"].includes(s)).length;

  return (
    <section className="mt-12 border-t border-zinc-800 pt-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">◉ Where it stands</p>
      <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
        Kratom&apos;s legal status, <span className="text-zinc-400">state by state.</span>
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400">
        {bannedCount > 0 ? (
          <>
            <span className="font-semibold text-red-300">{bannedCount} states</span> ban kratom outright.{" "}
          </>
        ) : null}
        Tap any state for its confirmed status, the active fight, and one-click actions. Grey = we&apos;re still
        verifying — never a guess.
      </p>

      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:p-5">
        <svg viewBox={US_VIEWBOX} role="img" aria-label="US kratom legal-status map" className="h-auto w-full">
          {US_STATE_PATHS.map((p) => {
            const status = byState.get(p.abbr);
            const fill = status ? FILL[status] ?? UNKNOWN : UNKNOWN;
            return (
              <a key={p.abbr} href={`/states/${p.abbr}`}>
                <path
                  d={p.d}
                  fill={fill}
                  stroke="#0a0a0a"
                  strokeWidth={1}
                  className="cursor-pointer transition-opacity hover:opacity-75"
                >
                  <title>{`${p.name}${status ? ` — ${LABEL[status] ?? status}` : " — tracking"}`}</title>
                </path>
              </a>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-400">
        <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-sm" style={{ background: FILL.banned }} /> Banned ({bannedCount})</span>
        <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-sm" style={{ background: FILL.legal }} /> Legal ({legalCount})</span>
        <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-sm" style={{ background: UNKNOWN }} /> Tracking — tap to see</span>
      </div>
    </section>
  );
}
