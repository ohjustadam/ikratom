import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * "The law around you" — the locality-intelligence layer of the war room
 * (PR-C): the user's city/county legal framework, any kratom measure being
 * pushed there, and the next council meeting. Reads locality_intel (0192,
 * public SELECT), populated by the nightly sweep on the owner box.
 *
 * Renders null until intelligence exists for the user's locality (and
 * tolerates the table not existing yet), so the dashboard never shows an
 * empty shell.
 */
const STATUS_TONE: Record<string, { label: string; cls: string }> = {
  banned: { label: "Local ban in force", cls: "border-red-700/50 bg-red-950/30 text-red-200" },
  repealed: { label: "Ban repealed", cls: "border-teal-700/50 bg-teal-950/30 text-teal-200" },
  pending_measure: { label: "Measure pending", cls: "border-amber-700/50 bg-amber-950/25 text-amber-200" },
  no_local_law: { label: "No local ordinance found", cls: "border-blue-700/50 bg-blue-950/30 text-blue-200" },
  uncertain: { label: "Under verification", cls: "border-zinc-700 bg-zinc-900/40 text-zinc-300" },
};

type IntelRow = {
  locality: string;
  scope: string;
  legal_status: string | null;
  legal_framework_md: string | null;
  ordinance_url: string | null;
  pending_measures_md: string | null;
  pending_count: number;
  next_meeting_at: string | null;
};

export async function LocalLawWidget({
  userState,
  userCity,
  userCounty,
}: {
  userState: string | null;
  userCity: string | null;
  userCounty: string | null;
}) {
  if (!userState) return null;
  const places = [userCity, userCounty].filter(Boolean) as string[];
  if (places.length === 0) return null;

  // ilike with no wildcards = case-insensitive equality: intel rows keep
  // source casing while profiles hold Census casing ("DeSoto" vs "Desoto").
  // Strip PostgREST .or() structural chars from the (user-set) city/county
  // first — otherwise a profile city like "Tulsa,scope.eq.x)" injects an extra
  // predicate (pen-test INJ-02). Drop any value emptied by the strip.
  const orFilter = places
    .map((p) => p.replace(/[,():*%\\]/g, " ").trim())
    .filter(Boolean)
    .map((p) => `locality.ilike.${p}`)
    .join(",");
  if (!orFilter) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locality_intel")
    .select("locality, scope, legal_status, legal_framework_md, ordinance_url, pending_measures_md, pending_count, next_meeting_at")
    .eq("state", userState)
    .or(orFilter)
    .order("scope", { ascending: false }); // municipal first, county after
  // Missing table (0192 not applied yet) or transient error → widget absent.
  if (error) return null;
  const rows = (data as IntelRow[] | null) ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-end justify-between border-b border-zinc-900 px-4 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">locality intel</p>
          <h2 className="text-sm font-bold text-zinc-100">The law around you</h2>
        </div>
        <Link href="/banned" className="text-xs text-emerald-400 hover:underline">all local bans →</Link>
      </div>
      <div className="divide-y divide-zinc-900">
        {rows.map((r) => {
          const tone = STATUS_TONE[r.legal_status ?? ""] ?? STATUS_TONE.uncertain;
          const framework = (r.legal_framework_md ?? "").replace(/\*\*/g, "");
          const pendingLines = (r.pending_measures_md ?? "")
            .split("\n")
            .map((l) => l.replace(/^-\s*/, "").trim())
            .filter(Boolean)
            .slice(0, 2);
          return (
            <div key={`${r.scope}:${r.locality}`} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-zinc-100">{r.locality}</span>
                <span className={`rounded border px-2 py-0.5 text-[11px] ${tone.cls}`}>{tone.label}</span>
              </div>
              {framework && <p className="text-xs leading-relaxed text-zinc-400">{framework}</p>}
              {pendingLines.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-amber-400/80">being pushed right now</p>
                  {pendingLines.map((l, i) => (
                    <p key={i} className="text-xs text-zinc-300">{l.replace(/\s*\(https?:\/\/\S+\)\s*$/, "")}</p>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-3 text-[11px]">
                {r.next_meeting_at && (
                  <Link href="/calendar" className="text-emerald-400 hover:underline">
                    {/* Central-time date chip (median US zone — exact local time lives on /calendar) */}
                    next council meeting {new Date(r.next_meeting_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })} →
                  </Link>
                )}
                {r.ordinance_url && (
                  <a href={r.ordinance_url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:underline">
                    read the source ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
