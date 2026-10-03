import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { EmailCouncilButton } from "@/modules/compose/EmailCouncilButton";

type Official = {
  id: string; full_name: string; role: string | null; title: string | null; body: string | null;
  email: string | null; phone: string | null; website: string | null; last_synced_at: string | null; created_at: string | null;
};

/**
 * The people who will vote on this meeting's kratom item, with a visible
 * "file date" (owner ask 2026-10-03): contact data ages, so we say when it was
 * last checked and nudge people to confirm when it is old.
 *
 * Service role + unstable_cache, no cookies: the meeting page is cached for
 * anonymous visitors and must stay that way. Officials are public figures;
 * nothing here is member data.
 */
const getOfficials = unstable_cache(
  async (state: string, locality: string) => {
    const { data } = await createServiceRoleClient()
      .from("legislators")
      .select("id, full_name, role, title, body, email, phone, website, last_synced_at, created_at")
      .eq("state", state).eq("locality", locality).neq("active", false)
      .in("level", ["municipal", "county"])
      .order("full_name").limit(40);
    return (data ?? []) as Official[];
  },
  ["meeting-who-decides"],
  { revalidate: 3600, tags: ["meeting-detail"] },
);

const STALE_DAYS = 180;

export async function WhoDecides({
  state, locality, subject, pageUrl, meetingId, bodyName, meetingDate,
}: {
  state: string; locality: string | null; subject: string; pageUrl: string;
  meetingId: string; bodyName: string | null; meetingDate: string;
}) {
  if (!locality) return null;
  const people = await getOfficials(state, locality);
  const checked = people.map((p) => p.last_synced_at ?? p.created_at).filter(Boolean).sort().at(-1) ?? null;
  const ageDays = checked ? Math.floor((Date.now() - Date.parse(checked)) / 86_400_000) : null;

  return (
    <section className="mb-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">Who decides</h2>
        {/* Full composer: templates with fill-ins, choose recipients, AI draft. */}
        <EmailCouncilButton
          officials={people.map((p) => ({ id: p.id, name: p.full_name, title: p.title ?? p.role, state, email: p.email, website: p.website }))}
          bodyName={bodyName ?? (/county|parish/i.test(locality) ? "County Board" : "Council")}
          locality={locality}
          meetingDate={meetingDate}
          meetingUrl={pageUrl}
          meetingId={meetingId}
        />
      </div>
      {people.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-400">
          We&apos;re mapping this {/county|parish/i.test(locality) ? "board" : "council"} now. Until the roster lands here,
          the members are listed on {locality}&apos;s official website, and the agenda link above names the body that will vote.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-800/80">
          {people.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
              <span><strong className="text-zinc-100">{p.full_name}</strong>{" "}
                <span className="text-zinc-500">{p.title ?? p.role ?? ""}</span></span>
              <span className="flex flex-wrap gap-3 text-xs">
                {p.email && <a href={`mailto:${p.email}?subject=${encodeURIComponent(subject)}`} className="text-emerald-400 hover:underline">Email</a>}
                {p.phone && <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} className="text-emerald-400 hover:underline">{p.phone}</a>}
                {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:underline">Website</a>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {checked && (
        <p className={`mt-3 text-[11px] ${ageDays! > STALE_DAYS ? "text-amber-300" : "text-zinc-500"}`}>
          Contacts last checked {new Date(checked).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })}.
          {ageDays! > STALE_DAYS ? " Officials change after elections — confirm on the official site before you rely on it." : " Officials can change after elections; tell us if something is out of date."}
        </p>
      )}
    </section>
  );
}
