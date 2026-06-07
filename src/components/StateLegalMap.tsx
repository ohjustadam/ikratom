import { createClient } from "@/lib/supabase/server";
import { US_STATE_PATHS, US_VIEWBOX } from "@/lib/us-map-paths";

/**
 * "Where it stands" — a US map colored by each state's CONFIRMED kratom-leaf
 * legal status (the same admin-confirmed rows the /states StatusHeader trusts;
 * unconfirmed auto-derivations are deliberately NOT colored, so we never paint
 * a wrong "banned" on a legal market). Every state links to its hub. As the
 * /admin/state-status queue confirms more states, the map fills in.
 */
// Color = degree of PROTECTION, not merely "is it currently legal". A state
// with no kratom law isn't "safe" — it's unprotected and one bad bill from a
// ban, so it is NOT green. Green is reserved for an enacted protective law.
const FILL: Record<string, string> = {
  banned: "#991b1b", // red-800 — statewide leaf ban
  restricted: "#b45309", // amber-700 — partial restriction (age limit only)
  legal: "#2563eb", // blue-600 — legal but UNPROTECTED (no kratom law on the books)
  incoming: "#0d9488", // teal-600 — protection approved but NOT yet in force
  kcpa: "#15803d", // green-700 — enacted protection (KCPA / pro-kratom law)
  protected: "#15803d",
};
const UNKNOWN = "#27272a"; // zinc-800 — tracking, not yet confirmed

const LABEL: Record<string, string> = {
  banned: "Banned",
  restricted: "Restricted",
  legal: "Legal · no protections",
  incoming: "Protection incoming",
  kcpa: "Protected · KCPA",
  protected: "Protected",
};

export async function StateLegalMap() {
  let byState = new Map<string, { status: string; note: string | null }>();
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("state_status")
      .select("state, admin_leaf_status, admin_note")
      .not("admin_leaf_status", "is", null);
    byState = new Map(
      (data ?? []).map((r) => [
        r.state as string,
        { status: r.admin_leaf_status as string, note: (r.admin_note as string | null) ?? null },
      ]),
    );
  } catch {
    // Degrade to an all-"tracking" map rather than crash the landing.
  }

  const vals = [...byState.values()].map((e) => e.status);
  const bannedCount = vals.filter((s) => s === "banned").length;
  const protectedCount = vals.filter((s) => s === "kcpa" || s === "protected").length;
  const incomingCount = vals.filter((s) => s === "incoming").length;
  const unprotectedCount = vals.filter((s) => s === "legal").length;
  const restrictedCount = vals.filter((s) => s === "restricted").length;

  return (
    <section className="mt-12 border-t border-zinc-800 pt-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">◉ Where it stands</p>
      <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
        Kratom&apos;s legal status, <span className="text-zinc-400">state by state.</span>
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400">
        {bannedCount > 0 ? (
          <><span className="font-semibold text-red-300">{bannedCount}</span> ban it outright. </>
        ) : null}
        Only <span className="font-semibold text-emerald-300">{protectedCount}</span> have real legal protections
        in force (an enacted Consumer Protection Act)
        {incomingCount > 0 ? (
          <>, plus <span className="font-semibold text-teal-300">{incomingCount}</span> approved but not yet active</>
        ) : null}. The <span className="font-semibold text-blue-300">{unprotectedCount}</span> in blue are legal but{" "}
        <span className="font-semibold text-blue-300">unprotected</span> — no law on the books means one bad bill
        from a ban. Tap any state to see why it&apos;s colored the way it is, the active fight, and one-click
        actions. Grey = still verifying, never a guess.
      </p>

      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:p-5">
        <svg viewBox={US_VIEWBOX} role="img" aria-label="US kratom legal-status map" className="h-auto w-full">
          {US_STATE_PATHS.map((p) => {
            const entry = byState.get(p.abbr);
            const status = entry?.status;
            const fill = status ? FILL[status] ?? UNKNOWN : UNKNOWN;
            // Show the WHY on hover/tap so it's clear what earns each color.
            const why = entry?.note ? ` · ${entry.note.slice(0, 160)}` : "";
            return (
              <a key={p.abbr} href={`/states/${p.abbr}`}>
                <path
                  d={p.d}
                  fill={fill}
                  stroke="#0a0a0a"
                  strokeWidth={1}
                  className="cursor-pointer transition-opacity hover:opacity-75"
                >
                  <title>{`${p.name}${status ? ` — ${LABEL[status] ?? status}` : " — tracking"}${why}`}</title>
                </path>
              </a>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-400">
        <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-sm" style={{ background: FILL.banned }} /> Banned ({bannedCount})</span>
        <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-sm" style={{ background: FILL.restricted }} /> Restricted ({restrictedCount})</span>
        <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-sm" style={{ background: FILL.legal }} /> Legal · unprotected ({unprotectedCount})</span>
        <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-sm" style={{ background: FILL.incoming }} /> Protection incoming ({incomingCount})</span>
        <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-sm" style={{ background: FILL.kcpa }} /> Protected · KCPA ({protectedCount})</span>
        <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-sm" style={{ background: UNKNOWN }} /> Tracking</span>
      </div>
    </section>
  );
}
