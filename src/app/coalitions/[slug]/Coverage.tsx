import Link from "@/components/Link";
import { createClient } from "@/lib/supabase/server";
import {
  CHAMBERS, chamberOf, coverageSummary, coverageTier, districtLabel, type CoverageRow,
} from "@/modules/coalitions/districts";
import { AssignCaptainForm, RemoveCaptainButton } from "./CoverageClient";

/**
 * District captains + the coverage map (migration 0295, B4 d). The map is a
 * tile per district of the group's state: how many members live there and
 * whether it has a captain. Counts only, never a name. The captain list
 * below it names captains by @handle, to members of the group only.
 */
const TIER = ["bg-zinc-900 text-zinc-500", "bg-emerald-950 text-emerald-200", "bg-emerald-800 text-emerald-50", "bg-emerald-500 text-zinc-950"];

export async function Coverage({ coalitionId, slug, state, isOrganizer, userId, chamber, members }: {
  coalitionId: string; slug: string; state: string | null; isOrganizer: boolean; userId: string;
  chamber: string | undefined; members: { user_id: string; handle: string }[];
}) {
  if (!state) return null;
  const ch = chamberOf(chamber);
  const sb = await createClient();
  const [{ data: cov }, { data: caps }, { data: me }] = await Promise.all([
    sb.rpc("coalition_district_coverage", { p_coalition_id: coalitionId, p_chamber: ch.key }),
    sb.from("coalition_district_captains").select("district, user_id").eq("coalition_id", coalitionId).eq("chamber", ch.key),
    sb.from("profiles").select("state, state_house_district, state_senate_district, congressional_district").eq("id", userId).maybeSingle(),
  ]);
  const rows = (cov ?? []) as CoverageRow[];
  const captains = (caps ?? []) as { district: string; user_id: string }[];
  const handle = new Map(members.map((m) => [m.user_id, m.handle]));
  const mine = me?.state === state ? ((me as Record<string, string | null>)[ch.profileColumn] ?? null) : null;
  const sum = coverageSummary(rows);

  return (
    <section id="coverage" className="mb-6 scroll-mt-20">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-300">🗺 District coverage · {state}</h2>
      <nav aria-label="Chamber" className="mb-3 flex gap-1 overflow-x-auto">
        {CHAMBERS.map((c) => (
          <Link key={c.key} href={`/coalitions/${slug}?tab=members&chamber=${c.key}#coverage`} aria-current={c.key === ch.key ? "page" : undefined}
            className={`flex min-h-10 items-center whitespace-nowrap rounded-md border px-3 text-xs font-semibold ${c.key === ch.key ? "border-emerald-500 text-emerald-300" : "border-zinc-800 text-zinc-400"}`}>
            {c.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">No {ch.label} districts on file for {state} yet.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-400">
            Members in <strong className="text-zinc-100">{sum.withMembers}</strong> of {sum.total} districts · <strong className="text-zinc-100">{sum.withCaptain}</strong> with a captain
          </p>
          <ul aria-label={`${ch.label} districts`} className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1">
            {rows.map((r) => (
              <li key={r.district}
                title={`${districtLabel(ch.key, r.district)}: ${r.members} member${r.members === 1 ? "" : "s"}${r.has_captain ? ", has a captain" : ""}`}
                className={`relative flex h-11 flex-col items-center justify-center overflow-hidden rounded px-0.5 text-[10px] leading-tight ${TIER[coverageTier(r.members)]} ${r.district === mine ? "ring-2 ring-amber-400" : ""}`}>
                <span className="max-w-full truncate font-semibold">{r.district}</span>
                <span>{r.members}</span>
                {r.has_captain && <span aria-label="has a captain" className="absolute right-0.5 top-0 text-[9px]">★</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-zinc-500">
            Each tile is a district and its number of members (shade: 0, 1, 2–4, 5+). ★ has a captain.{mine && " Your district is outlined."} Counts only; members are counted from the address in their profile.
          </p>
        </>
      )}

      <h3 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-zinc-400">Captains</h3>
      {captains.length === 0 ? (
        <p className="mb-3 text-sm text-zinc-400">No captains yet. A captain owns one district: they make sure its office hears from the group.</p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm">
          {captains.map((k) => (
            <li key={k.district} className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 px-3 py-2">
              <span>★ {districtLabel(ch.key, k.district)}</span>
              <span className="font-semibold text-emerald-300">{handle.get(k.user_id) ?? "@member"}</span>
              {isOrganizer && <span className="ml-auto"><RemoveCaptainButton coalitionId={coalitionId} slug={slug} chamber={ch.key} district={k.district} /></span>}
            </li>
          ))}
        </ul>
      )}
      {isOrganizer && rows.length > 0 && (
        <AssignCaptainForm coalitionId={coalitionId} slug={slug} chamber={ch.key}
          districts={rows.map((r) => ({ value: r.district, label: `${districtLabel(ch.key, r.district)} · ${r.members} member${r.members === 1 ? "" : "s"}${r.has_captain ? " · ★" : ""}` }))}
          members={members} />
      )}
    </section>
  );
}
