import { OfficialAvatar } from "@/components/OfficialAvatar";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";
import { getStateOfficials } from "./state-officials-data";

/**
 * Collapsible officials directory for the state war-room page (owner spec
 * 2026-06-11): one main dropdown holding role-grouped dropdowns; each
 * official is their own dropdown with one-tap "Email now" / "Call now"
 * inside. The <details> disclosure stays JS-free; only the portrait avatars
 * (a tiny client leaf) hydrate.
 */

const GROUPS: Array<{ label: string; roles: string[] }> = [
  { label: "🏛 State executives", roles: ["governor", "lt_governor", "attorney_general", "secretary_of_state"] },
  { label: "🇺🇸 Federal delegation", roles: ["us_senate", "us_house"] },
  { label: "⚖ State Senate", roles: ["state_senate"] },
  { label: "🏚 State House", roles: ["state_house"] },
  { label: "📍 Local officials", roles: ["mayor", "city_council", "county_executive", "county_commission", "county_commissioner"] },
];

export async function StateOfficials({ state, stateName }: { state: string; stateName: string }) {
  // Cached public reads (state-officials-data.ts). On any failure the
  // directory hides, exactly as before; it never takes the page down.
  const d = await getStateOfficials(state).catch(() => null);
  if (!d || d.officials.length === 0) return null;
  const { officials, places, votes } = d;
  const localTotal = places.reduce((n, p) => n + p.n, 0);

  const grouped = GROUPS
    .map((g) => ({ ...g, members: officials.filter((o) => g.roles.includes(o.role)) }))
    .filter((g) => g.members.length > 0);
  if (grouped.length === 0) return null;

  return (
    <section className="mb-8">
      <details className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <summary className="cursor-pointer text-sm font-bold uppercase tracking-wider text-zinc-200 hover:text-emerald-300">
          📇 Your officials in {stateName} · {officials.length}
        </summary>
        <p className="mt-2 text-[11px] text-zinc-500">
          Every official we track for {stateName}, grouped by role. Open a group, tap a name,
          and email or call in one click. Full intel briefings at{" "}
          <a href={`/legislators?state=${state}`} className="text-emerald-400 hover:underline">/legislators</a>.
        </p>
        <div className="mt-3 space-y-2">
          {grouped.map((g) => (
            <details key={g.label} className="rounded-md border border-zinc-800/70 bg-zinc-950/30 p-2.5">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200">
                {g.label} · {g.members.length}
              </summary>
              <ul className="mt-2 space-y-1.5">
                {g.members.map((o) => (
                  <li key={o.id}>
                    <details className="rounded border border-zinc-900 bg-zinc-950/50 px-2.5 py-1.5">
                      <summary className="cursor-pointer text-xs text-zinc-200 hover:text-emerald-300">
                        <OfficialAvatar name={o.full_name} portraitUrl={o.portrait_url} size="sm" className="mr-1.5 align-middle" />
                        <span className="font-medium">{o.full_name}</span>
                        {o.title && <span className="ml-1.5 text-zinc-500">{o.title}</span>}
                        {o.party && <span className="ml-1.5 text-[10px] text-zinc-500">{o.party}</span>}
                        {o.district && <span className="ml-1.5 font-mono text-[10px] text-zinc-600">{o.district}</span>}
                      </summary>
                      {(() => {
                        const a = votes[o.id];
                        if (!a || a.total === 0) return null;
                        return (
                          <p className="mt-1 text-[10px] text-zinc-500">
                            🗳 {a.total} kratom vote{a.total === 1 ? "" : "s"}
                            {a.restrict > 0 ? <span className="text-red-300"> · voted to restrict {a.restrict}×</span> : null}
                            {" · "}
                            <a href={`/legislators/${o.id}`} className="text-emerald-400 hover:underline">see record</a>
                          </p>
                        );
                      })()}
                      <div className="mt-2 flex flex-wrap gap-2 pb-1">
                        {o.email || o.website ? (
                          <EmailOfficialButton
                            official={{ id: o.id, name: o.full_name, role: o.role, title: o.title, state, email: o.email, website: o.website }}
                            source="state_officials"
                            variant="chip"
                            label="✉ Email now"
                          />
                        ) : (
                          <span className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-600">no email on file</span>
                        )}
                        {o.phone ? (
                          <a
                            href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}
                            className="rounded-md border border-sky-700/40 bg-sky-950/20 px-3 py-1.5 text-[11px] font-semibold text-sky-300 hover:border-sky-500"
                          >
                            📞 Call now {o.phone}
                          </a>
                        ) : (
                          <span className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-600">no phone on file</span>
                        )}
                        <a
                          href={`/legislators/${o.id}/briefing`}
                          className="rounded-md border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-300 hover:border-emerald-500"
                        >
                          ◉ Intel briefing
                        </a>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {localTotal > 0 && (
            <p className="rounded-md border border-zinc-800/70 bg-zinc-950/30 p-2.5 text-xs text-zinc-400">
              📍 Local officials · {localTotal.toLocaleString()} in {places.length.toLocaleString()} counties &amp; cities —{" "}
              <a href={`/legislators?state=${state}&tab=local`} className="text-emerald-400 hover:underline">
                browse by county or city →
              </a>
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
